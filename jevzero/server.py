"""Loopback-only JevZero dashboard with same-origin, token-protected commands."""

import json
import os
import secrets
import threading
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from .config import load_environment
from .gmail import Gmail
from .service import MailService
from .store import Store

ROOT = Path(__file__).parent / "static"


def make_server(directory, port=8767):
    store = Store(directory)
    origin = f"http://127.0.0.1:{port}"
    gmail = Gmail(directory, origin)
    service = MailService(store, gmail)
    token, lock = secrets.token_urlsafe(32), threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def send(self, status, value, mime="application/json; charset=utf-8", headers=None):
            if isinstance(value, (dict, list)):
                value = json.dumps(value)
            data = value.encode() if isinstance(value, str) else value
            self.send_response(status)
            for name, val in {
                "Content-Type": mime,
                "Content-Length": str(len(data)),
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                "Referrer-Policy": "no-referrer",
                "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; "
                "img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
                **(headers or {}),
            }.items():
                self.send_header(name, val)
            self.end_headers()
            self.wfile.write(data)

        def valid_host(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def authorized(self):
            return (
                self.valid_host()
                and self.headers.get("X-Mail-Token") == token
                and self.headers.get("Origin") in (None, origin)
                and self.headers.get("Sec-Fetch-Site") not in {"cross-site"}
            )

        def do_GET(self):
            if not self.valid_host():
                return self.send(403, {"error": "Loopback requests only"})
            path = urlsplit(self.path).path
            if path == "/api/state":
                if not self.authorized():
                    return self.send(403, {"error": "Open JevZero in this browser first"})
                with lock:
                    return self.send(200, service.state())
            if path == "/oauth/callback":
                with lock:
                    try:
                        params = parse_qs(urlsplit(self.path).query)
                        cookies = SimpleCookie(self.headers.get("Cookie", ""))
                        cookie = cookies.get("jev-oauth")
                        gmail.callback(
                            params.get("state", [""])[0], params.get("code", [""])[0], cookie.value if cookie else ""
                        )
                        service.mode = "gmail"
                    except Exception:
                        return self.send(
                            400,
                            "Gmail connection failed or expired. Return to JevZero and reconnect.",
                            "text/plain; charset=utf-8",
                        )
                    return self.send(
                        303,
                        "",
                        headers={
                            "Location": "/",
                            "Set-Cookie": "jev-oauth=; HttpOnly; SameSite=Lax; Path=/oauth/callback; Max-Age=0",
                        },
                    )
            files = {
                "/": ("index.html", "text/html"),
                "/mail.js": ("mail.js", "text/javascript"),
                "/mail.css": ("mail.css", "text/css"),
            }
            if path not in files:
                return self.send(404, {"error": "Not found"})
            name, mime = files[path]
            self.send(200, (ROOT / name).read_text().replace("__TOKEN__", token), mime + "; charset=utf-8")

        def do_POST(self):
            if not self.authorized():
                return self.send(403, {"error": "Local authenticated requests only"})
            if not lock.acquire(blocking=False):
                return self.send(409, {"error": "An operation is running. Wait for it to finish"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 16000 or self.headers.get_content_type() != "application/json":
                    raise ValueError("Invalid request")
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError("Expected an object")
                name = self.path.removeprefix("/api/")
                if name == "connect":
                    if gmail.connected:
                        raise ValueError("Disconnect the current account before connecting another")
                    url, state = gmail.authorization()
                    return self.send(
                        200,
                        {"url": url},
                        headers={
                            "Set-Cookie": f"jev-oauth={state}; HttpOnly; SameSite=Lax; "
                            "Path=/oauth/callback; Max-Age=600"
                        },
                    )
                self.send(200, service.command(name, body))
            except (ValueError, KeyError, TypeError) as error:
                message = str(error) if isinstance(error, ValueError) else "Invalid request fields"
                self.send(400, {"error": message})
            except Exception:
                self.send(
                    500,
                    {
                        "error": "Operation stopped. Check receipts before retrying a label action. "
                        "For a connection problem, reconnect Gmail."
                    },
                )
            finally:
                lock.release()

        def log_message(self, *_args):
            pass  # OAuth codes and message content must never enter access logs.

    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.service, server.store = service, store
    return server


def main():
    load_environment()
    directory = Path(os.environ.get("JEVZERO_DATA_DIR", ".jevzero"))
    port = int(os.environ.get("JEVZERO_PORT", "8767"))
    server = make_server(directory, port)
    print(f"JevZero: http://127.0.0.1:{port} — synthetic demo; connect Gmail when ready", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        server.store.db.close()
        server.service.gmail.http.close()


if __name__ == "__main__":
    main()
