// ══════════════════════════════════════════════════════════════════════════
//  DATA — načítání předpovědi (manifest)
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/colors.js).
//  Odkazuje na globály z hlavního bloku (allTimesteps, gridData, metadata) a
//  na initApp() — čte/volá je až za běhu, takže stačí, aby existovaly globálně.
//
//  Progresivní načítání:
//    1) manifest.json       (grid_file + files; today_start + horizon dávají
//                            pevnou časovou osu, controls.js initAxis)
//    2) grid.json           (jednou; grid už NENÍ v každém chunku). Grid se drží
//                            v paměti (loadGrid): všechny WRF datasety sdílejí
//                            jednu síť, takže se 3 MB soubor stahuje jen jednou
//                            za návštěvu. Táž síť je i pevná vrstva terénu
//                            (`terrain`) pro ELEV v popisku u všech datasetů.
//    3) chunk po chunku     — mapa zobrazena hned po gridu (initApp), timesteps
//                            se plní na pozadí. Jako první se stahuje chunk s
//                            časem, který je na obrazovce (wantTime), pak
//                            pozdější a nakonec dřívější: správný snímek je
//                            vidět po prvním souboru a čas se při přepnutí
//                            datasetu nemění.
//
//  Odolnost: každý fetch má timeout + retry; pokud něco selže, overlay #prog se
//  VŽDY skryje a zobrazí se #error s tlačítkem RETRY. Nikdy nezůstane jen logo.
// ══════════════════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded',()=>{
  tryLoadManifest();
});

// ── Fetch helpers ───────────────────────────────────────────

// fetch JSON with a timeout (abort) and a friendlier error message.
async function fetchJSON(url, timeoutMs){
  timeoutMs = timeoutMs || 60000;
  const ctl = new AbortController();
  const tmr = setTimeout(()=>ctl.abort(), timeoutMs);
  try{
    const r = await fetch(url, {cache:'no-cache', signal:ctl.signal});
    if(!r.ok) throw new Error('HTTP '+r.status+' ('+url+')');
    return await r.json();
  }catch(err){
    if(err.name === 'AbortError'){
      throw new Error('timeout after '+Math.round(timeoutMs/1000)+'s ('+url+')');
    }
    throw err;
  }finally{
    clearTimeout(tmr);
  }
}

// Retry a fetch a couple of times before giving up (large chunks on cPanel
// can be slow or transiently fail).
async function fetchWithRetry(url, retries, timeoutMs){
  retries = retries || 2;
  let last;
  for(let attempt = 0; attempt <= retries; attempt++){
    try{
      return await fetchJSON(url, timeoutMs);
    }catch(err){
      last = err;
      console.warn('fetch failed ('+attempt+'/'+retries+'):', url, err.message);
      if(attempt < retries){
        await new Promise(res => setTimeout(res, 1000 * (attempt + 1)));
      }
    }
  }
  throw last;
}

// Show the error panel (always hiding the LOADING overlay) instead of leaving
// the page stuck on the CZU logo.
function showFatalError(msg){
  document.getElementById('prog').style.display = 'none';
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('error').style.display = 'flex';
}

// ── Manifest / dataset ──────────────────────────────────────

async function tryLoadManifest(){
  try{
    // Cache-bust: the cPanel/proxy layer caches manifest.json by URL, so a
    // stable URL keeps serving a stale manifest after a new deploy. A unique
    // query param forces a fresh fetch every load. (Chunk files are safe —
    // their names embed the cycle, so a new run = new URL = no stale cache.)
    const manifest = await fetchWithRetry('manifest.json?t='+Date.now(), 2, 30000);

    let dataset = null;
    if(manifest.datasets && manifest.datasets.length > 0){
      // Nový formát: vybereme default_dataset
      const defaultId = manifest.default_dataset || manifest.datasets[0].id;
      dataset = manifest.datasets.find(d => d.id === defaultId);
      if(!dataset){
        showFatalError('DEFAULT DATASET NOT FOUND: '+defaultId);
        return;
      }
      if(dataset.files.length === 0){
        const available = manifest.datasets
          .map(d => d.id + ':' + (d.files.length ? 'ready' : 'empty'))
          .join('  ');
        showFatalError('SELECTED DATASET ('+defaultId+') HAS NO DATA FILES.\n\nAVAILABLE: '+available);
        return;
      }
    } else if(manifest.files && manifest.files.length > 0){
      // Starý formát: zpětná kompatibilita - vytvoříme wrapper dataset
      console.log('Loading legacy manifest format (backward compatible)');
      dataset = {
        id: 'gfs_wrf',
        label: 'GFS + WRF (3 km)',
        model: 'GFS',
        stage: 'wrf',
        grid_file: 'grid.json',
        files: manifest.files
      };
    } else {
      showFatalError('MANIFEST HAS NO DATASETS AND NO FILES.');
      return;
    }

    currentDataset = dataset;
    currentManifest = manifest;
    initAxis(manifest);                  // fixed time axis (controls.js)
    await autoLoadFromManifest(manifest, dataset);
  }catch(err){
    console.error('Manifest load error:', err.message);
    showFatalError('NEPODAŘILO SE NAČÍST MANIFEST.\n'+err.message);
  }
}

// Globální reference na aktuální dataset a manifest
let currentDataset = null;
let currentManifest = null;

// Counter of dataset loads: a load that is no longer the newest one stops
// (the user switched dataset while chunks were still arriving).
let loadSeq = 0;

// ── Grid + fixed terrain layer ──────────────────────────────

// Terrain height for the ELEV row of the value box (js/tooltip.js): the 3 km
// WRF terrain, the same for every dataset and every run. {grid, nx, ny, loc}.
// Used for the WRF datasets and as a fallback for a driver ("original") grid
// that has no orography of its own (hgt_model is not true: cycles
// postprocessed before 2026-11-13 carry hgt = 0 everywhere).
let terrain = null;
let _terrainPending = false;
const _gridCache = {};           // dataset id -> grid object, for this page visit

function setTerrain(g){
  if(terrain || !g || !g.hgt || !g.nx || !g.ny) return;
  terrain = {grid: g, nx: g.nx, ny: g.ny, loc: makeLocator(g, g.nx, g.ny)};
  if(typeof refreshTip === 'function') refreshTip();
}

async function loadGrid(dataset){
  if(_gridCache[dataset.id]) return _gridCache[dataset.id];
  // Every WRF dataset runs on the same domain (the five grid.json files are
  // byte-identical), so a second WRF dataset with the same grid size reuses
  // the grid that is already in memory instead of downloading 3 MB again.
  const dg = dataset.grid || {};
  if(dataset.stage === 'wrf' && terrain && dg.nx === terrain.nx && dg.ny === terrain.ny
     && dg.dx_m === terrain.grid.dx_m){
    return (_gridCache[dataset.id] = terrain.grid);
  }
  const g = await fetchWithRetry(buildFilePath(dataset, dataset.grid_file || 'grid.json'), 2);
  _gridCache[dataset.id] = g;
  if(dataset.stage === 'wrf') setTerrain(g);
  return g;
}

// A driver dataset without its own orography, opened before any WRF one:
// fetch the WRF terrain in the background.
function ensureTerrain(manifest, grid){
  if(terrain || _terrainPending || (grid && grid.hgt_model)) return;
  const d = (manifest.datasets || []).find(x => x.stage === 'wrf' && x.files && x.files.length);
  if(!d) return;
  _terrainPending = true;
  loadGrid(d).catch(err => console.warn('terrain load failed:', err.message))
             .finally(() => { _terrainPending = false; });
}

// Pomocná funkce pro skládání cesty k souboru z path_prefix
function buildFilePath(dataset, filename) {
  if(dataset.path_prefix){
    return dataset.path_prefix + '/' + filename;
  }
  return filename;
}

// ── Progresivní načítání ────────────────────────────────────

// Resolution of a dataset for the panel: "3 km" for WRF (a Lambert grid, its
// step is defined in kilometres), "0.25° · ~25 km" for a driver on its
// regular lat/lon grid (step read from the grid itself).
function resText(dataset, g){
  const km = Math.round(((g && g.dx_m) || (dataset.grid || {}).dx_m || 0) / 1000);
  if(dataset.stage === 'wrf' || !g || !g.lat || !g.nx) return km + ' km';
  const deg = Math.abs(g.lat[g.nx] - g.lat[0]);
  return (deg ? +deg.toFixed(3) + '° · ' : '') + '~' + km + ' km';
}

// Order in which the chunk files are fetched: the one holding the moment on
// screen first, then the later ones, then the earlier ones (nearest first).
function loadOrder(starts, t){
  let first = 0;
  for(let i = 0; i < starts.length; i++){ if(starts[i] <= t) first = i; }
  const order = [];
  for(let i = first; i < starts.length; i++) order.push(i);
  for(let i = first - 1; i >= 0; i--) order.push(i);
  return order;
}

async function autoLoadFromManifest(manifest, dataset) {
  // Map is shown as soon as the grid is in hand; timesteps fill in behind it.
  document.getElementById('prog').style.display = 'flex';
  document.getElementById('prog-label').textContent = 'LOADING GRID...';

  const myLoad = ++loadSeq;
  try {
    // Chunk files in time order (their names also carry the run, and one
    // dataset can hold chunks of two runs, so the name order is not enough).
    const files = dataset.files.slice().sort((a, b) => (chunkStartMs(a) - chunkStartMs(b)) || (a < b ? -1 : 1));
    const starts = files.map(chunkStartMs);
    const fallbackH = dataset.stage === 'wrf' ? 1 : 3;
    allTimesteps = [];
    stepTimes = [];                      // controls.js: nothing of the new dataset is loaded yet
    cover = {from: starts[0], to: starts[starts.length - 1] + CHUNK_MS - fallbackH * HOUR, loaded: []};
    stepH = fallbackH;
    drawCover();

    // 1) Grid is its own file now (it used to be duplicated in every chunk).
    const g = await loadGrid(dataset);
    if(myLoad !== loadSeq) return;
    gridData = g;
    metadata = {
      domain: dataset.stage === 'wrf' ? 2 : 0,
      dx_m:   (g && g.dx_m) ? g.dx_m : (dataset.grid ? dataset.grid.dx_m : 0),
      nx:     (g && g.nx)   ? g.nx   : (dataset.grid ? dataset.grid.nx   : 0),
      ny:     (g && g.ny)   ? g.ny   : (dataset.grid ? dataset.grid.ny   : 0),
    };
    document.getElementById('m-run').textContent = '—';
    document.getElementById('m-res').textContent = resText(dataset, g);

    // 2) Show the map immediately; the chunks load in the background.
    initApp();
    if(typeof initDatasetSwitcher === 'function'){
      initDatasetSwitcher(manifest);
    }
    document.getElementById('prog').style.display = 'none';
    ensureTerrain(manifest, g);
    timesChanged();

    // 3) Chunks, the one with the moment on screen first. Each arrives whole
    // and is put in its place, so allTimesteps is always in time order.
    const parts = new Array(files.length).fill(null);
    for (const i of loadOrder(starts, wantTime)) {
      const chunk = await fetchWithRetry(buildFilePath(dataset, files[i]), 2);
      if(myLoad !== loadSeq) return;     // a newer dataset load took over

      const run = (chunk.metadata || {}).run_time || null;
      const steps = chunk.timesteps || [];
      steps.forEach(ts => { ts.ms = isoMs(ts.time); ts.run = run; });
      parts[i] = steps;
      allTimesteps = [].concat(...parts.filter(Boolean));
      if(steps.length){
        // Loaded piece on the track: up to the next chunk, so neighbours join.
        cover.loaded.push([steps[0].ms, Math.min(starts[i] + CHUNK_MS, cover.to)]);
      }
      timesChanged();                    // sets stepH from the real steps
      // The real ends of the dataset, once its first and last chunks are in.
      if(parts[0] && parts[0].length) cover.from = parts[0][0].ms;
      const lastPart = parts[parts.length - 1];
      cover.to = lastPart && lastPart.length ? lastPart[lastPart.length - 1].ms
                                              : starts[starts.length - 1] + CHUNK_MS - stepH * HOUR;
      cover.loaded.forEach(sg => { if(sg[1] > cover.to) sg[1] = cover.to; });
      drawCover();
    }

    console.log('All chunks loaded:', allTimesteps.length, 'timesteps');
  } catch (err) {
    if(myLoad !== loadSeq) return;       // an abandoned load may fail quietly
    console.error('Data load error:', err);
    // ALWAYS hide the overlay and surface a real error — never hang on the logo.
    showFatalError('NEPODAŘILO SE NAČÍST DATA.\n' + err.message);
  }
}

// Funkce pro přepnutí datasetu
async function switchDataset(datasetId) {
  if(!currentManifest || !currentManifest.datasets){
    console.error('Cannot switch: manifest has no datasets');
    return;
  }

  const dataset = currentManifest.datasets.find(d => d.id === datasetId);
  if(!dataset){
    console.error('Dataset not found:', datasetId);
    return;
  }

  if(dataset.files.length === 0){
    // Keep the map visible and just inform the user.
    alert('Dataset "'+dataset.label+'" has no data files yet. Coming soon!');
    return;
  }

  currentDataset = dataset;
  document.getElementById('prog').style.display = 'flex';
  document.getElementById('prog-label').textContent = `LOADING ${dataset.label}...`;

  // Přenačíst data
  await autoLoadFromManifest(currentManifest, dataset);
}
