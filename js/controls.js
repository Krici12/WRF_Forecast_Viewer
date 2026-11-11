// ══════════════════════════════════════════════════════════════════════════
//  CONTROLS — ovládání času (step/play/speed) a vrstev (setVar/updateLegend)
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/map.js).
//  Obsahuje: setStep, pragueTime, subText, fmtRun, sliderFill, go, togglePlay, cycleSpeed, setVar, updateLegend,
//  buildTicks.
//  Odkazuje na globály z hlavního bloku (step, varName, playing, playTmr, spdIdx,
//  SPEEDS, metadata, allTimesteps, TEMP_STOPS, PREC_STOPS) a volá render() (map.js)
//  — vše až za běhu.
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
//  STEP / TIME
// ══════════════════════════════════════════════════════════════════════════
function setStep(idx){
  if(!allTimesteps.length)return;
  step=Math.max(0,Math.min(idx,metadata.n_timesteps-1));
  document.getElementById('slider').value=step;
  const ts=allTimesteps[step];

  document.getElementById('t-display').textContent=pragueTime(ts.time);
  document.getElementById('t-sub').textContent=subText(ts);
  sliderFill();
  render();
}

// Local (Prague) time of a UTC ISO string, e.g. "Wed 11 Nov · 01:00 CET".
// The zone label follows daylight saving: UTC+1 = CET, UTC+2 = CEST.
const _pragueFmt=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',
  weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function pragueTime(isoStr){
  const d=new Date(isoStr+'Z');
  const p={};
  _pragueFmt.formatToParts(d).forEach(x=>{p[x.type]=x.value;});
  const off=((+p.hour-d.getUTCHours())+24)%24;
  return `${p.weekday} ${p.day} ${p.month} · ${p.hour}:${p.minute} ${off===2?'CEST':'CET'}`;
}

// Second line under the time: UTC time, lead time and step counter.
function subText(ts){
  const lead=leadHours(ts);
  return `${ts.time.replace('T',' ').slice(0,16)} UTC · `+
    (lead===null?'':`+${lead} h · `)+`step ${step+1} / ${metadata.n_timesteps}`;
}

// Lead time in hours counted from the model run (the first step on the web is
// not always the run time). null until the run time is known.
function leadHours(ts){
  const r=metadata&&metadata.run_time;
  if(!r||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r))return null;
  const h=(new Date(ts.time+'Z')-new Date(r.slice(0,19)+'Z'))/3600000;
  return Number.isFinite(h)?Math.round(h):null;
}

// Run time for the panel: "2026-11-10T06:00:00" -> "2026-11-10 06:00 UTC".
function fmtRun(m){
  const r=m.run_time||m.run_dir||'—';
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(r) ? r.replace('T',' ').slice(0,16)+' UTC' : r;
}

// Paint the part of the slider track left of the thumb.
function sliderFill(){
  const sl=document.getElementById('slider');
  const max=+sl.max||0;
  sl.style.setProperty('--p',(max>0?(+sl.value/max*100):0)+'%');
}

function go(d){setStep(step+d);}

function togglePlay(){
  playing=!playing;
  document.getElementById('playbtn').classList.toggle('playing',playing);
  if(playing){
    playTmr=setInterval(()=>
      setStep(step>=metadata.n_timesteps-1?0:step+1),
      1000/SPEEDS[spdIdx]);
  }else{
    clearInterval(playTmr);
  }
}

function cycleSpeed(){
  spdIdx=(spdIdx+1)%SPEEDS.length;
  document.getElementById('spd').textContent=`${SPEEDS[spdIdx]}×`;
  if(playing){
    clearInterval(playTmr);
    playTmr=setInterval(()=>
      setStep(step>=metadata.n_timesteps-1?0:step+1),
      1000/SPEEDS[spdIdx]);
  }
}

function setVar(v){
  varName=v;
  document.getElementById('btn-t').classList.toggle('active',v==='temp_c');
  document.getElementById('btn-p').classList.toggle('active',v==='precip_mm');
  updateLegend();
  render();
}

// ══════════════════════════════════════════════════════════════════════════
//  LEGEND
// ══════════════════════════════════════════════════════════════════════════
function updateLegend(){
  const isTmp=varName==='temp_c';
  const stops=isTmp?TEMP_STOPS:PREC_STOPS;
  const unit=isTmp?'[°C]':'[mm·h⁻¹]';
  document.getElementById('leg-title').textContent=isTmp?`2 m temperature ${unit}`:`Precipitation ${unit}`;
  const minV=stops[0].v,maxV=stops[stops.length-1].v;
  const grad=stops.map(s=>
    `rgba(${s.r},${s.g},${s.b},${(s.a/255).toFixed(2)}) ${((s.v-minV)/(maxV-minV)*100).toFixed(0)}%`
  ).join(', ');
  document.getElementById('leg-bar').style.background=`linear-gradient(to right, ${grad})`;
  // Labels sit at their true position on the (linear) bar. Temperature: every
  // 10 °C plus the upper end; precipitation: the colour stops. A label closer than 9 % of the bar
  // to the previous one is skipped so they never overlap.
  const cand=isTmp?[-30,-20,-10,0,10,20,30,maxV]:stops.map(s=>s.v);
  let last=-99,html='';
  cand.forEach(v=>{
    const p=(v-minV)/(maxV-minV)*100;
    if(p-last<9)return;
    last=p;
    const cls=p<3?' class="first"':(p>97?' class="last"':'');
    html+=`<span${cls} style="left:${p.toFixed(1)}%">${v}</span>`;
  });
  document.getElementById('leg-labs').innerHTML=html;
}

// ══════════════════════════════════════════════════════════════════════════
//  SLIDER UPDATE (pro progresivní načítání)
// ══════════════════════════════════════════════════════════════════════════
function updateSliderMax(){
  if(!metadata || !metadata.n_timesteps)return;
  const sl=document.getElementById('slider');
  sl.max=metadata.n_timesteps-1;
  // Pokud jsme na posledním kroku, přejdi na nový poslední
  if(step >= metadata.n_timesteps-1){
    step = metadata.n_timesteps - 1;
    sl.value = step;
  }
  // Aktualizuj text počtu kroků
  const tSub = document.getElementById('t-sub');
  if(tSub && allTimesteps[step]){
    tSub.textContent = subText(allTimesteps[step]);
  }
  sliderFill();
}

// ══════════════════════════════════════════════════════════════════════════
//  TICKS
// ══════════════════════════════════════════════════════════════════════════
function buildTicks(){
  const c = document.getElementById('ticks');
  c.innerHTML = '';
  if (!allTimesteps || !allTimesteps.length) return;

  const n = allTimesteps.length;
  const seen = new Set();
  const days = [];

  for (let i = 0; i < n; i++) {
    const d = (allTimesteps[i].time || '').split('T')[0];
    if (d && !seen.has(d)) {
      seen.add(d);
      days.push({ idx: i, date: d });
    }
  }

  days.forEach((t, j) => {
    const tick = document.createElement('div');
    tick.className = 'day-tick';
    if (j === 0) tick.classList.add('first');
    if (j === days.length - 1) tick.classList.add('last');

    const pct = n > 1 ? (t.idx / (n - 1) * 100) : 50;
    tick.style.left = pct + '%';

    const line = document.createElement('div');
    line.className = 'day-line';
    tick.appendChild(line);

    const label = document.createElement('div');
    label.className = 'day-label';
    label.textContent = t.date.substring(5);  // MM-DD
    tick.appendChild(label);

    c.appendChild(tick);
  });
}
