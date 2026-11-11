// ══════════════════════════════════════════════════════════════════════════
//  APP — bootstrap: klávesové zkratky a event wiring
//  Načítá se JAKO POSLEDNÍ (ZA hlavním <script> blokem), protože registruje
//  listenery, které volají funkce ze všech ostatních modulů. Spouští se až za
//  běhu (při uživatelském eventu), kdy už jsou všechny definice k dispozici.
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('keydown',e=>{
  if(!allTimesteps.length)return;
  if(e.key==='ArrowRight')go(1);
  if(e.key==='ArrowLeft')go(-1);
  if(e.key===' '){e.preventDefault();togglePlay();}
  if(e.key==='t')setVar('temp_c');
  if(e.key==='p')setVar('precip_mm');
  if(e.key==='i')toggleIsolines();
});

// Compact mode chosen on an earlier visit (phones, low windows).
if(typeof initCompact==='function')initCompact();
