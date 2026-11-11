// ══════════════════════════════════════════════════════════════════════════
//  GEO — grid geometry: where a grid cell lies on the map and back.
//  Loaded before map.js. No globals from the main block are needed.
//
//  Why: the WRF grid is a Lambert conformal grid (its southern edge spans
//  lon 7.3–21.8°E, the northern one 5.8–23.7°E) and the base map is Web
//  Mercator. Stretching the raster between four corners (what the page did
//  until 2026-11-11) put cells up to ~200 km off near the edges, and even
//  the regular lat/lon grids of the drivers were ~30 km off in the middle,
//  because Mercator is not linear in latitude. Now every pixel of the overlay
//  is looked up in the grid, so the data sit where they belong.
//
//  The projection is never assumed: the inverse (lat, lon) -> (col, row) is
//  solved numerically from the lat/lon arrays of grid.json (Newton iteration
//  on the bilinear cell mapping), so any smooth grid works: Lambert, rotated,
//  regular lat/lon.
//
//  makeLocator(grid, nx, ny) -> {
//    fwd(x, y)        -> [lat, lon] of fractional (col x, row y); extrapolates
//    inv(lat, lon)    -> [x, y] fractional (col, row), or null when not solvable
//    nearest(lat,lon) -> {i, j, k} of the cell that contains the point, or null
//    cell(i, j)       -> four [lat, lon] corners of the cell (i, j)
//    bounds()         -> [[south, west], [north, east]] of the cell areas
//  }
//  buildWarp(loc, nx, ny, bounds, W) -> lookup table for the overlay canvas
// ══════════════════════════════════════════════════════════════════════════

function makeLocator(g, nx, ny){
  const LAT = g.lat, LON = g.lon;
  const out = [0, 0];

  // Bilinear position of fractional (x, y); outside the grid the edge cell is
  // extended linearly, which is what the half-cell rim and Newton need.
  function fwd(x, y){
    let i = Math.floor(x), j = Math.floor(y);
    if(i < 0) i = 0; else if(i > nx - 2) i = nx - 2;
    if(j < 0) j = 0; else if(j > ny - 2) j = ny - 2;
    const u = x - i, v = y - j, k = j * nx + i;
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v;
    return [
      w00 * LAT[k] + w10 * LAT[k + 1] + w01 * LAT[k + nx] + w11 * LAT[k + nx + 1],
      w00 * LON[k] + w10 * LON[k + 1] + w01 * LON[k + nx] + w11 * LON[k + nx + 1],
    ];
  }

  // Newton iteration from the guess (x0, y0). Writes into `out`; returns false
  // when it does not settle (a point far outside the grid).
  function solve(lat, lon, x0, y0){
    let x = x0, y = y0;
    for(let it = 0; it < 30; it++){
      let i = Math.floor(x), j = Math.floor(y);
      if(i < 0) i = 0; else if(i > nx - 2) i = nx - 2;
      if(j < 0) j = 0; else if(j > ny - 2) j = ny - 2;
      const u = x - i, v = y - j, k = j * nx + i;
      const a00 = LON[k], a10 = LON[k + 1], a01 = LON[k + nx], a11 = LON[k + nx + 1];
      const b00 = LAT[k], b10 = LAT[k + 1], b01 = LAT[k + nx], b11 = LAT[k + nx + 1];
      const lo = (1 - u) * (1 - v) * a00 + u * (1 - v) * a10 + (1 - u) * v * a01 + u * v * a11;
      const la = (1 - u) * (1 - v) * b00 + u * (1 - v) * b10 + (1 - u) * v * b01 + u * v * b11;
      const loU = (1 - v) * (a10 - a00) + v * (a11 - a01), loV = (1 - u) * (a01 - a00) + u * (a11 - a10);
      const laU = (1 - v) * (b10 - b00) + v * (b11 - b01), laV = (1 - u) * (b01 - b00) + u * (b11 - b10);
      const det = loU * laV - loV * laU;
      if(!det) return false;
      const rlo = lon - lo, rla = lat - la;
      const du = (rlo * laV - loV * rla) / det, dv = (loU * rla - rlo * laU) / det;
      x += du; y += dv;
      if(!(Math.abs(x) < 1e7 && Math.abs(y) < 1e7)) return false;   // also catches NaN
      if(Math.abs(du) + Math.abs(dv) < 1e-4){ out[0] = x; out[1] = y; return true; }
    }
    return false;
  }

  function inv(lat, lon){
    return solve(lat, lon, (nx - 1) / 2, (ny - 1) / 2) ? [out[0], out[1]] : null;
  }

  // The cell whose area contains the point (a cell reaches half a step around
  // its centre), or null outside the grid.
  function nearest(lat, lon){
    if(!solve(lat, lon, (nx - 1) / 2, (ny - 1) / 2)) return null;
    const i = Math.round(out[0]), j = Math.round(out[1]);
    if(i < 0 || j < 0 || i > nx - 1 || j > ny - 1) return null;
    return {i: i, j: j, k: j * nx + i};
  }

  function cell(i, j){
    return [fwd(i - 0.5, j - 0.5), fwd(i + 0.5, j - 0.5), fwd(i + 0.5, j + 0.5), fwd(i - 0.5, j + 0.5)];
  }

  // Box around the outer edges of the rim cells.
  function bounds(){
    let s = 90, n = -90, w = 180, e = -180;
    function eat(p){
      if(p[0] < s) s = p[0]; if(p[0] > n) n = p[0];
      if(p[1] < w) w = p[1]; if(p[1] > e) e = p[1];
    }
    for(let i = 0; i <= nx; i++){ eat(fwd(i - 0.5, -0.5)); eat(fwd(i - 0.5, ny - 0.5)); }
    for(let j = 0; j <= ny; j++){ eat(fwd(-0.5, j - 0.5)); eat(fwd(nx - 0.5, j - 0.5)); }
    return [[s, w], [n, e]];
  }

  return {fwd: fwd, inv: inv, nearest: nearest, cell: cell, bounds: bounds, solve: solve, out: out, nx: nx, ny: ny};
}

// Web Mercator ordinate of a latitude in degrees, and back.
function mercY(lat){ return Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)); }
function mercLat(y){ return (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180 / Math.PI; }

// Lookup table for an overlay canvas of width W that covers `bounds`
// ([[south, west], [north, east]]). The canvas is linear in longitude and in
// the Mercator ordinate, which is exactly how Leaflet stretches an overlay
// between its bounds. For every pixel: idx = index of the lower-left of the
// four grid points around it (-1 outside the grid), fu / fv = weights for
// the bilinear interpolation, cov = how much of the pixel lies inside the
// grid (255 = all of it; less along the rim, so the slanted edge of the
// domain is smooth instead of a staircase).
function buildWarp(loc, nx, ny, bounds, W){
  const s = bounds[0][0], w = bounds[0][1], n = bounds[1][0], e = bounds[1][1];
  const yS = mercY(s), yN = mercY(n);
  const lonSpan = (e - w) * Math.PI / 180;
  const H = Math.max(1, Math.round(W * (yN - yS) / lonSpan));
  const idx = new Int32Array(W * H), fu = new Float32Array(W * H), fv = new Float32Array(W * H);
  const cov = new Uint8Array(W * H);
  const cx = (nx - 1) / 2, cy = (ny - 1) / 2;
  const out = loc.out;
  // Size of one canvas pixel in grid cells (measured in the middle of the canvas).
  let px1 = 1;
  {
    const latM = mercLat((yS + yN) / 2), lonM = (w + e) / 2, dLon = (e - w) / W;
    if(loc.solve(latM, lonM, cx, cy)){
      const x0 = out[0], y0 = out[1];
      if(loc.solve(latM, lonM + dLon, x0, y0)) px1 = Math.hypot(out[0] - x0, out[1] - y0) || 1;
    }
  }
  for(let py = 0; py < H; py++){
    const lat = mercLat(yN - (py + 0.5) / H * (yN - yS));
    let gx = cx, gy = cy;                       // warm start: the previous pixel
    for(let px = 0; px < W; px++){
      const p = py * W + px;
      const lon = w + (px + 0.5) / W * (e - w);
      if(!loc.solve(lat, lon, gx, gy)){ idx[p] = -1; gx = cx; gy = cy; continue; }
      let x = out[0], y = out[1];
      gx = x; gy = y;
      // Distance to the nearest outer edge of the grid, in canvas pixels
      // (positive inside). Half a pixel either side of the edge is blended.
      const d = Math.min(x + 0.5, nx - 0.5 - x, y + 0.5, ny - 0.5 - y) / px1 + 0.5;
      if(d <= 0){ idx[p] = -1; continue; }
      cov[p] = d >= 1 ? 255 : Math.round(d * 255);
      if(x < 0) x = 0; else if(x > nx - 1) x = nx - 1;     // rim half-cell: hold the edge value
      if(y < 0) y = 0; else if(y > ny - 1) y = ny - 1;
      let i = Math.floor(x), j = Math.floor(y);
      if(i > nx - 2) i = nx - 2;
      if(j > ny - 2) j = ny - 2;
      idx[p] = j * nx + i; fu[p] = x - i; fv[p] = y - j;
    }
  }
  return {W: W, H: H, idx: idx, fu: fu, fv: fv, cov: cov, nx: nx, bounds: bounds};
}
