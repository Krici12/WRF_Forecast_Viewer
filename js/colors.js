// ══════════════════════════════════════════════════════════════════════════
//  COLORS — barevné funkce
//  Načítá se PŘED hlavním <script> blokem v index.html.
//  Závisí na globálních konstantách TEMP_STOPS / PREC_STOPS a globální proměnné
//  varName (definované v hlavním bloku) — čte je až při volání, takže tyto
//  funkce musí být globálně dostupné, ale jejich pořadí načtení je nezávislé.
// ══════════════════════════════════════════════════════════════════════════
function lerp(a,b,t){ return a+(b-a)*t; }
function colorAt(stops,v){
  if(v<=stops[0].v)return stops[0];
  const last=stops[stops.length-1];
  if(v>=last.v)return last;
  for(let i=0;i<stops.length-1;i++){
    if(v>=stops[i].v&&v<=stops[i+1].v){
      const t=(v-stops[i].v)/(stops[i+1].v-stops[i].v);
      return{
        r:Math.round(lerp(stops[i].r,stops[i+1].r,t)),
        g:Math.round(lerp(stops[i].g,stops[i+1].g,t)),
        b:Math.round(lerp(stops[i].b,stops[i+1].b,t)),
        a:Math.round(lerp(stops[i].a,stops[i+1].a,t)),
      };
    }
  }
}
function getColor(v){
  if(v<=-999)return null;
  return colorAt(varName==='temp_c'?TEMP_STOPS:PREC_STOPS,v);
}

// Fast variant for the renderer: shader(v) returns the colour as one 32-bit
// number in the byte order of a little-endian Uint32Array over ImageData
// (A B G R), 0 for "nothing to draw". Same piecewise-linear ramp as colorAt,
// read from a table of 4096 colours instead of being computed for each of the
// half a million pixels of a frame. sqrtAxis spaces the table evenly in
// sqrt(v): precipitation needs its resolution at the low end (0.05–1 mm/h).
function makeShader(stops,sqrtAxis){
  const N=4096,n=stops.length;
  const f=sqrtAxis?Math.sqrt:(v=>v);
  const a0=f(stops[0].v),a1=f(stops[n-1].v),k=(N-1)/(a1-a0);
  const lut=new Uint32Array(N);
  for(let i=0;i<N;i++){
    const a=a0+i/(N-1)*(a1-a0);
    const c=colorAt(stops,sqrtAxis?a*a:a);
    lut[i]=c.a<=0?0:(((c.a&255)<<24)|((c.b&255)<<16)|((c.g&255)<<8)|(c.r&255))>>>0;
  }
  const v0=stops[0].v,v1=stops[n-1].v,lo=lut[0],hi=lut[N-1];
  return sqrtAxis
    ? function(v){ return v<=-999?0:v<=v0?lo:v>=v1?hi:lut[((Math.sqrt(v)-a0)*k+0.5)|0]; }
    : function(v){ return v<=-999?0:v<=v0?lo:v>=v1?hi:lut[((v-a0)*k+0.5)|0]; };
}
