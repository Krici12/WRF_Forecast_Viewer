// ══════════════════════════════════════════════════════════════════════════
//  DATA — načítání předpovědi (manifest)
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/colors.js).
//  Odkazuje na globály z hlavního bloku (allTimesteps, gridData, metadata) a
//  na initApp() — čte/volá je až za běhu, takže stačí, aby existovaly globálně.
//
//  Progresivní načítání:
//    1) manifest.json       (grid_file + files)
//    2) grid.json           (jednou; grid už NENÍ v každém chunku)
//    3) chunk po chunku     — mapa zobrazena hned po gridu (initApp), timesteps
//                            se plní na pozadí.
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
    await autoLoadFromManifest(manifest, dataset);
  }catch(err){
    console.error('Manifest load error:', err.message);
    showFatalError('NEPODAŘILO SE NAČÍST MANIFEST.\n'+err.message);
  }
}

// Globální reference na aktuální dataset a manifest
let currentDataset = null;
let currentManifest = null;

// Zda už proběhl první render aktuálního kroku po načtení dat (aby se při
// příchodu dalších chunků zbytečně nevykreslovalo dokola).
let initialRendered = false;

// Pomocná funkce pro skládání cesty k souboru z path_prefix
function buildFilePath(dataset, filename) {
  if(dataset.path_prefix){
    return dataset.path_prefix + '/' + filename;
  }
  return filename;
}

// ── Progresivní načítání ────────────────────────────────────

async function autoLoadFromManifest(manifest, dataset) {
  // Map is shown as soon as the grid is in hand; timesteps fill in behind it.
  document.getElementById('prog').style.display = 'flex';
  document.getElementById('prog-label').textContent = 'LOADING GRID...';

  try {
    const files = dataset.files.slice().sort();
    // Switching dataset: remember the valid time on screen so the new dataset
    // opens at the same moment (runs start at different times), and start the
    // new one cleanly at step 0 until that moment has loaded.
    let keepTime = (allTimesteps[step] || {}).time || null;
    initialRendered = false;
    step = 0;
    allTimesteps = [];

    // 1) Grid is its own file now (it used to be duplicated in every chunk).
    const gridFile = dataset.grid_file || 'grid.json';
    const g = await fetchWithRetry(buildFilePath(dataset, gridFile), 2);
    gridData = g;

    // Shallow metadata: build_web puts nx/ny/dx_m in grid.json; keep a
    // placeholder object until the first chunk refines it.
    metadata = {
      run_time:     '—',
      run_dir:      dataset.label || dataset.id,
      domain:       dataset.stage === 'wrf' ? 2 : 0,
      dx_m:         (g && g.dx_m) ? g.dx_m : (dataset.grid ? dataset.grid.dx_m : 0),
      nx:           (g && g.nx)   ? g.nx   : (dataset.grid ? dataset.grid.nx   : 0),
      ny:           (g && g.ny)   ? g.ny   : (dataset.grid ? dataset.grid.ny   : 0),
      n_timesteps:  0,
    };

    // 2) Show the map immediately; remaining chunks load in the background.
    initApp();
    if(typeof initDatasetSwitcher === 'function'){
      initDatasetSwitcher(manifest);
    }
    document.getElementById('prog').style.display = 'none';

    // 3) Load chunks sequentially, appending timesteps as they arrive.
    // Map is already visible, so use the small "more" pill — not the full
    // LOADING overlay (that would flash a blank screen over the map).
    const more = document.getElementById('moreprog');
    for (let i = 0; i < files.length; i++) {
      const f = buildFilePath(dataset, files[i]);
      document.getElementById('prog-label').textContent = `LOADING CHUNK ${i + 1}/${files.length}...`;
      more.style.display = 'block';
      more.textContent = `LOADING ${i + 1}/${files.length}…`;

      const chunk = await fetchWithRetry(f, 2);

      // First chunk refines the metadata (run time, domain, real nx/ny).
      if (i === 0) {
        metadata = chunk.metadata || metadata;
        metadata.nx = metadata.nx || (g && g.nx);
        metadata.ny = metadata.ny || (g && g.ny);
        metadata.dx_m = metadata.dx_m || (g && g.dx_m);
        // Refine the topbar with the real run metadata from the first chunk.
        document.getElementById('m-run').textContent = fmtRun(metadata);
        document.getElementById('m-dom').textContent = 'D0' + metadata.domain;
        document.getElementById('m-dx').textContent = Math.round(metadata.dx_m / 1000) + ' km';
      }

      for (let k = 0; k < chunk.timesteps.length; k++) {
        allTimesteps.push(chunk.timesteps[k]);
      }

      // Update the total step count and UI (slider/ticks) as chunks arrive.
      metadata.n_timesteps = allTimesteps.length;
      document.getElementById('m-n').textContent = allTimesteps.length;
      if(typeof updateSliderMax === 'function') updateSliderMax();
      if(typeof buildTicks === 'function')       buildTicks();

      // Once real timesteps exist, render step 0 (or the current step) so the
      // map, the time display and the slider are immediately correct — instead
      // of the blank/stale first frame that appeared on load before.
      if(!initialRendered && allTimesteps.length){
        initialRendered = true;
        if(typeof setStep === 'function') setStep(step);
      }
      // Jump to the remembered valid time once it has arrived, unless the
      // user has already moved the slider themselves.
      if(keepTime && step === 0 && typeof setStep === 'function'){
        // First step at or after that time (datasets differ in time step).
        const i = allTimesteps.findIndex(t => t.time >= keepTime);
        if(i >= 0){ keepTime = null; setStep(i); }
      } else if(step !== 0){
        keepTime = null;
      }
    }
    more.style.display = 'none';

    console.log('All chunks loaded:', allTimesteps.length, 'timesteps');
  } catch (err) {
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
