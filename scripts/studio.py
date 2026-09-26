#!/usr/bin/env python3
"""Loopback-only local stamp studio, sharing the exact CLI render engine."""
import argparse
import base64
import io
import json
import mimetypes
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from stamp import DEFAULTS, open_image, paper_preview, render, settings, write_outputs

ROOT = Path(__file__).resolve().parent.parent


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", type=Path)
    ap.add_argument("--preset", type=Path)
    ap.add_argument("--output-dir", type=Path, default=Path.cwd() / "stamp-outputs")
    ap.add_argument("--port", type=int, default=0, help="0 chooses an available port")
    args = ap.parse_args()
    initial = args.input or ROOT / "assets/demo.png"
    source = open_image(initial)
    params = json.loads(args.preset.read_text()) if args.preset else DEFAULTS.copy()
    params = settings(params.get("settings", params))
    token = secrets.token_urlsafe(24)
    state = {"image": source, "name": initial.name, "settings": params, "source": initial, "rev": 1}
    lock = threading.Lock()
    rendering = threading.Semaphore(2)

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def send(self, body, status=200, content_type="application/json"):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def trusted(self):
            return self.headers.get("Host") in (f"127.0.0.1:{self.server.server_port}", f"localhost:{self.server.server_port}")

        def do_GET(self):
            if not self.trusted():
                return self.send({"error": "Invalid host"}, 403)
            route = urlparse(self.path).path
            if route == "/api/state":
                with lock:
                    info = {"name": state["name"], "width": state["image"].width, "height": state["image"].height,
                            "settings": state["settings"], "token": token, "rev": state["rev"], "output": str(args.output_dir.resolve())}
                return self.send(info)
            if route == "/api/source":
                with lock:
                    im = state["image"].copy()
                im.thumbnail((1800, 1800))
                b = io.BytesIO()
                im.save(b, format="PNG")
                return self.send(b.getvalue(), content_type="image/png")
            filename = {"/": "index.html", "/app.js": "app.js", "/style.css": "style.css"}.get(route)
            if filename:
                return self.send((ROOT / "assets/studio" / filename).read_bytes(), content_type=mimetypes.guess_type(filename)[0] + "; charset=utf-8")
            return self.send({"error": "Not found"}, 404)

        def do_POST(self):
            if not self.trusted() or self.headers.get("X-Stamp-Token") != token:
                return self.send({"error": "Invalid session"}, 403)
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 28_000_000:
                    raise ValueError("File too large; use an image under 20 MB")
                data = json.loads(self.rfile.read(length))
                route = urlparse(self.path).path
                if route == "/api/upload":
                    raw = base64.b64decode(data["data"].split(",")[-1], validate=True)
                    im = open_image(io.BytesIO(raw))
                    with lock:
                        state.update(image=im, name=Path(data.get("name", "image")).name, source=None, rev=state["rev"] + 1)
                    return self.send({"width": im.width, "height": im.height, "rev": state["rev"]})
                if route not in ("/api/render", "/api/export", "/api/save"):
                    return self.send({"error": "Not found"}, 404)
                p = settings(data.get("settings", {}))
                with lock:
                    if data.get("rev") != state["rev"]:
                        raise ValueError("Image changed; refresh the preview")
                    im, source_path = state["image"].copy(), state["source"]
                if route == "/api/render":
                    p["size"] = min(p["size"], 900)
                with rendering:
                    result, p = render(im, p)
                if route == "/api/save":
                    args.output_dir.mkdir(parents=True, exist_ok=True)
                    name = "stamp-" + secrets.token_hex(4)
                    out = args.output_dir / (name + ".png")
                    if source_path is None:
                        source_path = args.output_dir / (name + "-source.png")
                        im.save(source_path)
                    write_outputs(result, p, out, source_path)
                    return self.send({"path": str(out.resolve()), "settings": str(out.with_suffix(".json").resolve())})
                if data.get("background") == "paper":
                    result = paper_preview(result)
                b = io.BytesIO()
                result.save(b, format="PNG")
                return self.send(b.getvalue(), content_type="image/png")
            except (ValueError, TypeError, KeyError, OSError) as e:
                return self.send({"error": str(e)}, 400)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"STAMP_STUDIO_URL=http://127.0.0.1:{server.server_port}", flush=True)
    print(f"OUTPUT_DIR={args.output_dir.resolve()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.server_close()


if __name__ == "__main__":
    main()
