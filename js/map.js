// ══════════════════════════════════════════════════════════════════════════
//  MAP — inicializace mapy a rendering rastru
//  Načítá se PŘED hlavním <script> blokem v index.html (za js/data.js).
//  Obsahuje: initApp, getGridBounds, render (+ mrtvé izobarové pomocné funkce
//  marchingSquares/smooth/renderIsolinesSVG, které tu zůstávají jen pro úplnost).
//  Odkazuje na globály z hlavního bloku (metadata, gridData, allTimesteps, step,
//  varName, offCanvas, imgOv, map, isoSvg) a volá buildTicks/setStep/updateLegend/
//  onHover (hlavní blok) a getColor (colors.js) — vše až za běhu.
//  initApp() volá js/data.js po načtení dat.
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════════════════════
function initApp(){
  document.getElementById('prog').style.display='none';
  document.getElementById('topbar').style.display='flex';
  document.getElementById('layers').style.display='flex';
  document.getElementById('controls').style.display='flex';
  document.getElementById('legend').style.display='block';

  // Re-init protection: initApp() is re-run whenever the user switches dataset.
  // Leaflet refuses to init a second map on the same container, so destroy the
  // previous map (and its event listeners) before building a new one.
  if(map){
    map.off();
    map.remove();
    map=null;
  }
  // Reset render targets so a re-init builds fresh ones (render() reads these).
  imgOv=null; isoSvg=null; offCanvas=null;

  const m=metadata;
  document.getElementById('m-run').textContent=m.run_time||m.run_dir;
  document.getElementById('m-dom').textContent=`D0${m.domain}`;
  document.getElementById('m-dx').textContent=`${m.dx_m/1000} km`;
  document.getElementById('m-n').textContent=m.n_timesteps;

  const sl=document.getElementById('slider');
  sl.max=m.n_timesteps-1;
  sl.value=0;
  buildTicks();

  map=L.map('map',{center:[49.8,14.5],zoom:7,zoomControl:false});

  // --- Samotný podklad: jeden, jednoduchý, bez filtru -------------------------
  // Esri "World Light Gray Canvas" — neutrální šedo-bílý podklad, který záměrně
  // nekrade barvy teplotní vizualizace. Zdarma, bez API klíče, bez registrace.
  // (Carto Positron vyžadoval placený klíč; barevný OSM standard kazil grading.)
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',{
    attribution:'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics'
  }).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
  // Data-source attribution of the driver on the map (js/credits.js).
  if(typeof updateCredits==='function')updateCredits();

  // Spočítat ořez na doménu WRF (pro hrubé "original" griddy).
  computeCrop();

  offCanvas=document.createElement('canvas');
  const dims=cropDims();
  offCanvas.width=dims.nx;
  offCanvas.height=dims.ny;

  const bounds=getGridBounds();
  imgOv=L.imageOverlay('',bounds,{opacity:0.65,interactive:false});
  imgOv.addTo(map);

  isoSvg=L.svg({pane:'overlayPane'}).addTo(map);
  const svgEl=isoSvg._container;
  const g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','isobar-layer');
  svgEl.appendChild(g);

  map.fitBounds(bounds);

  // Inicializovat hranice ČR a logo
  if(typeof initBoundaryLayer === 'function'){
    initBoundaryLayer(map);
  }
  if(typeof initLogoOverlay === 'function'){
    initLogoOverlay(map);
  }

  map.on('mousemove',onHover);
  map.on('mouseout',()=>{document.getElementById('tip').style.display='none';});
  map.on('moveend zoomend',render);

  setStep(0);
  updateLegend();

  // Aktualizovat dataset switcher po inicializaci
  if(typeof updateDatasetSwitcher === 'function'){
    updateDatasetSwitcher();
  }
}

// Obdélníkový (axis-aligned) rámeček domény, kterou skutečně počítá WRF na
// jemném gridu d02 (viz data/gfs_wrf/grid.json: lat 44.55–55.18, lon 5.76–23.69).
// Hrubé ("original") griddy pokrývají celý kontinent (lat 30–80, lon -15–60),
// proto se ořezávají právě na tuto doménu — aby se zobrazovala stejná oblast
// jako u jemných rastrů a mapa se neoddalovala přes celou Evropu.
const CROP_BOX = { latMin: 44.5, latMax: 55.2, lonMin: 5.7, lonMax: 23.7 };

// Vypočtený ořez aktuálního gridu (indexové okno + geografické bounds),
// nebo null, když je celý grid uvnitř CROP_BOX (pak se nic neořezává).
let crop = null;

// indexové okno gridu uvnitř CROP_BOX
function computeCrop(){
  crop = null;
  const g = gridData, nx = metadata.nx, ny = metadata.ny;
  let r0 = ny, r1 = -1, c0 = nx, c1 = -1;
  for (let r = 0; r < ny; r++) {
    const lat = g.lat[r * nx];            // lat je v řádku (u pravidelného gridu) konstantní
    if (lat >= CROP_BOX.latMin && lat <= CROP_BOX.latMax) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
  }
  for (let c = 0; c < nx; c++) {
    const lon = g.lon[c];                 // lon je ve sloupci konstantní
    if (lon >= CROP_BOX.lonMin && lon <= CROP_BOX.lonMax) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
  }
  if (r1 < r0 || c1 < c0) return;         // nic v rámečku -> bez ořezu

  // Bounds oříznutého okna (min/max přes rohy okna).
  const lats = [g.lat[r0*nx+c0], g.lat[r1*nx+c0], g.lat[r0*nx+c1], g.lat[r1*nx+c1]];
  const lons = [g.lon[r0*nx+c0], g.lon[r1*nx+c0], g.lon[r0*nx+c1], g.lon[r1*nx+c1]];
  crop = {
    row0: r0, row1: r1, col0: c0, col1: c1,
    bounds: [[Math.min(...lats), Math.min(...lons)], [Math.max(...lats), Math.max(...lons)]]
  };
}

// Rozměry rastru, který se má vykreslit (s ořezem, pokud existuje).
function cropDims(){
  return crop
    ? { nx: crop.col1 - crop.col0 + 1, ny: crop.row1 - crop.row0 + 1 }
    : { nx: metadata.nx, ny: metadata.ny };
}

function getGridBounds(){
  if (crop) return crop.bounds;
  const g=gridData;
  const nx=metadata.nx;
  const ny=metadata.ny;

  // Grid je uspořádaný jako row-major: index = row * nx + col
  // První řádek (row=0): col 0..nx-1 -> dolní levý až dolní pravý roh
  // Poslední řádek (row=ny-1): col 0..nx-1 -> horní levý až horní pravý roh

  // Využijeme úhlové body gridu pro přesné bounds
  const bl_idx = 0;                    // bottom-left: row=0, col=0
  const br_idx = nx - 1;               // bottom-right: row=0, col=nx-1
  const tl_idx = (ny - 1) * nx;        // top-left: row=ny-1, col=0
  const tr_idx = (ny - 1) * nx + nx - 1; // top-right: row=ny-1, col=nx-1

  const minLat = Math.min(g.lat[bl_idx], g.lat[tl_idx]);
  const maxLat = Math.max(g.lat[br_idx], g.lat[tr_idx]);
  const minLon = Math.min(g.lon[bl_idx], g.lon[tl_idx]);
  const maxLon = Math.max(g.lon[br_idx], g.lon[tr_idx]);

  return [[minLat, minLon], [maxLat, maxLon]];
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
// ══════════════════════════════════════════════════════════════════════════

function render(){
  if(!allTimesteps.length||!offCanvas)return;
  // Ořez: promítáme vždy plné rozměry gridu, ať je render konzistentní napříč
  // přepínáním datasetů (metadata.nx/ny zůstávají plné rozměry).
  const cnx=crop?crop.col1-crop.col0+1:metadata.nx;
  const cny=crop?crop.row1-crop.row0+1:metadata.ny;
  const srcNx=metadata.nx;
  const ts=allTimesteps[step];
  const dat=ts[varName];
  const ctx=offCanvas.getContext('2d');
  const nx=cnx,ny=cny;

  if(offCanvas.width!==nx||offCanvas.height!==ny){
    offCanvas.width=nx;offCanvas.height=ny;
  }

  const imgData=ctx.createImageData(nx,ny);
  const buf=imgData.data;

  // Iterace v souřadnicích OŘÍZNUTÉHO rastru (nx=cnx, ny=cny).
  // index = (row0 + rowoffset) * srcNx + (col0 + coloffset)
  const src0=((crop?crop.row0:0)*srcNx)+(crop?crop.col0:0);
  for(let rowoff=0;rowoff<ny;rowoff++){
    const srcRow=crop?crop.row1-rowoff:ny-1-rowoff;   // vertikálně zrcadlit (SW->SE->NW)
    for(let coloff=0;coloff<nx;coloff++){
      const srcCol=crop?(crop.col0+coloff):coloff;
      const srcIdx=srcRow*srcNx+srcCol;
      const val=dat[srcIdx];
      const c=getColor(val);
      const px=(rowoff*nx+coloff)*4;
      if(c&&c.a>0){
        buf[px]=c.r;buf[px+1]=c.g;
        buf[px+2]=c.b;buf[px+3]=c.a;
      }else{
        buf[px+3]=0;
      }
    }
  }
  ctx.putImageData(imgData,0,0);

  imgOv.setUrl(offCanvas.toDataURL('image/png'));

  // Použít oříznuté bounds (crop.bounds) nebo plné.
  imgOv.setBounds(crop?crop.bounds:getGridBounds());

  renderIsolinesSVG(ts);
}
