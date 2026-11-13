// ══════════════════════════════════════════════════════════════════════════
//  TOOLTIP — value read-out of one grid point (hover + pinned point)
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/controls.js).
//  Odkazuje na globály z hlavního bloku (allTimesteps, gridData, step, map),
//  na geom (map.js) a terrain (data.js) — čte je až při volání.
//
//  Hover (mouse): the box follows the cursor and a ring marks the grid point
//  the numbers come from, with the outline of its cell.
//  Click / tap: the point is pinned. The ring and the box stay there, follow
//  the map, and the numbers follow the time slider, the variable and the
//  dataset. Click the same cell again, the ✕ or press Esc to release it.
//
//  Box order: geography first (LAT, LON, ELEV), then the forecast (TEMP,
//  PRECIP). LAT/LON are those of the grid point, not of the cursor.
//  ELEV is the terrain of the model on screen: the grid's own `hgt` for WRF
//  and for a driver ("original") grid that carries its model orography
//  (grid.json `hgt_model`, pipeline from 2026-11-13). A driver grid without
//  it falls back to the 3 km WRF terrain (data.js `terrain`), marked "WRF".
//
//  Around the map buttons (zoom, my location) there is a margin of
//  CTL_MARGIN px where the box does not appear and a click does not pin.
// ══════════════════════════════════════════════════════════════════════════
const CTL_MARGIN=30;

// Is the screen position on a map button or within the margin around one?
function nearMapControl(x,y){
  if(typeof x!=='number'||typeof y!=='number')return false;
  const els=document.querySelectorAll('.leaflet-control-zoom, .locate-ctl');
  for(let i=0;i<els.length;i++){
    const r=els[i].getBoundingClientRect();
    if(!r.width||!r.height)continue;              // hidden (phones have no zoom buttons)
    if(x>=r.left-CTL_MARGIN&&x<=r.right+CTL_MARGIN&&y>=r.top-CTL_MARGIN&&y<=r.bottom+CTL_MARGIN)return true;
  }
  return false;
}

let pinLL=null;        // where the user clicked (kept across dataset switches)
let pinInfo=null;      // grid point pinned on the current map
let hoverInfo=null;    // grid point under the mouse
let hoverXY=null;      // last mouse position (client px)
let pinLayer=null,hoverLayer=null;

// Grid point of the dataset on screen whose cell contains the position.
function probe(latlng){
  if(!geom||!gridData)return null;
  const c=geom.loc.nearest(latlng.lat,latlng.lng);
  if(!c)return null;
  return {k:c.k,i:c.i,j:c.j,lat:gridData.lat[c.k],lon:gridData.lon[c.k]};
}

// Terrain height of a grid point: {h, wrf}. h [m] is null while unknown;
// wrf = true when it is the WRF terrain standing in for a driver grid that
// has no orography of its own.
function elevAt(info){
  const good=h=>(h===null||h===undefined||h<=-999)?null:h;
  const own=gridData&&gridData.hgt&&
    (gridData.hgt_model===true||(typeof currentDataset!=='undefined'&&currentDataset&&currentDataset.stage==='wrf'));
  if(own)return {h:good(gridData.hgt[info.k]),wrf:false};
  if(typeof terrain==='undefined'||!terrain)return {h:null,wrf:true};
  const c=terrain.loc.nearest(info.lat,info.lon);
  return {h:c?good(terrain.grid.hgt[c.k]):null,wrf:true};
}

function tipHtml(info,pinned){
  const ts=allTimesteps[step];
  const t=ts?ts.temp_c[info.k]:null;
  const p=ts?ts.precip_mm[info.k]:null;
  const el=elevAt(info),h=el.h;
  const ok=v=>v!==null&&v!==undefined&&v>-999;
  const tc=!ok(t)?'inherit':t<=0?'#0a7fd0':t<=15?'#2a9a44':t<=25?'#d9731f':'#d9362e';
  const lat=Math.abs(info.lat).toFixed(3)+(info.lat<0?'°S':'°N');
  const lon=Math.abs(info.lon).toFixed(3)+(info.lon<0?'°W':'°E');
  const head=pinned
    ?'<div class="tip-head"><span>GRID POINT</span><button class="tip-close" onclick="unpin()" title="Release the point (Esc)" aria-label="Release the point">'+
     '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>'
    :'';
  return head+`
    <div class="tr"><span class="tk">LAT</span><span class="tv">${lat}</span></div>
    <div class="tr"><span class="tk">LON</span><span class="tv">${lon}</span></div>
    <div class="tr"><span class="tk">ELEV</span><span class="tv">${h===null?'—':Math.round(h)+' m'+(el.wrf?' <span class="tv-note" title="Terrain of the 3 km WRF grid: this dataset carries no terrain of its own">WRF</span>':'')}</span></div>
    <div class="tsep"></div>
    <div class="tr"><span class="tk">TEMP</span><span class="tv" style="color:${tc}">${ts?(ok(t)?t.toFixed(1).replace(/^-0\.0$/,'0.0')+' °C':'N/A'):'…'}</span></div>
    <div class="tr"><span class="tk">PRECIP</span><span class="tv" style="color:#0969da">${ts?(ok(p)?p.toFixed(2)+' mm·h⁻¹':'N/A'):'…'}</span></div>
  `;
}

// Ring at the grid point plus the outline of its cell.
function drawProbe(info,cls){
  if(!map.getPane('probePane')){
    const pane=map.createPane('probePane');
    pane.style.zIndex=720;               // above the forecast and the boundary
    pane.style.pointerEvents='none';
  }
  const grp=L.layerGroup();
  L.polygon(geom.loc.cell(info.i,info.j),{pane:'probePane',interactive:false,
    color:'#101418',weight:cls==='pin'?1.6:1,opacity:cls==='pin'?0.95:0.6,
    fillColor:'#ffffff',fillOpacity:cls==='pin'?0.22:0.1}).addTo(grp);
  L.marker([info.lat,info.lon],{pane:'probePane',interactive:false,keyboard:false,
    icon:L.divIcon({className:'probe-dot '+cls,iconSize:[18,18],iconAnchor:[9,9]})}).addTo(grp);
  return grp.addTo(map);
}

function hideHover(){
  hoverInfo=null;hoverXY=null;
  if(hoverLayer){hoverLayer.remove();hoverLayer=null;}
  if(!pinInfo)document.getElementById('tip').style.display='none';
}

// mousemove on the map
function onHover(e){
  if(pinInfo||!geom)return;                       // a pinned point owns the box
  const oe=e.originalEvent||{};
  // On the map buttons and in the margin around them the box would be in the way.
  if((oe.target&&oe.target.closest&&oe.target.closest('.leaflet-control'))||nearMapControl(oe.clientX,oe.clientY)){hideHover();return;}
  const info=probe(e.latlng);
  if(!info){hideHover();return;}
  if(!hoverInfo||hoverInfo.k!==info.k){
    if(hoverLayer)hoverLayer.remove();
    hoverLayer=drawProbe(info,'hover');
  }
  hoverInfo=info;
  hoverXY=[oe.clientX,oe.clientY];
  const tip=document.getElementById('tip');
  tip.classList.remove('pinned');
  tip.innerHTML=tipHtml(info,false);
  tip.style.display='block';
  tip.style.visibility='visible';
  // Keep the box inside the window.
  tip.style.left=Math.max(8,Math.min(hoverXY[0]+16,window.innerWidth-tip.offsetWidth-8))+'px';
  tip.style.top=Math.max(8,Math.min(hoverXY[1]-10,window.innerHeight-tip.offsetHeight-8))+'px';
}

// click / tap on the map
let _clickAt=0,_pinBefore=null;
function onMapClick(e){
  if(!geom)return;
  const ce=e.originalEvent||{};
  if(nearMapControl(ce.clientX,ce.clientY))return;       // a near miss of a button
  // Remember the pin as it was before a click, so that a double click (which
  // zooms the map and arrives as two clicks first) can put it back.
  const now=Date.now();
  if(now-_clickAt>500)_pinBefore=pinLL;
  _clickAt=now;
  const info=probe(e.latlng);
  if(!info||(pinInfo&&pinInfo.k===info.k)){unpin();return;}
  pinLL=e.latlng;
  setPin(info);
}

// A double click zooms; it must not move or release the pinned point.
function onMapDblClick(){
  if(Date.now()-_clickAt>700)return;
  const info=_pinBefore?probe(_pinBefore):null;
  if(info){pinLL=_pinBefore;setPin(info);}else unpin();
}

function setPin(info){
  hideHover();
  if(pinLayer)pinLayer.remove();
  pinInfo=info;
  pinLayer=drawProbe(info,'pin');
  const tip=document.getElementById('tip');
  tip.classList.add('pinned');
  tip.innerHTML=tipHtml(info,true);
  tip.style.display='block';
  placePinnedTip();
}

function unpin(){
  pinLL=null;pinInfo=null;
  if(pinLayer){pinLayer.remove();pinLayer=null;}
  const tip=document.getElementById('tip');
  tip.classList.remove('pinned');
  tip.style.display='none';
}

// After a dataset switch the map is rebuilt: pin the same place again, on
// the grid point of the new dataset.
function restorePin(){
  pinInfo=null;pinLayer=null;hoverInfo=null;hoverLayer=null;
  if(!pinLL)return;
  const info=probe(pinLL);
  if(info)setPin(info);else unpin();
}

// New time step, variable, or the terrain layer has arrived: same point, new numbers.
function refreshTip(){
  const tip=document.getElementById('tip');
  if(pinInfo){tip.innerHTML=tipHtml(pinInfo,true);placePinnedTip();}
  else if(hoverInfo&&tip.style.display==='block'){tip.innerHTML=tipHtml(hoverInfo,false);}
}

// The pinned box sits next to its ring and follows the map. It hides while
// the ring is outside the free part of the map (under the header, the panel
// or off screen).
function placePinnedTip(){
  if(!pinInfo||!map)return;
  const tip=document.getElementById('tip');
  const pt=map.latLngToContainerPoint([pinInfo.lat,pinInfo.lon]);
  const top=document.getElementById('topbar').getBoundingClientRect().bottom;
  const bot=document.getElementById('controls').getBoundingClientRect().top;
  if(pt.x<0||pt.x>window.innerWidth||pt.y<Math.max(0,top)||pt.y>Math.min(window.innerHeight,bot)){
    tip.style.visibility='hidden';
    return;
  }
  tip.style.visibility='visible';
  const w=tip.offsetWidth,h=tip.offsetHeight,gap=16;
  const yMin=Math.max(0,top)+8,yMax=Math.min(window.innerHeight,bot)-8-h;   // free part of the map
  let x=pt.x+gap;
  if(x+w>window.innerWidth-8)x=pt.x-gap-w;        // no room on the right: go left
  let y=pt.y-h-gap;                               // above the ring
  if(y<yMin)y=pt.y+gap;                           // no room above: below it
  if(y>yMax)y=pt.y-h/2;                           // no room below either: beside it
  tip.style.left=Math.max(8,Math.min(x,window.innerWidth-w-8))+'px';
  tip.style.top=Math.max(8,Math.max(yMin,Math.min(y,yMax)))+'px';
}

// Leaflet's animated zoom (+/− buttons, double click) moves the ring with a
// CSS transition; the box waits for the end of it.
function hidePinnedTip(){
  if(pinInfo)document.getElementById('tip').style.visibility='hidden';
}
