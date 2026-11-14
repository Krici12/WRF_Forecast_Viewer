// ══════════════════════════════════════════════════════════════════════════
//  ENSEMBLE — all models at the pinned point (2026-11-13)
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/tooltip.js).
//  Odkazuje na globály z ostatních modulů (pinLL, pinInfo, currentManifest,
//  currentDataset, allTimesteps, axis, wantTime, step, gridData, geom, terrain,
//  loadGrid, buildFilePath, chunkStartMs, loadOrder, makeLocator, pragueTime,
//  pragueParts, setTime) — vše až za běhu.
//
//  The pinned value box has a "Compare models" button. It opens a panel with
//  two charts, 2 m temperature and precipitation, over the same five-day axis
//  as the time slider, one line per dataset of manifest.json: the WRF runs
//  (solid) and the global models that drive them (dashed), one colour per
//  global model. Under the charts a table gives the values at the time under
//  the cursor, or at the time on the map.
//
//  WHERE THE NUMBERS COME FROM. Every dataset is read at its own grid point:
//  the one whose cell contains the pinned place. Nothing is interpolated in
//  space or in time. Precipitation is a mean rate over the step that ends at
//  the given time (1 h for WRF, the model's own step for a global model), so
//  it is drawn as a step line.
//
//  LOADING. The dataset on the map is already in memory (allTimesteps). The
//  others are read file by file in a worker (js/series-worker.js) that keeps
//  only the one grid point. The global models are small (about 12 kB per file
//  as transferred). A WRF file is about 1.5 MB as transferred, some 110 MB for
//  the four other runs, so:
//    * on a phone, or with the browser's data saver on, the other WRF runs
//      load only after the user asks for them (button in the panel);
//    * elsewhere they load by themselves, the files around the time on screen
//      first, all runs side by side; closing the panel stops it.
//  What was read is kept per dataset and grid point (ensStore) for the page
//  visit, so opening the same point again costs nothing.
//
//  A series file per grid tile written by the pipeline would make this one
//  small request per dataset; the reader below is the only part to replace.
// ══════════════════════════════════════════════════════════════════════════

// One colour per global model; the WRF run and the model that drives it share
// it and differ by line style. Checked 2026-11-13 for all ten pairs: OKLab
// distance >= 17 with normal vision and >= 11 under simulated protan, deutan
// and tritan vision, contrast >= 3:1 on white.
const ENS_COL = {GFS: '#0f9aa8', ARPEGE: '#c0392b', ICON: '#c98500', GEM: '#6250d6', IFS: '#3b4350'};
const ENS_SPARE = ['#0f9aa8', '#c0392b', '#c98500', '#6250d6', '#3b4350'];
const ENS_WRF_MB = 1.5;        // one WRF chunk file as transferred (gzip), measured 2026-11-13
const ENS_PARALLEL = 4;        // files read at the same time

const ens = {open: false, ll: null, members: [], models: [], hidden: {}, hoverT: null,
             wrfOk: false, gen: 0, queue: [], busy: 0, raf: 0, days: null};
const ensStore = {};           // 'dataset|k' -> {pts: Map(ms -> {t, p}), files: Set, ver}
let ensWorker = null, ensWorkerBad = false, ensJobId = 0;
const ensJobs = {};            // job id -> job
const _ensLoc = new WeakMap(); // grid object -> locator

function ensPhone(){ return window.matchMedia('(max-width: 768px)').matches; }
function ensOk(v){ return v !== null && v !== undefined && Number.isFinite(v) && v > -999; }

// May the other WRF runs be downloaded without asking?
function ensWrfAllowed(){
  if(ens.wrfOk) return true;
  const c = navigator.connection;
  return !(ensPhone() || (c && (c.saveData || c.type === 'cellular')));
}

function ensLocator(g){
  if(g === gridData && geom) return geom.loc;
  if(typeof terrain !== 'undefined' && terrain && terrain.grid === g) return terrain.loc;
  let l = _ensLoc.get(g);
  if(!l){ l = makeLocator(g, g.nx, g.ny); _ensLoc.set(g, l); }
  return l;
}

function ensGetStore(id, k){
  const key = id + '|' + k;
  return ensStore[key] || (ensStore[key] = {pts: new Map(), files: new Set(), ver: 0});
}

// ── Open / close ────────────────────────────────────────────

function openEnsemble(){
  if(!pinInfo || !pinLL || !currentManifest || !axis) return;
  ens.open = true;
  document.getElementById('ens').style.display = 'flex';
  document.body.classList.add('ens-open');
  ensLayout();
  ensBuild();
  ensMakeRoom();
}

function closeEnsemble(){
  if(!ens.open) return;
  ens.open = false;
  ens.gen++;                   // files still on their way are kept, nothing new starts
  ens.queue = [];
  ens.hoverT = null;
  document.getElementById('ens').style.display = 'none';
  document.body.classList.remove('ens-open');
}

// Desktop: the panel sits on the left under the header and ends above the
// bottom panel; the charts take what is left of that height.
function ensLayout(){
  const el = document.getElementById('ens');
  if(!el || !ens.open) return;
  let th = 170, ph = 125;
  if(ensPhone()){
    el.style.top = ''; el.style.maxHeight = '';
    el.classList.remove('tight');
  }else{
    const top = Math.max(0, document.getElementById('topbar').getBoundingClientRect().bottom) + 10;
    const c = document.getElementById('controls').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    const bottom = (c.width && c.left < r.right + 8) ? c.top - 10 : window.innerHeight - 12;
    const maxH = Math.max(260, bottom - top);
    el.style.top = top + 'px';
    el.style.maxHeight = maxH + 'px';
    el.classList.toggle('tight', maxH < 560);     // low window: the note gives its room to the charts
    if(ens.th){ th = ens.th; ph = ens.ph; }       // ensFit() sets the real heights
  }
  ensSetHeights(th, ph);
}
function ensSetHeights(th, ph){
  const el = document.getElementById('ens');
  ens.th = Math.round(th); ens.ph = Math.round(ph);
  el.style.setProperty('--ens-th', ens.th + 'px');
  el.style.setProperty('--ens-ph', ens.ph + 'px');
}
// Desktop: give the two charts exactly the height that the title bar, the
// table and the note leave free, so the panel does not scroll.
function ensFit(){
  if(ensPhone()) return;
  const el = document.getElementById('ens');
  const maxH = parseFloat(el.style.maxHeight) || 0;
  if(!maxH) return;
  const t = document.getElementById('ens-t'), p = document.getElementById('ens-p');
  const free = maxH - 2 - (el.scrollHeight - t.clientHeight - p.clientHeight);
  const th = Math.round(Math.max(90, Math.min(190, free * 0.57)));
  const ph = Math.round(Math.max(70, Math.min(140, free * 0.43)));
  if(Math.abs(th - ens.th) > 1 || Math.abs(ph - ens.ph) > 1){ ensSetHeights(th, ph); ensRedraw(); }
}

// Desktop: move the map so that the pinned point is not under the panel.
function ensMakeRoom(){
  if(ensPhone() || !map || !pinInfo) return;
  const r = document.getElementById('ens').getBoundingClientRect();
  const pt = map.latLngToContainerPoint([pinInfo.lat, pinInfo.lon]);
  if(pt.x > r.right + 40) return;
  const goal = r.right + Math.min(260, (window.innerWidth - r.right) / 2);
  map.panBy([pt.x - goal, 0], {animate: true, duration: 0.3});
}

// ── Members: one per dataset that has files ─────────────────

function ensBuild(){
  if(!ens.open) return;
  if(!pinInfo || !pinLL){ closeEnsemble(); return; }
  const gen = ++ens.gen;
  ens.queue = [];
  ens.ll = {lat: pinLL.lat, lng: pinLL.lng};
  const list = (currentManifest.datasets || []).filter(d => d.files && d.files.length);
  ens.models = [];
  list.forEach(d => { if(ens.models.indexOf(d.model) < 0) ens.models.push(d.model); });
  ens.members = list.map(d => ({
    d: d, id: d.id, model: d.model, stage: d.stage,
    color: ENS_COL[d.model] || ENS_SPARE[ens.models.indexOf(d.model) % ENS_SPARE.length],
    live: !!currentDataset && d.id === currentDataset.id,
    files: d.files.slice().sort((a, b) => chunkStartMs(a) - chunkStartMs(b)),
    k: null, store: null, state: 'wait', failed: 0,
    stepMs: (d.stage === 'wrf' ? 1 : 3) * HOUR
  }));
  const p = pinInfo;
  document.getElementById('ens-sub').textContent =
    Math.abs(p.lat).toFixed(3) + (p.lat < 0 ? '°S' : '°N') + ' ' + Math.abs(p.lon).toFixed(3) + (p.lon < 0 ? '°W' : '°E');

  const live = ens.members.find(m => m.live);
  if(live){ live.k = pinInfo.k; live.store = ensGetStore(live.id, live.k); live.state = 'load'; }
  ensMergeLive();

  // Global models: small grids, small files, always loaded.
  ens.members.filter(m => !m.live && m.stage !== 'wrf').forEach(m => ensPrepare(m, gen));
  // Other WRF runs: one after another, so the shared 3 MB grid is fetched once.
  const wrf = ens.members.filter(m => !m.live && m.stage === 'wrf');
  if(ensWrfAllowed()){
    (async () => { for(const m of wrf){ if(gen !== ens.gen) return; await ensPrepare(m, gen); } })();
  }else{
    wrf.forEach(m => { m.state = 'held'; });
  }
  ensRedraw();
}

// The button in the panel: load the WRF runs that were held back.
function ensLoadWrf(){
  ens.wrfOk = true;
  const gen = ens.gen;
  const held = ens.members.filter(m => m.state === 'held');
  held.forEach(m => { m.state = 'wait'; });
  (async () => { for(const m of held){ if(gen !== ens.gen) return; await ensPrepare(m, gen); } })();
  ensRedraw();
}

// Grid point of the member, then its files into the queue.
async function ensPrepare(m, gen){
  try{
    const g = await loadGrid(m.d);
    if(gen !== ens.gen) return;
    const c = ensLocator(g).nearest(ens.ll.lat, ens.ll.lng);
    if(!c){ m.state = 'out'; ensRedraw(); return; }      // the place is outside this grid
    m.k = c.k;
    m.store = ensGetStore(m.id, m.k);
    const starts = m.files.map(chunkStartMs);
    const order = loadOrder(starts, wantTime);
    let n = 0;
    order.forEach((i, pos) => {
      if(m.store.files.has(m.files[i])) return;
      ens.queue.push({m: m, file: m.files[i], gen: gen, tries: 0,
                      // global models first; the WRF runs side by side
                      prio: (m.stage === 'wrf' ? 100000 : 0) + pos});
      n++;
    });
    m.state = n ? 'load' : 'done';
    ens.queue.sort((a, b) => a.prio - b.prio);
    ensPump();
  }catch(err){
    console.warn('ensemble: grid of ' + m.id + ' failed:', err.message);
    if(gen === ens.gen){ m.state = 'error'; }
  }
  ensRedraw();
}

function ensPump(){
  while(ens.busy < ENS_PARALLEL && ens.queue.length){
    const job = ens.queue.shift();
    if(job.gen !== ens.gen || job.m.store.files.has(job.file)) continue;
    ens.busy++;
    ensRead(job);
  }
}

function ensRead(job){
  const url = new URL(buildFilePath(job.m.d, job.file), location.href).href;
  if(!ensWorker && !ensWorkerBad){
    try{
      ensWorker = new Worker('js/series-worker.js?v=1');
      ensWorker.onmessage = e => { const j = ensJobs[e.data.id]; delete ensJobs[e.data.id]; if(j) ensDone(j, e.data); };
      ensWorker.onerror = () => {                         // no worker: read on the page itself
        ensWorkerBad = true; ensWorker = null;
        Object.keys(ensJobs).forEach(id => { const j = ensJobs[id]; delete ensJobs[id]; ensReadHere(j); });
      };
    }catch(e){ ensWorkerBad = true; ensWorker = null; }
  }
  if(!ensWorker){ ensReadHere(job); return; }
  job.id = ++ensJobId;
  ensJobs[job.id] = job;
  ensWorker.postMessage({id: job.id, url: url, k: job.m.k});
}

function ensReadHere(job){
  const k = job.m.k;
  fetch(new URL(buildFilePath(job.m.d, job.file), location.href).href)
    .then(r => { if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(j => ensDone(job, {ok: true, steps: (j.timesteps || []).map(ts =>
      ({ms: isoMs(ts.time), t: ts.temp_c ? ts.temp_c[k] : null, p: ts.precip_mm ? ts.precip_mm[k] : null}))}))
    .catch(err => ensDone(job, {ok: false, error: String(err.message || err)}));
}

function ensDone(job, res){
  ens.busy--;
  const m = job.m, st = m.store;
  if(res.ok){
    res.steps.forEach(q => { if(Number.isFinite(q.ms)) st.pts.set(q.ms, {t: q.t, p: q.p}); });
    st.files.add(job.file);
    st.ver++;
  }else if(job.gen === ens.gen){
    if(job.tries < 1){ job.tries++; ens.queue.push(job); }
    else{ m.failed++; console.warn('ensemble: ' + job.file + ' failed:', res.error); }
  }
  if(job.gen === ens.gen && m.state === 'load' && m.files.every(f => st.files.has(f))) m.state = 'done';
  ensPump();
  ensRedraw();
}

// The dataset on the map: its values come from allTimesteps as the page loads them.
function ensMergeLive(){
  const m = ens.members.find(x => x.live);
  if(!m || !m.store) return;
  const st = m.store;
  let changed = false;
  allTimesteps.forEach(ts => {
    if(st.pts.has(ts.ms)) return;
    st.pts.set(ts.ms, {t: ts.temp_c ? ts.temp_c[m.k] : null, p: ts.precip_mm ? ts.precip_mm[m.k] : null});
    changed = true;
  });
  m.files.forEach(f => {
    if(st.files.has(f)) return;
    const s = chunkStartMs(f);                   // a chunk arrives whole
    if(allTimesteps.some(ts => ts.ms >= s && ts.ms < s + CHUNK_MS)){ st.files.add(f); changed = true; }
  });
  if(changed) st.ver++;
  if(m.files.every(f => st.files.has(f))) m.state = 'done';
}

// ── Hooks called by the other modules ───────────────────────

function ensPinChanged(){ if(ens.open) ensBuild(); }               // tooltip.js setPin (also after a dataset switch)
function ensDataChanged(){ if(ens.open){ ensMergeLive(); ensRedraw(); } }   // controls.js timesChanged
function ensTimeChanged(){ ensRedraw(); }                           // controls.js showTime

window.addEventListener('resize', () => { if(ens.open){ ensLayout(); ensRedraw(); } });

// ── Series and values ───────────────────────────────────────

// Points of a member inside the axis, in time order; its real step.
function ensSeries(m){
  if(!m.store) return [];
  if(m._ser && m._ver === m.store.ver) return m._ser;
  const s = [];
  m.store.pts.forEach((v, ms) => { if(ms >= axis.t0 && ms <= axis.t1) s.push({ms: ms, t: v.t, p: v.p}); });
  s.sort((a, b) => a.ms - b.ms);
  let d = Infinity;
  for(let i = 1; i < s.length; i++) d = Math.min(d, s[i].ms - s[i - 1].ms);
  if(Number.isFinite(d) && d > 0) m.stepMs = d;
  m._ser = s; m._ver = m.store.ver;
  return s;
}

// Temperature: the member's own step nearest to T (within half a step).
function ensTempAt(m, T){
  const s = ensSeries(m);
  let best = null, bd = Infinity;
  for(let i = 0; i < s.length; i++){
    const d = Math.abs(s[i].ms - T);
    if(d < bd){ bd = d; best = s[i]; }
    if(s[i].ms > T) break;
  }
  return best && bd <= m.stepMs / 2 && ensOk(best.t) ? best : null;
}
// Precipitation: the step whose interval (end - step, end] holds T.
function ensPrecAt(m, T){
  const s = ensSeries(m);
  for(let i = 0; i < s.length; i++){
    if(s[i].ms >= T) return (s[i].ms - T < m.stepMs && ensOk(s[i].p)) ? s[i] : null;
  }
  return null;
}

function ensNice(lo, hi, n){
  const raw = (hi - lo) / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * mag;
  return {lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, step: step};
}

// Local (Prague) days of the axis: [{a, b, label, today}]
function ensDays(){
  if(ens.days && ens.days.t0 === axis.t0) return ens.days.list;
  const b = [axis.t0];
  for(let h = Math.ceil(axis.t0 / HOUR) * HOUR; h < axis.t1; h += HOUR){
    if(+pragueParts(h).hour === 0 && h > axis.t0) b.push(h);
  }
  b.push(axis.t1);
  const now = Date.now(), list = [];
  for(let i = 0; i < b.length - 1; i++){
    const p = pragueParts((b[i] + b[i + 1]) / 2);
    list.push({a: b[i], b: b[i + 1], label: p.weekday + ' ' + p.day, today: now >= b[i] && now < b[i + 1]});
  }
  ens.days = {t0: axis.t0, list: list};
  return list;
}

// ── Drawing ─────────────────────────────────────────────────

function ensRedraw(){
  if(ens.open && !ens.raf) ens.raf = requestAnimationFrame(ensDraw);
}

function ensMapTime(){
  const ts = allTimesteps[step];
  return ts ? ts.ms : wantTime;
}

function ensDraw(){
  ens.raf = 0;
  if(!ens.open || !axis) return;
  const vis = ens.members.filter(m => m.store && !ens.hidden[m.model]);
  // global models under the WRF runs, the dataset on the map on top
  vis.sort((a, b) => (a.live - b.live) || ((a.stage === 'wrf') - (b.stage === 'wrf')));
  ensChart('ens-t', 't', vis);
  ensChart('ens-p', 'p', vis);
  ensTable();
  ensFoot();
  ensFit();
}

const ENS_M = {l: 34, r: 10, t: 8, b: 18};

function ensChart(id, key, vis){
  const svg = document.getElementById(id);
  const W = Math.max(200, svg.clientWidth), H = Math.max(60, svg.clientHeight);
  const M = ENS_M, pw = W - M.l - M.r, ph = H - M.t - M.b;
  const x = t => M.l + (t - axis.t0) / (axis.t1 - axis.t0) * pw;

  let lo = Infinity, hi = -Infinity;
  vis.forEach(m => ensSeries(m).forEach(q => { const v = q[key]; if(ensOk(v)){ if(v < lo) lo = v; if(v > hi) hi = v; } }));
  if(key === 'p'){ lo = 0; hi = Number.isFinite(hi) ? Math.max(hi, 0.5) : 1; }
  else{
    if(!Number.isFinite(lo)){ lo = 0; hi = 10; }
    if(hi - lo < 4){ const c = (hi + lo) / 2; lo = c - 2; hi = c + 2; }
  }
  const tk = ensNice(lo, hi, 4);
  const y = v => M.t + (1 - (v - tk.lo) / (tk.hi - tk.lo)) * ph;
  const f1 = n => n.toFixed(1);
  let h = '';

  // days: a line at every local midnight, the name under the plot
  ensDays().forEach((d, i) => {
    if(i) h += `<line class="eg-day" x1="${f1(x(d.a))}" x2="${f1(x(d.a))}" y1="${M.t}" y2="${M.t + ph}"/>`;
    if(x(d.b) - x(d.a) > 34) h += `<text class="eg-xl${d.today ? ' today' : ''}" x="${f1((x(d.a) + x(d.b)) / 2)}" y="${H - 5}">${d.label}</text>`;
  });
  // value grid
  const dec = tk.step < 1 ? (tk.step < 0.1 ? 2 : 1) : 0;
  for(let v = tk.lo; v <= tk.hi + tk.step / 2; v += tk.step){
    const zero = key === 't' && Math.abs(v) < tk.step / 2;
    h += `<line class="eg-grid${zero ? ' zero' : ''}" x1="${M.l}" x2="${M.l + pw}" y1="${f1(y(v))}" y2="${f1(y(v))}"/>` +
         `<text class="eg-yl" x="${M.l - 6}" y="${f1(y(v) + 3.5)}">${(Math.abs(v) < 1e-9 ? 0 : v).toFixed(dec)}</text>`;
  }
  // the present moment
  const now = Date.now();
  if(now >= axis.t0 && now <= axis.t1) h += `<line class="eg-now" x1="${f1(x(now))}" x2="${f1(x(now))}" y1="${M.t}" y2="${M.t + ph}"/>`;

  // series
  vis.forEach(m => {
    const s = ensSeries(m), gap = m.stepMs * 1.5;
    let d = '', prev = null;
    if(key === 't'){
      s.forEach(q => {
        if(!ensOk(q.t)){ prev = null; return; }
        d += (prev !== null && q.ms - prev <= gap ? 'L' : 'M') + f1(x(q.ms)) + ',' + f1(y(q.t));
        prev = q.ms;
      });
    }else{
      s.forEach(q => {
        if(!ensOk(q.p)){ prev = null; return; }
        const x1 = f1(x(q.ms)), yy = f1(y(q.p));
        if(prev !== null && q.ms - prev <= gap) d += 'V' + yy + 'H' + x1;
        else d += 'M' + f1(x(Math.max(axis.t0, q.ms - m.stepMs))) + ',' + yy + 'H' + x1;
        prev = q.ms;
      });
    }
    if(!d) return;
    const wrf = m.stage === 'wrf';
    h += `<path class="eg-line" d="${d}" stroke="${m.color}" stroke-width="${m.live ? 2.8 : wrf ? 2 : 1.6}"` +
         (wrf ? '' : ' stroke-dasharray="5 3"') + '/>';
  });

  // time on the map, and the time under the cursor with a dot on every line
  const tm = ensMapTime();
  if(tm >= axis.t0 && tm <= axis.t1){
    const xm = f1(x(tm));
    h += `<line class="eg-map" x1="${xm}" x2="${xm}" y1="${M.t - 3}" y2="${M.t + ph}"/>` +
         `<path class="eg-maph" d="M${xm},${M.t + 2}l-4,-6h8z"/>`;
  }
  const T = ens.hoverT;
  if(T !== null){
    h += `<line class="eg-hover" x1="${f1(x(T))}" x2="${f1(x(T))}" y1="${M.t}" y2="${M.t + ph}"/>`;
    vis.forEach(m => {
      const q = key === 't' ? ensTempAt(m, T) : ensPrecAt(m, T);
      if(!q) return;
      h += `<circle class="eg-dot" cx="${f1(x(key === 't' ? q.ms : T))}" cy="${f1(y(q[key]))}" r="3.6" fill="${m.color}"/>`;
    });
  }
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = h;
}

function ensFmt(q, key){
  if(!q) return null;
  return key === 't' ? q.t.toFixed(1).replace(/^-0\.0$/, '0.0') : q.p.toFixed(2);
}

function ensTable(){
  const T = ens.hoverT !== null ? ens.hoverT : ensMapTime();
  const cell = (m, key) => {
    if(!m) return '<td class="na">–</td>';
    const v = m.store ? ensFmt(key === 't' ? ensTempAt(m, T) : ensPrecAt(m, T), key) : null;
    const cls = m.live ? ' class="live"' : '';
    if(v !== null) return `<td${cls}>${v}</td>`;
    const wait = m.state === 'load' || m.state === 'wait';
    return `<td class="na${m.live ? ' live' : ''}">${wait ? '…' : '–'}</td>`;
  };
  let rows = '';
  ens.models.forEach(model => {
    const w = ens.members.find(m => m.model === model && m.stage === 'wrf');
    const o = ens.members.find(m => m.model === model && m.stage !== 'wrf');
    const col = (w || o).color, off = !!ens.hidden[model];
    rows += `<tr${off ? ' class="off"' : ''}><th><button class="ens-key" aria-pressed="${!off}" onclick="ensToggle('${model}')" ` +
            `title="${off ? 'Show' : 'Hide'} ${model}"><i style="background:${col}"></i>${model}</button></th>` +
            cell(w, 't') + cell(w, 'p') + cell(o, 't') + cell(o, 'p') + '</tr>';
  });
  const line = dash => `<svg viewBox="0 0 22 6" width="22" height="6" aria-hidden="true"><line x1="1" x2="21" y1="3" y2="3" stroke="currentColor" stroke-width="2"${dash ? ' stroke-dasharray="5 3"' : ''}/></svg>`;
  document.getElementById('ens-when').innerHTML =
    pragueTime(T) + `<span> · ${ens.hoverT === null ? 'time on the map' : 'under the cursor'}</span>`;
  document.getElementById('ens-table').innerHTML =
    `<table class="ens-tab"><thead>` +
    `<tr><th></th><th colspan="2">${line(false)} WRF 3 km</th><th colspan="2">${line(true)} Global model</th></tr>` +
    `<tr class="u"><th></th><th>°C</th><th>mm/h</th><th>°C</th><th>mm/h</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function ensToggle(model){
  ens.hidden[model] = !ens.hidden[model];
  ensRedraw();
}

// Title bar: what is still loading. Under the table: the button for the WRF
// runs that were held back, and the note.
function ensFoot(){
  const el = document.getElementById('ens-foot'), pr = document.getElementById('ens-prog'), ask = document.getElementById('ens-ask');
  let prog = '', btn = '';
  const held = ens.members.filter(m => m.state === 'held');
  const loading = ens.members.filter(m => !m.live && m.store && m.state === 'load');
  const failed = ens.members.reduce((n, m) => n + m.failed, 0) + ens.members.filter(m => m.state === 'error').length;
  let h = '';
  if(held.length){
    const mb = Math.round(held.reduce((n, m) => n + m.files.length, 0) * ENS_WRF_MB / 10) * 10;
    btn = `<button class="ens-load" onclick="ensLoadWrf()">Load the ${held.length === 1 ? 'other WRF run' : held.length + ' other WRF runs'} (about ${mb} MB)</button>`;
  }else if(loading.length){
    const total = loading.reduce((n, m) => n + m.files.length, 0);
    const done = loading.reduce((n, m) => n + m.files.filter(f => m.store.files.has(f)).length, 0);
    prog = `<span title="Loading ${loading.some(m => m.stage === 'wrf') ? 'the other WRF runs' : 'the global models'}: ${done} of ${total} files">` +
           `Loading ${done}/${total}</span><div class="ens-prog-bar"><div style="width:${(done / total * 100).toFixed(0)}%"></div></div>`;
  }
  if(pr.innerHTML !== prog) pr.innerHTML = prog;
  if(ask.innerHTML !== btn) ask.innerHTML = btn;
  if(failed) h += `<div class="ens-warn">${failed} file${failed === 1 ? '' : 's'} could not be loaded; the lines have gaps there.</div>`;
  h += '<div class="ens-note">Each model is read at its own grid point. ' +
       'Precipitation: mean rate over the model\'s step ending at that time. ' +
       'Black line: time on the map (click a chart to move it); dotted: now.</div>';
  if(el.innerHTML !== h) el.innerHTML = h;
}

// ── Pointer on the charts ───────────────────────────────────

function ensTimeAt(svg, clientX){
  const r = svg.getBoundingClientRect(), M = ENS_M;
  const f = (clientX - r.left - M.l) / (r.width - M.l - M.r);
  return Math.round((axis.t0 + Math.max(0, Math.min(1, f)) * (axis.t1 - axis.t0)) / HOUR) * HOUR;
}

function ensInitPointer(){
  ['ens-t', 'ens-p'].forEach(id => {
    const svg = document.getElementById(id);
    if(!svg) return;
    const hover = e => { if(!axis) return; const T = ensTimeAt(svg, e.clientX); if(T !== ens.hoverT){ ens.hoverT = T; ensRedraw(); } };
    svg.addEventListener('pointermove', hover);
    svg.addEventListener('pointerdown', hover);
    svg.addEventListener('pointerleave', e => { if(e.pointerType !== 'touch'){ ens.hoverT = null; ensRedraw(); } });
    svg.addEventListener('click', e => { if(!axis) return; ens.hoverT = null; setTime(ensTimeAt(svg, e.clientX)); ensRedraw(); });
  });
}
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensInitPointer);
else ensInitPointer();
