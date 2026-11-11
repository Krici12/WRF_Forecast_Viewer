"""Local test server for the viewer: frontend files (index.html, css/, js/) come
from this checkout; manifest.json, data/ and logo/ are proxied read-only from
the live site, so the page runs on today's real data without a local copy.

usage: python3 tools/dev/test_server.py <repo-root> <port>
       FAKE_IFS=1 ...   adds ifs_* datasets that reuse the GFS files (preview
                        of a driver that is not published yet)
"""
import http.server, json, os, sys, urllib.request
ROOT = sys.argv[1]; PORT = int(sys.argv[2]); LIVE = "https://weather-forecast.fzp.czu.cz"
FAKE = os.environ.get("FAKE_IFS") == "1"
class H(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def log_message(self, *a): pass
    def do_GET(self):
        path = self.path.split("?")[0]
        if path == "/manifest.json" or path.startswith(("/data/", "/logo/")):
            src = path.replace("/data/ifs_", "/data/gfs_") if FAKE else path
            try:
                body = urllib.request.urlopen(LIVE + src, timeout=60).read()
            except Exception as e:
                self.send_error(502, str(e)); return
            if path == "/manifest.json" and FAKE:
                m = json.loads(body)
                for d in list(m["datasets"]):
                    if d["model"] == "GFS":
                        n = dict(d); n["id"] = d["id"].replace("gfs", "ifs"); n["model"] = "IFS"
                        n["label"] = d["label"].replace("GFS", "IFS"); n["path_prefix"] = d["path_prefix"].replace("gfs_", "ifs_")
                        m["datasets"].append(n)
                m["default_dataset"] = "ifs_wrf"
                body = json.dumps(m).encode()
            self.send_response(200); self.send_header("Content-Type", "image/png" if path.endswith(".png") else "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
        else:
            super().do_GET()
http.server.ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
