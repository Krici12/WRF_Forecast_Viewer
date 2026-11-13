// ══════════════════════════════════════════════════════════════════════════
//  LOCATE — position of the device that is looking at the page
//  Loaded after tooltip.js. initLocate(map) is called from initApp() (map.js)
//  for every new map, i.e. also after a dataset switch.
//
//  A button under the zoom buttons asks the browser for the position (the
//  browser asks the user for permission). The place gets a blue dot with a
//  circle of the reported accuracy, the map moves there and the value box is
//  pinned on the grid point at that place. A second click removes the dot.
//  The position stays in this browser: it is not sent anywhere and not stored.
// ══════════════════════════════════════════════════════════════════════════
let myPos=null;         // {lat, lon, acc} kept for the page visit (across dataset switches)
let myLayer=null;
let _locBtn=null,_toastTmr=0;

function toast(msg){
  const t=document.getElementById('toast');
  if(!t)return;
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(_toastTmr);
  _toastTmr=setTimeout(()=>t.classList.remove('show'),4500);
}

function initLocate(map){
  const Ctl=L.Control.extend({
    options:{position:'topright'},
    onAdd:function(){
      const box=L.DomUtil.create('div','leaflet-bar leaflet-control locate-ctl');
      const a=L.DomUtil.create('a','locate-btn',box);
      a.href='#';
      a.setAttribute('role','button');
      a.innerHTML='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">'+
        '<circle cx="12" cy="12" r="6.2" fill="none" stroke="currentColor" stroke-width="2"/>'+
        '<circle cx="12" cy="12" r="2.4" fill="currentColor"/>'+
        '<path d="M12 2v3.4M12 18.6V22M2 12h3.4M18.6 12H22" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      L.DomEvent.disableClickPropagation(box);
      L.DomEvent.on(a,'click',function(e){L.DomEvent.preventDefault(e);toggleLocate();});
      _locBtn=a;
      return box;
    }
  });
  new Ctl().addTo(map);
  myLayer=null;
  drawMyPos(false);
}

function locateState(){
  if(!_locBtn)return;
  _locBtn.classList.toggle('on',!!myPos);
  const t=myPos?'Hide my location':'Show my location';
  _locBtn.title=t;
  _locBtn.setAttribute('aria-label',t);
}

function toggleLocate(){
  if(myPos){myPos=null;drawMyPos(false);return;}
  if(!navigator.geolocation){toast('This browser cannot tell its location.');return;}
  if(_locBtn)_locBtn.classList.add('busy');
  navigator.geolocation.getCurrentPosition(function(p){
    if(_locBtn)_locBtn.classList.remove('busy');
    myPos={lat:p.coords.latitude,lon:p.coords.longitude,acc:p.coords.accuracy||0};
    drawMyPos(true);
  },function(err){
    if(_locBtn)_locBtn.classList.remove('busy');
    toast(err&&err.code===1?'Location is not allowed for this page in your browser.'
                           :'Your location is not available right now.');
  },{enableHighAccuracy:false,timeout:15000,maximumAge:300000});
}

// Draw (or remove) the dot. focus = the position has just arrived: go there
// and pin the grid point of the place.
function drawMyPos(focus){
  if(myLayer){myLayer.remove();myLayer=null;}
  locateState();
  if(!myPos||!map)return;
  if(!map.getPane('mePane')){
    const pane=map.createPane('mePane');
    pane.style.zIndex=730;                 // above the ring of the pinned grid point (720), which sits at almost the same place
    pane.style.pointerEvents='none';
  }
  const ll=L.latLng(myPos.lat,myPos.lon);
  myLayer=L.layerGroup([
    L.circle(ll,{pane:'mePane',interactive:false,radius:Math.max(myPos.acc,1),
      color:'#0b5fc0',weight:1,opacity:0.5,fillColor:'#0b5fc0',fillOpacity:0.12}),
    L.marker(ll,{pane:'mePane',interactive:false,keyboard:false,
      icon:L.divIcon({className:'me-dot',iconSize:[14,14],iconAnchor:[7,7]})}),
  ]).addTo(map);
  if(!focus)return;
  const info=(typeof probe==='function')?probe(ll):null;
  if(!info){toast('Your location is outside the forecast area.');return;}
  map.setView(ll,Math.max(map.getZoom(),8.5),{animate:false});
  pinLL=ll;
  setPin(info);
}
