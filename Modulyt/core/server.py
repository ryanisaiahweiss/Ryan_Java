"""Generic dashboard server (stdlib only).

Each folder in dashboards/ with a dashboard.json is a dashboard:
    dashboards/<name>/dashboard.json   {"title": ..., "description": ..., "collections": [...]}
    dashboards/<name>/hooks.py         optional: before_save / before_delete / after_delete
    dashboards/<name>/index.html       the page, served at /d/<name>/
    Data/<name>/<collection>.json      the data

Routes:
    GET    /                                home page listing dashboards
    GET    /static/...                      shared assets (theme, JS helpers)
    GET    /d/<name>/...                    dashboard files
    GET    /api/<name>/data                 all collections: {collection: [...]}
    POST   /api/<name>/<collection>         upsert one item (by "id"), returns saved item
    DELETE /api/<name>/<collection>/<id>    delete one item
    GET    /events/<name>                   server-sent events; "change" when data changes
    POST   /api/<name>/upload?name=f.pdf    store an attachment (dashboard.json "files": true)
    GET    /files/<name>/<stored>           serve an attachment (safe headers, see FILE_TYPES)
    POST   /api/<name>/import?filename=x    raw .xlsx body, handled by hooks.import_file()
"""
import html
import importlib.util
import json
import mimetypes
import re
import secrets
import time
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from .store import JsonStore

MAX_JSON = 5_000_000
MAX_UPLOAD = 50_000_000
STORED_NAME = re.compile(r"^[0-9a-f]{12}-[A-Za-z0-9._-]{1,80}$")

# Attachments are user-supplied, so only known-safe types are rendered inline. Anything that
# can run script (html, svg) is served under a CSP sandbox; everything else is a download.
FILE_TYPES = {
    ".pdf": ("application/pdf", False), ".png": ("image/png", False), ".jpg": ("image/jpeg", False),
    ".jpeg": ("image/jpeg", False), ".gif": ("image/gif", False), ".webp": ("image/webp", False),
    ".txt": ("text/plain; charset=utf-8", False), ".md": ("text/plain; charset=utf-8", False),
    ".csv": ("text/plain; charset=utf-8", False), ".log": ("text/plain; charset=utf-8", False),
    ".html": ("text/html; charset=utf-8", True), ".htm": ("text/html; charset=utf-8", True),
    ".svg": ("image/svg+xml", True),
}


class ValidationError(ValueError):
    """Raised by hooks to reject a change; reported to the client as HTTP 400."""


class Dashboard:
    def __init__(self, name: str, folder: Path, data_root: Path):
        self.name = name
        self.folder = folder
        with open(folder / "dashboard.json", "r", encoding="utf-8") as f:
            self.config = json.load(f)
        self.title = self.config.get("title", name)
        self.store = JsonStore(data_root / name, self.config["collections"])
        self.hooks = None
        hooks_file = folder / "hooks.py"
        if hooks_file.exists():
            spec = importlib.util.spec_from_file_location(f"modulyt_hooks_{name}", hooks_file)
            self.hooks = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.hooks)
            self.hooks.ValidationError = ValidationError

    def all_data(self) -> dict:
        return {c: self.store.read(c) for c in self.store.collections}

    @property
    def files_dir(self) -> Path:
        return self.store.dir / "files"

    def store_file(self, name: str, data: bytes) -> dict:
        if not self.config.get("files"):
            raise ValidationError("This dashboard does not accept attachments")
        if not data:
            raise ValidationError("Empty file")
        safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(name or "file").name)[-80:] or "file"
        stored = f"{secrets.token_hex(6)}-{safe}"
        self.files_dir.mkdir(parents=True, exist_ok=True)
        (self.files_dir / stored).write_bytes(data)
        return {"name": Path(name or safe).name, "stored": stored}

    def import_file(self, filename: str, data: bytes) -> dict:
        if not (self.hooks and hasattr(self.hooks, "import_file")):
            raise ValidationError("This dashboard does not support import")
        with self.store.lock:
            return self.hooks.import_file(filename, data, self.store)

    def save(self, collection: str, item: dict) -> dict:
        if not isinstance(item, dict):
            raise ValidationError("Item must be a JSON object")
        with self.store.lock:
            if self.hooks and hasattr(self.hooks, "before_save"):
                item = self.hooks.before_save(collection, item, self.store)
            items = self.store.read(collection)
            for i, existing in enumerate(items):
                if existing.get("id") == item.get("id"):
                    items[i] = item
                    break
            else:
                items.append(item)
            self.store.write(collection, items)
        return item

    def delete(self, collection: str, item_id: str) -> bool:
        with self.store.lock:
            if self.hooks and hasattr(self.hooks, "before_delete"):
                self.hooks.before_delete(collection, item_id, self.store)
            items = self.store.read(collection)
            kept = [i for i in items if i.get("id") != item_id]
            if len(kept) == len(items):
                return False
            self.store.write(collection, kept)
            if self.hooks and hasattr(self.hooks, "after_delete"):
                self.hooks.after_delete(collection, item_id, self.store)
        return True


class App:
    def __init__(self, root: Path):
        self.root = root
        self.static_dir = root / "shared" / "static"
        self.dashboards: dict[str, Dashboard] = {}
        dash_root = root / "dashboards"
        for folder in sorted(dash_root.iterdir()) if dash_root.exists() else []:
            if (folder / "dashboard.json").exists():
                self.dashboards[folder.name] = Dashboard(folder.name, folder, root / "Data")


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # keep the console quiet except for errors
            if args and str(args[1]).startswith(("4", "5")):
                super().log_message(fmt, *args)

        # ---- helpers -------------------------------------------------
        def _send(self, status, body: bytes, ctype="application/json; charset=utf-8"):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def _json(self, status, payload):
            self._send(status, json.dumps(payload).encode("utf-8"))

        def _error(self, status, message):
            self._json(status, {"error": message})

        def _file(self, base: Path, rel: str):
            target = (base / rel).resolve()
            if base.resolve() not in target.parents and target != base.resolve():
                return self._error(HTTPStatus.FORBIDDEN, "Forbidden")
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                return self._error(HTTPStatus.NOT_FOUND, "Not found")
            ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
            if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
                ctype += "; charset=utf-8"
            self._send(HTTPStatus.OK, target.read_bytes(), ctype)

        def _home(self):
            cards = "".join(
                f'<a class="card" href="/d/{html.escape(n)}/"><h2>{html.escape(d.title)}</h2>'
                f'<p>{html.escape(d.config.get("description", ""))}</p></a>'
                for n, d in app.dashboards.items()
            )
            page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="color-scheme" content="dark"><title>Modulyt</title>
<link rel="stylesheet" href="/static/modulyt.css"></head><body>
<header class="topbar"><div class="brand">Modulyt</div></header>
<main class="home">{cards or "<p>No dashboards found.</p>"}</main></body></html>"""
            self._send(HTTPStatus.OK, page.encode("utf-8"), "text/html; charset=utf-8")

        def _dashboard(self, name):
            d = app.dashboards.get(name)
            if not d:
                self._error(HTTPStatus.NOT_FOUND, f"Unknown dashboard '{name}'")
            return d

        def _read_body(self):
            try:
                return json.loads(self._read_raw(MAX_JSON) or b"null")
            except json.JSONDecodeError:
                raise ValidationError("Invalid JSON")

        def _read_raw(self, limit):
            length = int(self.headers.get("Content-Length") or 0)
            if length > limit:
                raise ValidationError("Request too large")
            return self.rfile.read(length)

        def _attachment(self, d: Dashboard, stored: str):
            path = d.files_dir / stored
            ext = Path(stored).suffix.lower()
            if not STORED_NAME.match(stored) or not path.is_file():
                return self._error(HTTPStatus.NOT_FOUND, "Not found")
            ctype, sandbox = FILE_TYPES.get(ext, ("application/octet-stream", False))
            body = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Cache-Control", "no-store")
            if sandbox:
                self.send_header("Content-Security-Policy", "sandbox")
            if ext not in FILE_TYPES:
                self.send_header("Content-Disposition", "attachment")
            self.end_headers()
            self.wfile.write(body)

        # ---- verbs ---------------------------------------------------
        def do_GET(self):
            parts = [unquote(p) for p in urlparse(self.path).path.split("/") if p]
            if not parts:
                return self._home()
            head = parts[0]
            if head == "static":
                return self._file(app.static_dir, "/".join(parts[1:]))
            if head == "d" and len(parts) >= 2:
                d = self._dashboard(parts[1])
                if d:
                    self._file(d.folder, "/".join(parts[2:]))
                return
            if head == "api" and len(parts) == 3 and parts[2] == "data":
                d = self._dashboard(parts[1])
                if d:
                    self._json(HTTPStatus.OK, d.all_data())
                return
            if head == "events" and len(parts) == 2:
                d = self._dashboard(parts[1])
                if d:
                    self._events(d)
                return
            if head == "files" and len(parts) == 3:
                d = self._dashboard(parts[1])
                if d:
                    self._attachment(d, parts[2])
                return
            self._error(HTTPStatus.NOT_FOUND, "Not found")

        def do_POST(self):
            url = urlparse(self.path)
            query = parse_qs(url.query)
            parts = [unquote(p) for p in url.path.split("/") if p]
            if len(parts) == 3 and parts[0] == "api":
                d = self._dashboard(parts[1])
                if not d:
                    return
                try:
                    if parts[2] == "upload":
                        name = (query.get("name") or ["file"])[0]
                        return self._json(HTTPStatus.OK, d.store_file(name, self._read_raw(MAX_UPLOAD)))
                    if parts[2] == "import":
                        name = (query.get("filename") or ["import.xlsx"])[0]
                        return self._json(HTTPStatus.OK, d.import_file(name, self._read_raw(MAX_UPLOAD)))
                    if parts[2] not in d.store.collections:
                        return self._error(HTTPStatus.NOT_FOUND, "Unknown collection")
                    self._json(HTTPStatus.OK, d.save(parts[2], self._read_body()))
                except ValueError as e:  # includes ValidationError
                    self._error(HTTPStatus.BAD_REQUEST, str(e))
                except Exception as e:  # a hook bug should not drop the connection
                    self.log_error("POST %s failed: %r", self.path, e)
                    self._error(HTTPStatus.INTERNAL_SERVER_ERROR, "Server error while saving; see the console")
                return
            self._error(HTTPStatus.NOT_FOUND, "Not found")

        def do_DELETE(self):
            parts = [unquote(p) for p in urlparse(self.path).path.split("/") if p]
            if len(parts) == 4 and parts[0] == "api":
                d = self._dashboard(parts[1])
                if not d:
                    return
                if parts[2] not in d.store.collections:
                    return self._error(HTTPStatus.NOT_FOUND, "Unknown collection")
                try:
                    ok = d.delete(parts[2], parts[3])
                except ValidationError as e:
                    return self._error(HTTPStatus.BAD_REQUEST, str(e))
                if ok:
                    return self._json(HTTPStatus.OK, {"deleted": parts[3]})
                return self._error(HTTPStatus.NOT_FOUND, "No such item")
            self._error(HTTPStatus.NOT_FOUND, "Not found")

        # ---- live updates --------------------------------------------
        def _events(self, d: Dashboard):
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            last, idle = d.store.version(), 0
            try:
                self.wfile.write(b"retry: 2000\n\n")
                self.wfile.flush()
                while True:
                    time.sleep(0.5)
                    current = d.store.version()
                    if current != last:
                        last, idle = current, 0
                        self.wfile.write(b"event: change\ndata: {}\n\n")
                    else:
                        idle += 1
                        if idle >= 30:  # keep-alive so proxies/browsers keep the stream open
                            idle = 0
                            self.wfile.write(b": keepalive\n\n")
                    self.wfile.flush()
            except OSError:
                return  # client went away

    return Handler


def create_server(root: Path, host: str, port: int):
    app = App(root)
    server = ThreadingHTTPServer((host, port), make_handler(app))
    server.daemon_threads = True
    return server, app
