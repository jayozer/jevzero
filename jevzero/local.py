"""One-command local launcher for the Python API and the Next.js interface."""

import argparse
import hashlib
import json
import os
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import time
from pathlib import Path
from urllib.request import urlopen

from cryptography.fernet import Fernet

from .config import load_environment


def private_settings(directory):
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    directory.chmod(0o700)
    path = directory / "local-secrets.json"
    if path.exists():
        data = json.loads(path.read_text())
        Fernet(data["storage_key"].encode())
        if len(data["backend_token"]) < 32 or len(data["session_secret"]) < 32:
            raise ValueError("Invalid local secrets file; restore your backup")
        path.chmod(0o600)
        return data
    if (directory / "mail.sqlite3").exists() or (directory / "google-token.enc").exists():
        raise ValueError(
            "Existing encrypted data has no local-secrets.json. Restore its key; do not generate a new one"
        )
    data = {
        "storage_key": Fernet.generate_key().decode(),
        "backend_token": secrets.token_urlsafe(48),
        "session_secret": secrets.token_urlsafe(48),
    }
    # Exclusive creation avoids silently replacing the key during simultaneous starts.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, "w") as output:
        json.dump(data, output)
        output.flush()
        os.fsync(output.fileno())
    return data


def frontend_hash(frontend):
    digest = hashlib.sha256()
    for current, dirs, files in os.walk(frontend):
        dirs[:] = sorted(d for d in dirs if d not in {"node_modules", ".next", ".git"})
        for name in sorted(files):
            path = Path(current) / name
            if path.suffix in {".ts", ".tsx", ".css", ".json", ".png", ".svg"}:
                digest.update(str(path.relative_to(frontend)).encode())
                digest.update(path.read_bytes())
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description="Run JevZero privately on this computer")
    parser.add_argument("--port", type=int, default=3000)
    parser.add_argument("--api-port", type=int, default=8768)
    parser.add_argument("--dev", action="store_true", help="Run the frontend with development hot reload")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    frontend = root / "frontend"
    if not (frontend / "package.json").exists():
        parser.error("Run from a Git clone containing frontend/. See README.md")
    if not shutil.which("npm") or not shutil.which("node"):
        parser.error("Install Node.js 22+ (including npm), then run this command again")
    version = subprocess.check_output(["node", "--version"], text=True).strip()
    if int(version.lstrip("v").split(".")[0]) < 22:
        parser.error("Node.js 22 or newer is required")
    if args.port == args.api_port or not all(1024 <= p <= 65535 for p in (args.port, args.api_port)):
        parser.error("Choose two different ports between 1024 and 65535")
    for port in (args.port, args.api_port):
        try:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))
        except OSError:
            parser.error(f"Port {port} is already in use. Stop that process or select another port")
    os.chdir(root)
    load_environment()
    directory = Path(os.environ.get("JEVZERO_LOCAL_DATA_DIR", root / ".jevzero-local")).resolve()
    try:
        settings = private_settings(directory)
    except (ValueError, KeyError, OSError) as error:
        parser.error(str(error))
    env = {
        **os.environ,
        "JEVZERO_LOCAL_MODE": "1",
        "JEVZERO_LOCAL_DATA_DIR": str(directory),
        "JEVZERO_APP_ORIGIN": f"http://127.0.0.1:{args.port}",
        "JEVZERO_BACKEND_URL": f"http://127.0.0.1:{args.api_port}",
        "JEVZERO_BACKEND_TOKEN": settings["backend_token"],
        "JEVZERO_STORAGE_KEY": settings["storage_key"],
        "JEVZERO_SESSION_SECRET": settings["session_secret"],
        "WATCHPACK_POLLING": "true",
    }
    marker = frontend / "node_modules" / ".jevzero-lock-hash"
    lock_hash = hashlib.sha256((frontend / "package-lock.json").read_bytes()).hexdigest()
    if not marker.exists() or marker.read_text() != lock_hash:
        subprocess.run(["npm", "ci"], cwd=frontend, env=env, check=True)
        marker.write_text(lock_hash)
    build_marker = frontend / ".next" / ".jevzero-source-hash"
    source_hash = frontend_hash(frontend)
    if not args.dev and (not build_marker.exists() or build_marker.read_text() != source_hash):
        subprocess.run(["npm", "run", "build"], cwd=frontend, env=env, check=True)
        build_marker.write_text(frontend_hash(frontend))
    children = []

    def stop(*_):
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)
    try:
        children.append(
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "uvicorn",
                    "jevzero.api:create_app",
                    "--factory",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(args.api_port),
                    "--workers",
                    "1",
                    "--no-access-log",
                ],
                cwd=root,
                env=env,
            )
        )
        for _ in range(100):
            if children[0].poll() is not None:
                raise RuntimeError("The local API exited before it was ready")
            try:
                with urlopen(env["JEVZERO_BACKEND_URL"] + "/health", timeout=1) as response:
                    if response.status == 200:
                        break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("The local API did not become ready")
        children.append(
            subprocess.Popen(
                ["npm", "run", "dev" if args.dev else "start", "--", "--port", str(args.port)],
                cwd=frontend,
                env=env,
                start_new_session=os.name != "nt",
            )
        )
        print(f"\nJevZero: {env['JEVZERO_APP_ORIGIN']}\nData: {directory}\nPress Ctrl+C to stop.\n", flush=True)
        while all(child.poll() is None for child in children):
            time.sleep(0.25)
    except KeyboardInterrupt:
        pass
    finally:
        for i, child in reversed(list(enumerate(children))):
            if child.poll() is None:
                if i == 1 and os.name != "nt":
                    os.killpg(child.pid, signal.SIGTERM)
                else:
                    child.terminate()
        for child in children:
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
