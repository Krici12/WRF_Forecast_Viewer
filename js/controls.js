// ══════════════════════════════════════════════════════════════════════════
//  CONTROLS — time axis (setTime/go/stepBy/play), variable switch, legend,
//  compact mode
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/map.js).
//  Odkazuje na globály z hlavního bloku (step, varName, playing, playTmr, spdIdx,
//  SPEEDS, metadata, allTimesteps, TEMP_STOPS, PREC_STOPS) a volá render() (map.js)
//  — vše až za běhu.
//
//  TIME AXIS (2026-11-13). The slider is a fixed axis, the same for every
//  dataset: `axis` = today's 00 UTC to +5 days, taken from manifest.json
//  (today_start, horizon), one position per hour. It changes only when the
//  pipeline's day changes. A dataset covers a part of it (`cover`); the track
//  shows that part and how much of it is loaded.
//    wantTime  the moment the user asked for. It survives a dataset switch, so
//              the time on screen never changes by switching.
//    step      index in allTimesteps of the step nearest to wantTime; that is
//              the one on the map, and the thumb sits on its time.
//  A 3-hourly dataset therefore snaps to its own steps, and coming back to an
//  hourly one returns to the hour the user chose.
// ══════════════════════════════════════════════════════════════════════════
const HOUR=3600000;
const CHUNK_MS=6*HOUR;       // one chunk file of the pipeline covers 6 hours
let axis=null;               // {t0, t1} in ms, fixed for the page visit
let wantTime=null;           // ms
let stepTimes=[];            // ms of every entry of allTimesteps
let stepH=1;                 // time step of the dataset on screen [h]
let cover={from:null,to:null,loaded:[]};   // ms: dataset range and loaded [from, to] pieces
let _shownTs=null,_shownVar=null;
let resLabel='';             // resolution of the dataset on screen (data.js resText)

function isoMs(s){return Date.parse(String(s).slice(0,19)+'Z');}
function clampAxis(t){return Math.max(axis.t0,Math.min(axis.t1,t));}

// Start of the chunk a file holds, from its name (…_2026-11-13T06.json).
function chunkStartMs(name){
  const m=/_(\d{4}-\d{2}-\d{2})T(\d{2})\.json$/.exec(name);
  return m?Date.parse(m[1]+'T'+m[2]+':00:00Z'):NaN;
}

// Called once, when the manifest has arrived (data.js).
function initAxis(manifest){
  if(axis)return;
  let t0=Date.parse(manifest.today_start||''),t1=Date.parse(manifest.horizon||'');
  if(!t0||!t1||t1<=t0){
    // A manifest without the two fields: the span of all chunk files.
    t0=Infinity;t1=-Infinity;
    (manifest.datasets||[manifest]).forEach(d=>(d.files||[]).forEach(f=>{
      const c=chunkStartMs(f);
      if(c){t0=Math.min(t0,c);t1=Math.max(t1,c+CHUNK_MS);}
    }));
    if(!(t1>t0)){t0=Math.floor(Date.now()/86400000)*86400000;t1=t0+120*HOUR;}
  }
  axis={t0:t0,t1:t1};
  const sl=document.getElementById('slider');
  sl.min=0;sl.max=Math.round((t1-t0)/HOUR);
  // The page opens at the present hour, not at the first step of the day.
  if(wantTime===null)wantTime=clampAxis(Math.floor(Date.now()/HOUR)*HOUR);
  buildTicks();
  drawCover();
}

// allTimesteps changed (a chunk arrived, a dataset was switched).
function timesChanged(){
  stepTimes=allTimesteps.map(t=>t.ms);
  if(stepTimes.length>1){
    let d=Infinity;
    for(let i=1;i<stepTimes.length;i++)d=Math.min(d,stepTimes[i]-stepTimes[i-1]);
    stepH=Math.max(1,Math.round(d/HOUR));
  }
  const lab=stepH+'h';
  document.getElementById('btn-prev').textContent='−'+lab;
  document.getElementById('btn-next').textContent='+'+lab;
  showTime();
  if(typeof ensDataChanged==='function')ensDataChanged();   // "all models" panel (ensemble.js)
}

function nearestStep(t){
  let best=-1,bd=Infinity;
  for(let i=0;i<stepTimes.length;i++){
    const d=Math.abs(stepTimes[i]-t);
    if(d<bd){bd=d;best=i;}
  }
  return best;
}

// The user asked for a moment (slider, buttons, keys, playback).
function setTime(t){
  if(!axis)return;
  wantTime=clampAxis(t);
  showTime();
}
function onSlider(v){setTime(axis.t0+v*HOUR);}

// Put the step nearest to wantTime on the map and on the panel.
function showTime(){
  if(!axis)return;
  const sl=document.getElementById('slider');
  const i=nearestStep(wantTime);
  if(i<0||!allTimesteps[i]){
    step=0;_shownTs=null;
    sl.value=(wantTime-axis.t0)/HOUR;
    document.getElementById('t-display').innerHTML=timeHtml(wantTime);
    document.getElementById('t-sub').textContent='loading…';
    showRun(null);
    return;
  }
  step=i;
  const ts=allTimesteps[i];
  sl.value=(ts.ms-axis.t0)/HOUR;
  document.getElementById('t-display').innerHTML=timeHtml(ts.ms);
  document.getElementById('t-sub').textContent=subText(ts);
  showRun(ts.run);
  if(typeof ensTimeChanged==='function')ensTimeChanged();
  if(ts!==_shownTs||varName!==_shownVar){
    _shownTs=ts;_shownVar=varName;
    render();
    if(typeof refreshTip==='function')refreshTip();   // pinned point: new numbers
  }
}

// Kept for scripts and the console: jump to the n-th loaded step.
function setStep(idx){
  if(!stepTimes.length)return;
  setTime(stepTimes[Math.max(0,Math.min(idx,stepTimes.length-1))]);
}

// n steps of the dataset forward or back.
function stepBy(n){
  if(!stepTimes.length)return;
  setTime(stepTimes[Math.max(0,Math.min(step+n,stepTimes.length-1))]);
}

// dh hours forward or back: the first step at or beyond that moment, so the
// buttons mean hours for every dataset, hourly or 3-hourly.
function go(dh){
  if(!stepTimes.length)return;
  const target=stepTimes[step]+dh*HOUR;
  let i;
  if(dh>0){
    i=stepTimes.findIndex(t=>t>=target);
    if(i<0)i=stepTimes.length-1;
  }else{
    i=0;
    for(let k=stepTimes.length-1;k>=0;k--){if(stepTimes[k]<=target){i=k;break;}}
  }
  setTime(stepTimes[i]);
}

// Local (Prague) time of a moment. The zone label follows daylight saving:
// UTC+1 = CET, UTC+2 = CEST.
const _pragueFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',
  weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function pragueParts(ms){
  const d=new Date(ms),p={};
  _pragueFmt.formatToParts(d).forEach(x=>{p[x.type]=x.value;});
  p.zone=((+p.hour-d.getUTCHours())+24)%24===2?'CEST':'CET';
  return p;
}
// "Fri 13 Nov · 14:00 CET" as plain text (ms or a UTC ISO string).
function pragueTime(t){
  const p=pragueParts(typeof t==='number'?t:isoMs(t));
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute} ${p.zone}`;
}
function timeHtml(ms){
  const p=pragueParts(ms);
  return `<span class="t-date">${p.weekday} ${p.day} ${p.month}</span>`+
         `<span class="t-clock">${p.hour}:${p.minute}</span><span class="t-zone">${p.zone}</span>`;
}

// Second line under the time: UTC time and the lead time of the step
// ("08:00 UTC · +20 h"). The run itself is in the header (showRun).
function subText(ts){
  const lead=leadHours(ts);
  return `${ts.time.slice(11,16)} UTC`+(lead===null?'':` · +${lead} h`);
}

// Lead time in hours counted from the model run of the step's own chunk (the
// chunks of one dataset can come from two runs). null while unknown.
function leadHours(ts){
  const r=ts.run;
  if(!r||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r))return null;
  const h=(ts.ms-isoMs(r))/HOUR;
  return Number.isFinite(h)?Math.round(h):null;
}

// Run time for the panel: "2026-11-10T06:00:00" -> "2026-11-10 06:00 UTC".
function fmtRun(r){
  r=r||'—';
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r) ? r.replace('T',' ').slice(0,16)+' UTC' : r;
}

// Run in the header: "12 Nov 12 UTC"; the full time, the resolution and the
// time step are in its tooltip. Two elements carry it (.run-txt): next to
// the dataset select on wide windows, under the title on narrow ones.
const _MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let _shownRun;
function showRun(r){
  const key=(r||'')+'|'+resLabel+'|'+stepH;
  if(key===_shownRun)return;
  _shownRun=key;
  const ok=r&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r);
  const txt=ok?`${+r.slice(8,10)} ${_MON[+r.slice(5,7)-1]} ${r.slice(11,13)} UTC`:(r||'—');
  const tip=(ok?`Model run started ${fmtRun(r)}`:'Model run')+(resLabel?` · grid ${resLabel}`:'')+` · output every ${stepH} h`;
  document.querySelectorAll('.run-txt').forEach(e=>{e.textContent=txt;e.parentNode.title=tip;});
}

function togglePlay(){
  playing=!playing;
  document.getElementById('playbtn').classList.toggle('playing',playing);
  clearInterval(playTmr);
  if(playing)playTmr=setInterval(playTick,1000/SPEEDS[spdIdx]);
}
// Next step of the dataset; after the last one, back to the first.
function playTick(){
  if(!stepTimes.length)return;
  setTime(stepTimes[step>=stepTimes.length-1?0:step+1]);
}

function cycleSpeed(){
  spdIdx=(spdIdx+1)%SPEEDS.length;
  document.getElementById('spd').textContent=`${SPEEDS[spdIdx]}×`;
  if(playing){
    clearInterval(playTmr);
    playTmr=setInterval(playTick,1000/SPEEDS[spdIdx]);
  }
}

function setVar(v){
  varName=v;
  document.getElementById('btn-t').classList.toggle('active',v==='temp_c');
  document.getElementById('btn-p').classList.toggle('active',v==='precip_mm');
  updateLegend();
  showTime();
}

// ══════════════════════════════════════════════════════════════════════════
//  LEGEND
// ══════════════════════════════════════════════════════════════════════════
function updateLegend(){
  const isTmp=varName==='temp_c';
  // Only the unit is written out: the variable is on the switch in the header.
  const lt=document.getElementById('leg-title');
  lt.textContent=isTmp?'°C':'mm/h';
  lt.title=isTmp?'2 m temperature [°C]':'Precipitation [mm/h]';
  const rgba=s=>`rgba(${s.r},${s.g},${s.b},${(s.a/255).toFixed(2)})`;
  let grad,labs;   // labs: [{v, p}] with p = position on the bar in %
  if(isTmp){
    // Linear bar: labels sit at their true position, every 10 °C plus the upper end.
    const stops=TEMP_STOPS,minV=stops[0].v,maxV=stops[stops.length-1].v;
    const pos=v=>(v-minV)/(maxV-minV)*100;
    grad=stops.map(s=>`${rgba(s)} ${pos(s.v).toFixed(1)}%`).join(', ');
    labs=[-30,-20,-10,0,10,20,30,maxV].map(v=>({v:v,p:pos(v)}));
  }else{
    // Precipitation spans 0.1 to 50 mm/h, and most of what falls is under
    // 2 mm/h: a linear bar would squeeze that into its first few percent.
    // Every colour stop gets the same width instead (the ramp is linear
    // between two stops, on the map as well as here). Rates below the first
    // visible stop are not drawn on the map and are left out.
    const stops=PREC_STOPS.filter(s=>s.a>0),n=stops.length-1;
    grad=stops.map((s,i)=>`${rgba(s)} ${(i/n*100).toFixed(1)}%`).join(', ');
    labs=stops.map((s,i)=>({v:s.v,p:i/n*100}));
  }
  document.getElementById('leg-bar').style.background=`linear-gradient(to right, ${grad})`;
  // A label closer than 11 % of the bar to the previous one is skipped so they never overlap.
  let last=-99,html='';
  labs.forEach(l=>{
    if(l.p-last<11)return;
    last=l.p;
    const cls=l.p<3?' class="first"':(l.p>97?' class="last"':'');
    html+=`<span${cls} style="left:${l.p.toFixed(1)}%">${l.v}</span>`;
  });
  document.getElementById('leg-labs').innerHTML=html;
}

// ══════════════════════════════════════════════════════════════════════════
//  COMPACT MODE (phones and low windows)
//  One button folds the header and most of the bottom panel away; what stays
//  is the time, play, the time slider and a one-line data credit. The choice
//  is remembered in this browser.
// ══════════════════════════════════════════════════════════════════════════
function setCompact(on){
  document.body.classList.toggle('compact',on);
  const b=document.getElementById('compact-btn');
  if(b){
    b.setAttribute('aria-expanded',String(!on));
    b.title=on?'Show all controls':'Hide controls, keep the time slider';
    b.setAttribute('aria-label',b.title);
  }
  if(!on&&typeof syncTop==='function')syncTop();     // the header is back: measure it
  if(typeof placePinnedTip==='function')placePinnedTip();
}
function toggleCompact(){
  const on=!document.body.classList.contains('compact');
  setCompact(on);
  try{localStorage.setItem('compact',on?'1':'0');}catch(e){}
}
// Restore the remembered choice, but only where the button exists (phones,
// low windows): on a desktop there would be no way back. A very low window
// (a phone held sideways) starts compact unless the user chose otherwise:
// the full panel would leave almost no map.
function initCompact(){
  let saved=null;
  try{saved=localStorage.getItem('compact');}catch(e){}
  const b=document.getElementById('compact-btn');
  const on=saved==='1'||(saved===null&&window.innerHeight<=480);
  if(on&&b&&getComputedStyle(b).display!=='none')setCompact(true);
}

// ══════════════════════════════════════════════════════════════════════════
//  TRACK — where the dataset has a forecast, what is loaded, the present moment
// ══════════════════════════════════════════════════════════════════════════
function axisPct(t){return Math.max(0,Math.min(100,(t-axis.t0)/(axis.t1-axis.t0)*100));}

function drawCover(){
  if(!axis)return;
  const data=document.getElementById('trk-data');
  if(cover.from===null||cover.to===null||cover.to<cover.from){
    data.style.display='none';
  }else{
    data.style.display='block';
    data.style.left=axisPct(cover.from)+'%';
    data.style.width=(axisPct(cover.to)-axisPct(cover.from))+'%';
  }
  // Neighbouring loaded pieces are drawn as one bar.
  const segs=cover.loaded.slice().sort((a,b)=>a[0]-b[0]),merged=[];
  segs.forEach(sg=>{
    const last=merged[merged.length-1];
    if(last&&sg[0]<=last[1])last[1]=Math.max(last[1],sg[1]);else merged.push([sg[0],sg[1]]);
  });
  document.getElementById('trk-loaded').innerHTML=merged.map(sg=>
    `<div class="trk-seg" style="left:${axisPct(sg[0])}%;width:${axisPct(sg[1])-axisPct(sg[0])}%"></div>`).join('');
  const now=Date.now(),mark=document.getElementById('trk-now');
  if(now>=axis.t0&&now<=axis.t1){mark.style.display='block';mark.style.left=axisPct(now)+'%';}
  else mark.style.display='none';
}

// ══════════════════════════════════════════════════════════════════════════
//  TICKS — one cell per local (Prague) day, a short tick at every local noon
// ══════════════════════════════════════════════════════════════════════════
function buildTicks(){
  const c=document.getElementById('ticks');
  c.innerHTML='';
  if(!axis)return;
  const bounds=[axis.t0],noons=[];
  for(let h=Math.ceil(axis.t0/HOUR)*HOUR;h<axis.t1;h+=HOUR){
    const hr=+pragueParts(h).hour;
    if(hr===0&&h>axis.t0)bounds.push(h);
    if(hr===12)noons.push(h);
  }
  bounds.push(axis.t1);
  const now=Date.now();
  let html='';
  for(let i=0;i<bounds.length-1;i++){
    const a=bounds[i],b=bounds[i+1],l=axisPct(a),w=axisPct(b)-l;
    const p=pragueParts((a+b)/2);
    const cls='day'+(i===0?' first':'')+(now>=a&&now<b?' today':'');
    // A sliver of a day at either end of the axis gets no label.
    const lab=w<9?'':`<span class="long">${p.weekday} ${p.day} ${p.month}</span><span class="short">${p.weekday} ${p.day}</span>`;
    html+=`<div class="${cls}" style="left:${l}%;width:${w}%">${lab}</div>`;
  }
  noons.forEach(t=>{html+=`<div class="noon" style="left:${axisPct(t)}%"></div>`;});
  c.innerHTML=html;
}
