"""Headless-Chrome check of the viewer page (stdlib only, Chrome DevTools protocol).

Needs a Chrome with remote debugging on 127.0.0.1:9222, e.g.
    docker run -d --rm --name viewer-chrome --network host chromedp/headless-shell:latest
(stop it afterwards: docker stop viewer-chrome)

usage: python3 tools/dev/check_page.py <page-url> <width> <height> <out-prefix> [dataset-id-to-switch-to]
  e.g. python3 tools/dev/check_page.py http://127.0.0.1:8765/index.html 390 700 /tmp/shots/phone gem_wrf

Prints the on-screen rectangles of the header, panel, legend and forecast raster
plus the visible texts (LOADED / PRECIP / PLAY / SPEED / TIP / MARGIN / LOCATE / COMPACT /
PANEL / SWITCH / BACK), JS exceptions and console errors, and writes
<out-prefix>_{map,precip,tip,locate,compact,panel,panel2,switch}.png.
TIME checks (fixed axis, 2026-11-13): LOADED.onNow says the page opened at the present
hour; SWITCH / BACK print the time on screen after switching to the given dataset and
back to the first one (it must not change on an hourly dataset); MARGIN says whether the
value box stays away near the zoom buttons; LOCATE uses a faked position in Prague.
LOADED.reg is the registration check: the largest distance, in grid cells, between a
grid point's true place on the screen and the grid point its overlay pixel was painted
from (about 1 or less is right; the four-corner stretch used before 2026-11-11 gave 40+).
Widths below 800 px are emulated as a phone at 2x.
"""
import base64, json, os, socket, struct, sys, time, urllib.request

class WS:
    def __init__(self, url):
        host, rest = url[5:].split("/", 1); h, p = host.split(":")
        self.s = socket.create_connection((h, int(p)), timeout=60)
        key = base64.b64encode(os.urandom(16)).decode()
        self.s.sendall((f"GET /{rest} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                        f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n").encode())
        buf = b""
        while b"\r\n\r\n" not in buf: buf += self.s.recv(4096)
        assert b" 101 " in buf.split(b"\r\n")[0], buf[:200]
        self.id = 0
    def _recvn(self, n):
        b = b""
        while len(b) < n:
            c = self.s.recv(n - len(b)); assert c; b += c
        return b
    def send(self, obj):
        d = json.dumps(obj).encode(); mask = os.urandom(4)
        hdr = b"\x81"
        if len(d) < 126: hdr += bytes([0x80 | len(d)])
        elif len(d) < 65536: hdr += bytes([0x80 | 126]) + struct.pack(">H", len(d))
        else: hdr += bytes([0x80 | 127]) + struct.pack(">Q", len(d))
        self.s.sendall(hdr + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(d)))
    def recv(self):
        data = b""
        while True:
            b1, b2 = self._recvn(2); n = b2 & 0x7F
            if n == 126: n = struct.unpack(">H", self._recvn(2))[0]
            elif n == 127: n = struct.unpack(">Q", self._recvn(8))[0]
            data += self._recvn(n)
            if b1 & 0x80: return json.loads(data)
    def call(self, method, **params):
        self.id += 1; self.send({"id": self.id, "method": method, "params": params})
        while True:
            m = self.recv()
            if m.get("id") == self.id:
                assert "error" not in m, m
                return m["result"]
            if m.get("method") in ("Runtime.exceptionThrown",):
                print("JS EXCEPTION:", json.dumps(m["params"])[:400])
            if m.get("method") == "Runtime.consoleAPICalled" and m["params"]["type"] in ("error", "warning"):
                print("CONSOLE", m["params"]["type"], json.dumps(m["params"]["args"])[:300])

url, w, h, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), sys.argv[4]
req = urllib.request.Request("http://127.0.0.1:9222/json/new?about:blank", method="PUT")
tab = json.load(urllib.request.urlopen(req, timeout=20))
ws = WS(tab["webSocketDebuggerUrl"])
ws.call("Runtime.enable"); ws.call("Page.enable")
ws.call("Emulation.setDeviceMetricsOverride", width=w, height=h, deviceScaleFactor=2 if w < 800 else 1, mobile=w < 800)
ws.call("Page.navigate", url=url)
def ev(expr):
    r = ws.call("Runtime.evaluate", expression=expr, returnByValue=True, awaitPromise=True)
    return r["result"].get("value", r["result"])
deadline = time.time() + 90
while time.time() < deadline:
    time.sleep(2)
    if ev("typeof allTimesteps!=='undefined' && allTimesteps.length>0 && typeof map!=='undefined' && !!map && !!imgOv"): break
time.sleep(4)
def shot(name):
    png = ws.call("Page.captureScreenshot", format="png")["data"]
    open(f"{out}_{name}.png", "wb").write(base64.b64decode(png))
R = "(id => { const e = typeof id==='string' ? document.querySelector(id) : id; if(!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return cs.display==='none' ? 'hidden' : [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]; })"
info = """JSON.stringify({
  vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth,
  topbar: %(R)s('#topbar'), brand: %(R)s('.brand'), sub: %(R)s('.brand-sub'), logo: %(R)s('.brand-logo'),
  logoLoaded: document.querySelector('.brand-logo img').naturalWidth,
  select: %(R)s('#dataset-switcher'), layers: %(R)s('#layers'), chip: %(R)s('#m-src'),
  controls: %(R)s('#controls'), timeBlock: %(R)s('.time-block'), btns: %(R)s('.btn-group'), legend: %(R)s('#legend'), runinfo: %(R)s('.runinfo'), credit: %(R)s('.credit-line'),
  kv: %(R)s('.brand-kv'), zoom: %(R)s('.leaflet-control-zoom'), attr: %(R)s('.leaflet-control-attribution'),
  domain: %(R)s(imgOv.getElement()), zoomLevel: map.getZoom(),
  time: document.getElementById('t-display').innerText.replace(/\\n/g,' '), tsub: document.getElementById('t-sub').textContent,
  chipText: document.getElementById('m-src').textContent, creditText: document.querySelector('.credit-line').innerText,
  run: document.querySelector('.runinfo').innerText, legTitle: document.getElementById('leg-title').textContent,
  legLabs: document.getElementById('leg-labs').innerText.replace(/\\n/g,' '),
  dataset: currentDataset && currentDataset.id, options: [...document.getElementById('dataset-switcher').options].map(o=>o.textContent),
  steps: allTimesteps.length, terrain: !!terrain, hgtModel: gridData.hgt_model===true,
  axis: [new Date(axis.t0).toISOString().slice(0,16), new Date(axis.t1).toISOString().slice(0,16)], stepH: stepH,
  want: new Date(wantTime).toISOString().slice(0,16), shown: allTimesteps[step].time.slice(0,16),
  onNow: Math.abs(wantTime-Math.floor(Date.now()/3600000)*3600000)<1, slider: document.getElementById('slider').value+'/'+document.getElementById('slider').max,
  track: %(R)s('#track'), data: %(R)s('#trk-data'), loaded: [...document.querySelectorAll('.trk-seg')].map(e=>%(R)s(e)), now: %(R)s('#trk-now'),
  thumbX: (()=>{const sl=document.getElementById('slider'),r=sl.getBoundingClientRect(),th=parseFloat(getComputedStyle(sl.parentElement).getPropertyValue('--thumb'));return Math.round(r.left+th/2+(r.width-th)*sl.value/sl.max);})(),
  days: [...document.querySelectorAll('.day')].map(e=>e.innerText.trim()+'@'+Math.round(e.getBoundingClientRect().left)), btnStep: document.getElementById('btn-next').textContent,
  reg: (()=>{const g=gridData,nx=metadata.nx,ny=metadata.ny,wp=geom.warp,r=offCanvas.getBoundingClientRect();let worst=0;const st=Math.max(1,Math.floor(nx/29));
    for(let j=st;j<ny-st;j+=st)for(let i=st;i<nx-st;i+=st){const k=j*nx+i,q=map.latLngToContainerPoint([g.lat[k],g.lon[k]]);
      const t=Math.floor((q.y-r.top)/r.height*wp.H)*wp.W+Math.floor((q.x-r.left)/r.width*wp.W),kk=wp.idx[t];
      worst=Math.max(worst,kk<0?99:Math.hypot((kk%%nx)+wp.fu[t]-i,Math.floor(kk/nx)+wp.fv[t]-j));}
    return +worst.toFixed(2);})() })""" % {"R": R}
print("LOADED", ev(info)); shot("map")
t_first = ev("wantTime")
ev("setVar('precip_mm'); setStep(30)"); time.sleep(1)
print("PRECIP", ev("JSON.stringify({legTitle: document.getElementById('leg-title').textContent, legLabs: document.getElementById('leg-labs').innerText.replace(/\\n/g,' '), active: document.querySelector('.lbtn.active').id, time: document.getElementById('t-display').innerText.replace(/\\n/g,' '), tsub: document.getElementById('t-sub').textContent, slider: document.getElementById('slider').value})")); shot("precip")
ev("togglePlay()"); time.sleep(2.2)
print("PLAY  ", ev("JSON.stringify({cls: document.getElementById('playbtn').className, step: step})")); ev("togglePlay(); cycleSpeed()")
print("SPEED ", ev("JSON.stringify({spd: document.getElementById('spd').textContent, cls: document.getElementById('playbtn').className})"))
ev("setVar('temp_c')")
ev("(()=>{const r=imgOv.getElement().getBoundingClientRect(); const x=r.left+r.width*0.5, y=r.top+r.height*0.5; map.fire('click',{latlng: map.containerPointToLatLng([x,y]), originalEvent:{clientX:x, clientY:y}});})()"); time.sleep(0.5)
print("TIP   ", ev("JSON.stringify({rect: %s('#tip'), pinned: !!pinInfo, marker: %s('.probe-dot'), text: document.getElementById('tip').innerText.replace(/\\n/g,' ')})" % (R, R))); shot("tip")
ev("unpin()")
# Value box near the zoom buttons: 20 px left of them it must stay hidden, 80 px left it shows.
print("MARGIN", ev("""JSON.stringify((()=>{const z=document.querySelector('.leaflet-control-zoom'),r=z.getBoundingClientRect();
  if(!r.width)return 'no zoom buttons at this size';
  const at=(x,y)=>{map.fire('mousemove',{latlng:map.containerPointToLatLng([x,y]),originalEvent:{clientX:x,clientY:y,target:document.getElementById('map')}});
    return document.getElementById('tip').style.display==='block';};
  const c=map.getCenter(),zm=map.getZoom();map.setView([50,15],7.5,{animate:false});      // forecast under the buttons
  const y=r.top+r.height/2,near=at(r.left-20,y),below20=at(r.left+r.width/2,r.bottom+20),below80=at(r.left+r.width/2,r.bottom+80),far=at(r.left-80,y);
  hideHover();map.setView(c,zm,{animate:false});
  return {near20px:near,below20px:below20,below80px:below80,far80px:far};})())"""))
ws.call("Browser.grantPermissions", permissions=["geolocation"])
ws.call("Emulation.setGeolocationOverride", latitude=50.0755, longitude=14.4378, accuracy=600)
ev("toggleLocate()"); time.sleep(2)
print("LOCATE", ev("JSON.stringify({pos: myPos, dot: %s('.me-dot'), btn: %s('.locate-ctl'), on: document.querySelector('.locate-btn').className, pinned: !!pinInfo, tip: document.getElementById('tip').innerText.replace(/\\n/g,' '), zoom: map.getZoom()})" % (R, R))); shot("locate")
ev("toggleLocate(); unpin()")
ev("setCompact(true)"); time.sleep(0.5)
print("COMPACT", ev("JSON.stringify({topbar: %s('#topbar'), controls: %s('#controls'), fold: %s('#compact-btn'), credit: document.getElementById('credit-short').innerText})" % (R, R, R))); shot("compact")
ev("setCompact(false)")
ev("document.getElementById('m-src').click()"); time.sleep(1)
print("PANEL ", ev("JSON.stringify({rect: %s('#credits'), close: %s('#credits .cr-close'), items: document.querySelectorAll('#credits .cr-item').length, logos: [...document.querySelectorAll('#credits .cr-logos img')].map(i=>i.naturalWidth)})" % (R, R))); shot("panel")
ev("document.getElementById('credits').scrollTop=99999"); time.sleep(0.5); shot("panel2")
ev("toggleCredits(false)")
if len(sys.argv) > 5:
    first = ev("currentDataset.id")
    ev(f"setVar('temp_c'); setTime({t_first} + 2*3600000)"); time.sleep(0.5)
    before = ev("document.getElementById('t-display').innerText.replace(/\\n/g,' ')")
    ev(f"switchDataset('{sys.argv[5]}')"); time.sleep(3)
    early = ev("JSON.stringify({time: document.getElementById('t-display').innerText.replace(/\\n/g,' '), steps: allTimesteps.length})")
    time.sleep(11)
    print("SWITCH", ev(info)); shot("switch")
    print("  time before the switch:", before, "| 3 s after:", early)
    # ELEV: the grid's own orography when grid.json says hgt_model, else the WRF terrain marked "WRF".
    pin = "(()=>{const r=imgOv.getElement().getBoundingClientRect(),x=innerWidth/2,y=(document.getElementById('topbar').getBoundingClientRect().bottom+document.getElementById('controls').getBoundingClientRect().top)/2; map.fire('click',{latlng: map.containerPointToLatLng([x,y]), originalEvent:{clientX:x, clientY:y}});})()"
    ev("unpin()"); ev(pin); time.sleep(0.4)
    own = ev("gridData.hgt_model===true")
    a = ev("document.querySelector('#tip .tr:nth-of-type(4)').innerText.replace(/\\n/g,' ')")
    ev("gridData.hgt_model=!gridData.hgt_model; if(gridData.hgt_model){gridData._h=gridData.hgt; gridData.hgt=gridData.hgt.map(()=>777);} refreshTip()")
    b = ev("document.querySelector('#tip .tr:nth-of-type(4)').innerText.replace(/\\n/g,' ')")
    ev("gridData.hgt_model=!gridData.hgt_model; if(gridData._h){gridData.hgt=gridData._h; delete gridData._h;} unpin()")
    print("  ELEV row: hgt_model =", own, "->", a, "| flag flipped (own terrain faked as 777 m) ->", b)
    ev(f"switchDataset('{first}')"); time.sleep(8)
    print("BACK  ", ev("JSON.stringify({dataset: currentDataset.id, time: document.getElementById('t-display').innerText.replace(/\\n/g,' '), steps: allTimesteps.length})"), "| expected", before)
    ev(f"switchDataset('{sys.argv[5]}')"); time.sleep(8)
    t0 = ev("allTimesteps[step].time"); ev("go(6)"); a = ev("allTimesteps[step].time"); ev("go(-6); stepBy(1)"); b = ev("allTimesteps[step].time")
    print("  buttons on", sys.argv[5], ": from", t0, "go(+6h) ->", a, "| back, one step on ->", b)
urllib.request.urlopen(f"http://127.0.0.1:9222/json/close/{tab['id']}", timeout=10).read()
