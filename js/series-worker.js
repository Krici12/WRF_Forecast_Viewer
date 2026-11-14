// ══════════════════════════════════════════════════════════════════════════
//  SERIES WORKER — reads one chunk file and returns the values of one grid
//  point (js/ensemble.js). A WRF chunk is 8 MB of JSON; parsing it here keeps
//  the page responsive, and the big arrays are dropped right after the point
//  was read.
//  in : {id, url, k}            url must be absolute (a worker resolves
//                               relative addresses against its own file)
//  out: {id, ok, steps: [{ms, t, p}]}  or  {id, ok: false, error}
// ══════════════════════════════════════════════════════════════════════════
self.onmessage = async function(e){
  const job = e.data;
  try{
    const r = await fetch(job.url);
    if(!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    const steps = (j.timesteps || []).map(function(ts){
      return {
        ms: Date.parse(String(ts.time).slice(0, 19) + 'Z'),
        t:  ts.temp_c    ? ts.temp_c[job.k]    : null,
        p:  ts.precip_mm ? ts.precip_mm[job.k] : null
      };
    });
    self.postMessage({id: job.id, ok: true, steps: steps});
  }catch(err){
    self.postMessage({id: job.id, ok: false, error: String((err && err.message) || err)});
  }
};
