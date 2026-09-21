"""Local API boundaries, encrypted persistence and job recovery, using only fake providers."""

import threading
import time
from types import SimpleNamespace

import httpx
import pytest
from cryptography.fernet import Fernet, InvalidToken
from fastapi.testclient import TestClient
from test_mail import FakeGmail

from jevzero.api import Settings, create_app
from jevzero.gmail import Gmail
from jevzero.store import Store


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Live network forbidden")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr("requests.sessions.Session.request", blocked)


@pytest.fixture
def settings(tmp_path):
    return Settings("b" * 40, Fernet.generate_key().decode(), "http://localhost:3000", tmp_path / "data")


def test_every_private_route_requires_backend_auth(settings):
    with TestClient(create_app(settings, FakeGmail())) as client:
        assert client.get("/health").json() == {"status": "ok"}
        for method, path in [
            ("GET", "/state"),
            ("GET", "/jobs/id"),
            ("POST", "/connect"),
            ("POST", "/oauth/callback"),
            ("POST", "/commands/apply"),
            ("POST", "/credentials"),
        ]:
            response = client.request(method, path, json={})
            assert response.status_code == 401
            assert response.headers["cache-control"] == "no-store"
        assert client.get("/docs").status_code == 404


def test_local_credentials_are_private_and_removable(settings, monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    gmail = FakeGmail()
    gmail.connected = False
    with TestClient(create_app(settings, gmail)) as client:
        client.headers["authorization"] = "Bearer " + settings.token
        assert client.post("/credentials", content="x" * 16001).status_code == 413
        assert client.post("/auth", json={"password": "anything"}).status_code == 404
        result = client.post(
            "/credentials",
            json={
                "typesafe_key": "private-test-key-9382",
                "google_client_id": "my-app.apps.googleusercontent.com",
                "google_client_secret": "google-secret-9382",
            },
        )
        assert result.json() == {"typesafe": True, "google": True}
        assert "private-test-key" not in client.get("/state").text
        assert "google-secret" not in client.get("/credentials").text
        assert b"private-test-key" not in (settings.directory / "mail.sqlite3").read_bytes()
        assert client.post("/credentials", json={"typesafe_key": ""}).json()["typesafe"]
        assert client.post("/credentials", json={"remove_typesafe": True}).json()["typesafe"] is False
        gmail.connected = True
        assert client.post("/credentials", json={"remove_google": True}).status_code == 400


def test_encrypted_record_and_google_token_round_trip(settings):
    cipher = Fernet(settings.storage_key.encode())
    store = Store(settings.directory, cipher)
    store.put("gmail", "message-id", {"body": "PRIVATE CONTENT 9382"})
    assert store.get("gmail", "message-id")["body"] == "PRIVATE CONTENT 9382"
    assert b"PRIVATE CONTENT" not in (settings.directory / "mail.sqlite3").read_bytes()
    store.db.close()
    wrong = Store(settings.directory, Fernet(Fernet.generate_key()))
    with pytest.raises(InvalidToken):
        wrong.get("gmail", "message-id")
    wrong.db.close()
    gmail = Gmail(settings.directory, settings.origin, cipher=cipher)
    value = (
        '{"token":"private-token","refresh_token":"refresh","client_id":"id",'
        '"client_secret":"secret","expiry":"2099-01-01T00:00:00Z"}'
    )
    gmail.save(SimpleNamespace(to_json=lambda: value))
    assert "private-token" not in gmail.path.read_text()
    assert gmail.token() == "private-token"
    gmail.http.close()


def test_commands_are_serial_and_failures_not_replayed(settings):
    app = create_app(settings, FakeGmail())
    entered, release = threading.Event(), threading.Event()
    calls = []

    def slow(name, body):
        calls.append(name)
        entered.set()
        assert release.wait(3)
        raise RuntimeError("Sensitive provider payload")

    app.state.service.command = slow
    with TestClient(app) as client:
        client.headers["authorization"] = "Bearer " + settings.token
        assert client.post("/commands/mode", json={}).status_code == 404
        job = client.post("/commands/apply", json={"id": "message-id"})
        assert job.status_code == 202
        assert entered.wait(2)
        assert client.get("/state").status_code == 409
        assert client.post("/commands/apply", json={}).status_code == 409
        assert client.get("/jobs/" + job.json()["id"]).json()["status"] == "running"
        release.set()
        for _ in range(100):
            status = client.get("/jobs/" + job.json()["id"]).json()
            if status["status"] == "failed":
                break
            time.sleep(0.01)
        assert status["status"] == "failed"
        assert "Sensitive" not in status["error"]
        assert calls == ["apply"]
    with TestClient(create_app(settings, FakeGmail())) as client:
        client.headers["authorization"] = "Bearer " + settings.token
        assert client.get("/jobs/" + job.json()["id"]).json()["status"] == "failed"
        assert calls == ["apply"]


def test_restart_marks_inflight_job_interrupted(settings):
    store = Store(settings.directory, Fernet(settings.storage_key.encode()))
    store.put("job", "ab" * 16, {"id": "ab" * 16, "status": "running", "command": "apply"})
    store.db.close()
    with TestClient(create_app(settings, FakeGmail())) as client:
        client.headers["authorization"] = "Bearer " + settings.token
        status = client.get("/jobs/" + "ab" * 16).json()
        assert status["status"] == "interrupted"
        assert "Inspect Activity" in status["error"]


def test_local_settings_job_keeps_live_workspace(settings):
    app = create_app(settings, FakeGmail())
    with TestClient(app) as client:
        client.headers["authorization"] = "Bearer " + settings.token
        job = client.post("/commands/settings", json={"rules": [], "threshold": 0.8}).json()
        for _ in range(100):
            status = client.get("/jobs/" + job["id"]).json()
            if status["status"] == "succeeded":
                break
            time.sleep(0.01)
        assert status["status"] == "succeeded"
        result = client.get("/state").json()
        assert result["mode"] == "gmail"
        assert result["messages"] == []
        assert result["settings"]["threshold"] == 0.8
