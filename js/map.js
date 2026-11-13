// ══════════════════════════════════════════════════════════════════════════
//  MAP — inicializace mapy a rendering rastru
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/geo.js).
//  Obsahuje: initApp, gridGeomFor, initSmoothZoom, render (+ mrtvé izobarové
//  pomocné funkce marchingSquares/smooth/renderIsolinesSVG, které tu zůstávají
//  jen pro úplnost).
//  Odkazuje na globály z hlavního bloku (metadata, gridData, allTimesteps, step,
//  varName, offCanvas, imgOv, map, isoSvg) a volá showTime/drawCover/updateLegend
//  (controls.js), onHover/onMapClick/restorePin (tooltip.js), initLocate (locate.js), makeLocator/
//  buildWarp (geo.js) a makeShader (colors.js) — vše až za běhu.
//  initApp() volá js/data.js po načtení gridu.
// ══════════════════════════════════════════════════════════════════════════

// Geometry of the grid on the map (js/geo.js): locator, overlay bounds and the
// pixel lookup table. Set by initApp() for the dataset on screen.
let geom = null;
let smoothZoomOff = null;      // removes the wheel listeners of the previous map
let firstFitDone = false;

// A grid wider than the WRF domain (a driver that is not cropped by the
// pipeline) is cut to this box, so the map never shows a whole continent.
const CROP_BOX = { latMin: 44.2, latMax: 55.5, lonMin: 5.4, lonMax: 24.0 };
const OVERLAY_W = 768;         // width of the overlay canvas in pixels

// Leaflet image overlay whose element is a <canvas>: render() paints straight
// into it, no PNG encoding per frame.
const CanvasOverlay = L.ImageOverlay.extend({
  _initImage: function(){
    const el = this._image = this._url;
    L.DomUtil.addClass(el, 'leaflet-image-layer');
    if(this._zoomAnimated) L.DomUtil.addClass(el, 'leaflet-zoom-animated');
    el.onselectstart = L.Util.falseFn;
    el.onmousemove = L.Util.falseFn;
  }
});

// Geometry is computed once per grid object and remembered (all WRF datasets
// share one grid object, see data.js).
const _geomCache = new WeakMap();
function gridGeomFor(g, nx, ny){
  let gm = _geomCache.get(g);
  if(gm && gm.nx === nx && gm.ny === ny) return gm;
  const loc = makeLocator(g, nx, ny);
  const b = loc.bounds();
  const bounds = [
    [Math.max(b[0][0], CROP_BOX.latMin), Math.max(b[0][1], CROP_BOX.lonMin)],
    [Math.min(b[1][0], CROP_BOX.latMax), Math.min(b[1][1], CROP_BOX.lonMax)],
  ];
  gm = {nx: nx, ny: ny, loc: loc, bounds: bounds, warp: buildWarp(loc, nx, ny, bounds, OVERLAY_W)};
  _geomCache.set(g, gm);
  return gm;
}

// Height of the header for the stylesheet (--top-real): the map buttons and
// the toast sit right under it, and on phones it has two rows.
function syncTop(){
  const tb=document.getElementById('topbar');
  if(!tb)return;
  const h=tb.getBoundingClientRect().bottom;
  if(h>0)document.documentElement.style.setProperty('--top-real',Math.round(h)+'px');
}
window.addEventListener('resize',syncTop);

// ══════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════
function initApp(){
  document.getElementById('prog').style.display='none';
  document.getElementById('topbar').style.display='flex';
  document.getElementById('layers').style.display='flex';
  document.getElementById('controls').style.display='flex';
  document.getElementById('legend').style.display='block';

  syncTop();

  // Re-init protection: initApp() is re-run whenever the user switches dataset.
  // Leaflet refuses to init a second map on the same container, so destroy the
  // previous map (and its event listeners) before building a new one. The view
  // is kept: all datasets cover the same area.
  let keepView=null;
  if(map){
    keepView={c:map.getCenter(),z:map.getZoom()};
    if(smoothZoomOff){smoothZoomOff();smoothZoomOff=null;}
    map.off();
    map.remove();
    map=null;
  }
  // Reset render targets so a re-init builds fresh ones (render() reads these).
  imgOv=null; isoSvg=null; offCanvas=null;

  const m=metadata;

  // zoomSnap 0.1: fitBounds can fill the free area between the header and
  // the bottom panel instead of dropping to the next whole zoom level.
  // Leaflet's own wheel zoom is off: initSmoothZoom() replaces it.
  map=L.map('map',{center:[49.8,14.5],zoom:7,zoomControl:false,zoomSnap:0.1,
                   minZoom:3,maxZoom:13,scrollWheelZoom:false});

  // --- Samotný podklad: jeden, jednoduchý, bez filtru -------------------------
  // Esri "World Light Gray Canvas" — neutrální šedo-bílý podklad, který záměrně
  // nekrade barvy teplotní vizualizace. Zdarma, bez API klíče, bez registrace.
  // (Carto Positron vyžadoval placený klíč; barevný OSM standard kazil grading.)
  // Credit text as Esri states it for this layer (item ed712cb1db3e4bae9e85329040fb9a49).
  // The layer is a legacy basemap that Esri retires in December 2029.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',{
    attribution:'Powered by <a href="https://www.esri.com" target="_blank" rel="noopener">Esri</a> | Sources: Esri, HERE, Garmin, &copy; OpenStreetMap contributors, and the GIS User Community'
  }).addTo(map);
  L.control.zoom({position:'topright'}).addTo(map);
  if(typeof initLocate==='function')initLocate(map);     // "my location" button (js/locate.js)
  smoothZoomOff=initSmoothZoom(map);
  // Data-source attribution of the driver on the map (js/credits.js).
  if(typeof updateCredits==='function')updateCredits();

  // Where the grid lies on the map, and the canvas the forecast is painted on.
  geom=gridGeomFor(gridData,m.nx,m.ny);
  offCanvas=document.createElement('canvas');
  offCanvas.width=geom.warp.W;
  offCanvas.height=geom.warp.H;
  const bounds=geom.bounds;
  imgOv=new CanvasOverlay(offCanvas,bounds,{opacity:0.65,interactive:false});
  imgOv.addTo(map);

  isoSvg=L.svg({pane:'overlayPane'}).addTo(map);
  const svgEl=isoSvg._container;
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','isobar-layer');
  svgEl.appendChild(g);

  // First load: fit the domain into the part of the map that the header and
  // the bottom panel leave free (both are already visible and filled at this
  // point). After a dataset switch: stay where the user was.
  updateLegend();
  if(keepView&&firstFitDone){
    map.setView(keepView.c,keepView.z,{animate:false});
  }else{
    const topH=document.getElementById('topbar').getBoundingClientRect().bottom;
    const botH=window.innerHeight-document.getElementById('controls').getBoundingClientRect().top;
    map.fitBounds(bounds,{paddingTopLeft:[6,topH+6],paddingBottomRight:[6,botH+6]});
    firstFitDone=true;
  }

  // Inicializovat hranice ČR a logo
  if(typeof initBoundaryLayer === 'function'){
    initBoundaryLayer(map);
  }
  if(typeof initLogoOverlay === 'function'){
    initLogoOverlay(map);
  }

  // Value read-out (js/tooltip.js): hover follows the mouse, a click pins.
  map.on('mousemove',onHover);
  map.on('click',onMapClick);
  map.on('dblclick',onMapDblClick);
  map.on('mouseout',hideHover);
  map.on('move zoom moveend zoomend resize',placePinnedTip);
  map.on('zoomanim',hidePinnedTip);
  if(typeof restorePin==='function')restorePin();

  _shownTs=null;             // a new canvas: the step on screen must be painted again
  showTime();
  drawCover();

  // Aktualizovat dataset switcher po inicializaci
  if(typeof updateDatasetSwitcher === 'function'){
    updateDatasetSwitcher();
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  SMOOTH WHEEL / TOUCHPAD ZOOM
//  Leaflet's wheel handler collects wheel events for 40 ms and then starts a
//  250 ms animated jump. A touchpad sends a stream of small events, so the map
//  jerks from jump to jump and overshoots. Here every event only moves a goal
//  zoom; the map follows it frame by frame, and the point under the cursor
//  stays under the cursor. A pinch on a touchpad arrives as wheel + ctrlKey
//  (Chrome, Firefox, Edge) or as gesture events (Safari on a Mac).
//  Returns a function that removes the listeners (the #map element outlives
//  the Leaflet map across dataset switches).
// ══════════════════════════════════════════════════════════════════════════
function initSmoothZoom(map){
  const el=map.getContainer();
  const ctl=new AbortController();
  let active=false,goal=0,raf=0,anchor=null,anchorLL=null,pinch0=0;

  function finish(){
    if(!active)return;
    active=false;
    cancelAnimationFrame(raf);
    map._moveEnd(true);
  }
  function frame(){
    if(!active)return;
    if(map._animatingZoom){active=false;return;}      // Leaflet took over (+/− button)
    const z=map.getZoom(),d=goal-z;
    const nz=Math.abs(d)<0.004?goal:z+d*0.3;
    const half=map.getSize().divideBy(2);
    const c=map.unproject(map.project(anchorLL,nz).subtract(anchor.subtract(half)),nz);
    map._move(c,nz);
    if(nz===goal){finish();return;}
    raf=requestAnimationFrame(frame);
  }
  function aim(e,newGoal){
    if(!active){
      if(map._animatingZoom)return false;
      map._stop();
      goal=map.getZoom();
      active=true;
      map._moveStart(true,false);
      raf=requestAnimationFrame(frame);
    }
    anchor=map.mouseEventToContainerPoint(e);
    anchorLL=map.containerPointToLatLng(anchor);
    goal=Math.max(map.getMinZoom(),Math.min(map.getMaxZoom(),newGoal(goal)));
    return true;
  }

  el.addEventListener('wheel',function(e){
    e.preventDefault();
    let dy=e.deltaY;
    if(e.deltaMode===1)dy*=33;            // lines (Firefox mouse wheel)
    else if(e.deltaMode===2)dy*=300;      // pages
    if(!dy)return;
    dy=Math.max(-240,Math.min(240,dy));
    // One zoom level per 240 px of scrolling; a pinch sends much smaller
    // numbers, so it gets one level per 50.
    const perLevel=e.ctrlKey?50:240;
    aim(e,g=>g-dy/perLevel);
  },{passive:false,signal:ctl.signal});

  // Safari on a Mac reports a touchpad pinch as gesture events. Phones and
  // tablets also fire them, but there Leaflet's touch zoom does the work.
  if(!navigator.maxTouchPoints){
    el.addEventListener('gesturestart',function(e){e.preventDefault();pinch0=map.getZoom();},{signal:ctl.signal});
    el.addEventListener('gesturechange',function(e){
      e.preventDefault();
      if(e.scale>0)aim(e,()=>pinch0+Math.log2(e.scale));
    },{signal:ctl.signal});
    el.addEventListener('gestureend',function(e){e.preventDefault();},{signal:ctl.signal});
  }

  // A drag or a tap ends the glide at once, so it never fights the pan.
  el.addEventListener('mousedown',finish,{capture:true,signal:ctl.signal});
  el.addEventListener('touchstart',finish,{capture:true,passive:true,signal:ctl.signal});

  return function(){active=false;cancelAnimationFrame(raf);ctl.abort();};
}

// ══════════════════════════════════════════════════════════════════════════
//  MARCHING SQUARES
// ══════════════════════════════════════════════════════════════════════════
function marchingSquares(data,nx,ny,threshold){
  const segs=[];
  function interp(ax,ay,av,bx,by,bv){
    const t=(threshold-av)/(bv-av);
    return{x:ax+t*(bx-ax),y:ay+t*(by-ay)};
  }
  for(let row=0;row<ny-1;row++){
    for(let col=0;col<nx-1;col++){
      const vSW=data[row*nx+col];
      const vSE=data[row*nx+col+1];
      const vNW=data[(row+1)*nx+col];
      const vNE=data[(row+1)*nx+col+1];
      if([vSW,vSE,vNW,vNE].some(v=>v<=-999))continue;

      const sw=vSW>=threshold?1:0;
      const se=vSE>=threshold?1:0;
      const ne=vNE>=threshold?1:0;
      const nw=vNW>=threshold?1:0;
      const idx=(sw<<3)|(se<<2)|(ne<<1)|nw;
      if(idx===0||idx===15)continue;

      const S=()=>interp(col,row,vSW,col+1,row,vSE);
      const N=()=>interp(col,row+1,vNW,col+1,row+1,vNE);
      const W=()=>interp(col,row,vSW,col,row+1,vNW);
      const E=()=>interp(col+1,row,vSE,col+1,row+1,vNE);

      const draw=(a,b)=>{const pa=a(),pb=b();segs.push({x1:pa.x,y1:pa.y,x2:pb.x,y2:pb.y});};
      switch(idx){
        case 1:draw(W,N);break;
        case 2:draw(N,E);break;
        case 3:draw(W,E);break;
        case 4:draw(S,E);break;
        case 5:draw(W,S);draw(N,E);break;
        case 6:draw(N,S);break;
        case 7:draw(W,S);break;
        case 8:draw(W,S);break;
        case 9:draw(N,S);break;
        case 10:draw(W,N);draw(S,E);break;
        case 11:draw(S,E);break;
        case 12:draw(W,E);break;
        case 13:draw(N,E);break;
        case 14:draw(W,N);break;
      }
    }
  }
  return segs;
}

function smooth(data,nx,ny){
  const out=new Float32Array(data.length);
  for(let r=0;r<ny;r++){
    for(let c=0;c<nx;c++){
      let sum=0,cnt=0;
      for(let dr=-1;dr<=1;dr++){
        for(let dc=-1;dc<=1;dc++){
          const rr=r+dr,cc=c+dc;
          if(rr>=0&&rr<ny&&cc>=0&&cc<nx){
            const v=data[rr*nx+cc];
            if(v>-999){sum+=v;cnt++;}
          }
        }
      }
      out[r*nx+c]=cnt>0?sum/cnt:data[r*nx+c];
    }
  }
  return out;
}

function renderIsolinesSVG(ts){
  return; 
}

// ══════════════════════════════════════════════════════════════════════════
//  RENDER
//  Every pixel of the overlay canvas knows which four grid points surround it
//  (geom.warp, js/geo.js). The value is interpolated between them and then
//  coloured, so the picture is exact on the Mercator base map for any grid.
// ══════════════════════════════════════════════════════════════════════════
let _shadeTemp=null,_shadePrec=null,_frame=null,_framePx=null;

function render(){
  if(!allTimesteps.length||!offCanvas||!geom)return;
  const ts=allTimesteps[step];
  const dat=ts&&ts[varName];
  if(!dat)return;
  const isTmp=varName==='temp_c';
  if(!_shadeTemp){_shadeTemp=makeShader(TEMP_STOPS,false);_shadePrec=makeShader(PREC_STOPS,true);}
  const shade=isTmp?_shadeTemp:_shadePrec;

  const wp=geom.warp,W=wp.W,H=wp.H,nx=wp.nx,idx=wp.idx,fu=wp.fu,fv=wp.fv,cov=wp.cov;
  const ctx=offCanvas.getContext('2d');
  if(!_frame||_frame.width!==W||_frame.height!==H){
    _frame=ctx.createImageData(W,H);
    _framePx=new Uint32Array(_frame.data.buffer);
  }
  const px=_framePx;
  for(let p=0,n=W*H;p<n;p++){
    const k=idx[p];
    if(k<0){px[p]=0;continue;}
    const u=fu[p],v=fv[p];
    const v00=dat[k],v10=dat[k+1],v01=dat[k+nx],v11=dat[k+nx+1];
    let val;
    if(v00<=-999||v10<=-999||v01<=-999||v11<=-999){
      // A missing neighbour: take the nearest point as it is.
      val=v<0.5?(u<0.5?v00:v10):(u<0.5?v01:v11);
    }else{
      val=(1-v)*((1-u)*v00+u*v10)+v*((1-u)*v01+u*v11);
    }
    let c=shade(val);
    const cv=cov[p];
    if(cv!==255&&c!==0){                       // rim of the domain: fade the alpha
      c=((c&0x00ffffff)|(((c>>>24)*cv/255)<<24))>>>0;
    }
    px[p]=c;
  }
  ctx.putImageData(_frame,0,0);

  // Temperature covers the whole domain, so it stays translucent to keep the
  // base map readable; precipitation covers only where it rains and has its
  // own alpha in PREC_STOPS.
  imgOv.setOpacity(isTmp?0.65:0.92);

  renderIsolinesSVG(ts);
}
