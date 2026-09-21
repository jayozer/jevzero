"""Private loopback API behind the local Next.js server. No hosted accounts."""

import os
import secrets
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager, contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from cryptography.fernet import Fernet
from fastapi import Depends, FastAPI, Header, HTTPException, Request

from .config import load_environment
from .credentials import Credentials
from .gmail import Gmail
from .service import MailService
from .store import Store


@dataclass
class Settings:
    token: str
    storage_key: str
    origin: str
    directory: Path

    def validate(self):
        if len(self.token) < 32:
            raise ValueError("A local backend token of at least 32 characters is required")
        parsed = urlsplit(self.origin)
        if parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1"}:
            raise ValueError("JevZero runs only on a loopback HTTP origin")
        if not parsed.hostname or parsed.path not in {"", "/"} or parsed.query or parsed.fragment or parsed.username:
            raise ValueError("The frontend origin cannot contain a path, query, fragment or user info")
        Fernet(self.storage_key.encode())

    @classmethod
    def from_env(cls):
        load_environment()
        return cls(
            os.environ.get("JEVZERO_BACKEND_TOKEN", ""),
            os.environ.get("JEVZERO_STORAGE_KEY", ""),
            os.environ.get("JEVZERO_APP_ORIGIN", ""),
            Path(os.environ.get("JEVZERO_LOCAL_DATA_DIR", ".jevzero-local")),
        )


def create_app(settings=None, gmail=None):
    settings = settings or Settings.from_env()
    settings.validate()
    cipher = Fernet(settings.storage_key.encode())
    store = Store(settings.directory, cipher=cipher)
    credentials = Credentials(store)
    gmail = gmail or Gmail(
        settings.directory, settings.origin.rstrip("/"), cipher=cipher, credentials=credentials, include_profile=True
    )
    service = MailService(store, gmail, key_provider=lambda: credentials.values()["typesafe_key"])
    service.mode = "gmail"
    lock = threading.Lock()
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="jevzero")
    jobs = {job["id"]: job for job in store.all("job")}
    for job in jobs.values():
        if job["status"] in {"queued", "running"}:
            job.update(
                status="interrupted", error="Server restarted. Inspect Activity before repeating any label action."
            )
            store.put("job", job["id"], job)

    @asynccontextmanager
    async def lifespan(app):
        yield
        executor.shutdown(wait=True)
        store.db.close()
        if hasattr(gmail, "http"):
            gmail.http.close()

    app = FastAPI(title="JevZero API", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)
    app.state.store, app.state.service, app.state.jobs = store, service, jobs

    def authorize(authorization: str | None = Header(default=None)):
        if not authorization or not secrets.compare_digest(authorization, "Bearer " + settings.token):
            raise HTTPException(401, "Unauthorized")

    @contextmanager
    def available():
        if not lock.acquire(blocking=False):
            raise HTTPException(409, "Another operation is running")
        try:
            yield
        finally:
            lock.release()

    @app.middleware("http")
    async def secure_headers(request: Request, call_next):
        if request.method == "POST":
            # Bound chunked as well as Content-Length requests before JSON parsing.
            size, chunks = 0, []
            async for chunk in request.stream():
                size += len(chunk)
                if size > 16000:
                    from starlette.responses import JSONResponse

                    return JSONResponse({"detail": "Request too large"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/credentials", dependencies=[Depends(authorize)])
    def connection_status():
        with available():
            return credentials.status()

    @app.post("/credentials", dependencies=[Depends(authorize)])
    def save_credentials(body: dict):
        with available():
            try:
                result = credentials.save(body, connected=gmail.connected)
                if any(k.startswith("google_") or k == "remove_google" for k in body):
                    gmail.flow, gmail.state = None, None
                return result
            except ValueError as error:
                raise HTTPException(400, str(error)) from None

    @app.get("/state", dependencies=[Depends(authorize)])
    def state():
        with available():
            return {
                **service.state(),
                "credentials": credentials.status(),
                "google_profile": store.get("meta", "google_profile"),
                "local": True,
            }

    @app.post("/connect", dependencies=[Depends(authorize)])
    def connect():
        with available():
            if gmail.connected:
                raise HTTPException(409, "Disconnect the existing Gmail account first")
            try:
                url, state = gmail.authorization()
                return {"url": url, "state": state}
            except ValueError as error:
                raise HTTPException(400, str(error)) from None

    @app.post("/oauth/callback", dependencies=[Depends(authorize)])
    def callback(body: dict):
        with available():
            try:
                gmail.callback(body.get("state", ""), body.get("code", ""), body.get("cookie", ""))
                profile = None
                try:
                    profile = gmail.user_profile()
                except Exception:
                    pass  # A missing/denied optional photo cannot break a successful Gmail authorization.
                store.put("meta", "google_profile", profile)
                return {"connected": True}
            except Exception:
                raise HTTPException(400, "Google authorization failed or expired. Reconnect from JevZero") from None

    allowed = {"sync", "classify", "review", "apply", "undo", "reconcile", "settings", "disconnect"}

    def execute(job, name, body):
        try:
            job.update(status="running")
            store.put("job", job["id"], job)
            service.command(name, body)
            service.mode = "gmail"  # Demo lives in the frontend, never in the connected mailbox.
            job.update(status="succeeded")
        except Exception as error:
            message = (
                str(error) if isinstance(error, ValueError) else "Operation interrupted. Check Activity before retrying"
            )
            job.update(status="failed", error=message)
        finally:
            try:
                store.put("job", job["id"], job)
            finally:
                lock.release()

    @app.post("/commands/{name}", status_code=202, dependencies=[Depends(authorize)])
    def command(name: str, body: dict):
        if name not in allowed:
            raise HTTPException(404, "Unknown command")
        if not lock.acquire(blocking=False):
            raise HTTPException(409, "Another operation is running")
        try:
            job = {"id": secrets.token_hex(16), "status": "queued", "command": name, "created_at": time.time()}
            store.put("job", job["id"], job)
            jobs[job["id"]] = job
            executor.submit(execute, job, name, body)
            return {"id": job["id"], "status": "queued"}
        except Exception:
            lock.release()
            raise

    @app.get("/jobs/{job_id}", dependencies=[Depends(authorize)])
    def get_job(job_id: str):
        job = jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Job not found")
        return dict(job)

    return app
