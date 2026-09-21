"""Local startup, credential routing and optional Google profile boundaries."""

import os
from unittest.mock import Mock

import httpx
import pytest
from test_mail import FakeGmail, sample

from jevzero.credentials import Credentials
from jevzero.gmail import Gmail
from jevzero.local import private_settings
from jevzero.service import MailService
from jevzero.store import Store


@pytest.fixture(autouse=True)
def no_live_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Tests cannot call live providers")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr("requests.sessions.Session.request", blocked)


def test_local_keys_are_stable_private_and_not_recreated_for_existing_data(tmp_path):
    first = private_settings(tmp_path)
    assert private_settings(tmp_path) == first
    assert os.stat(tmp_path / "local-secrets.json").st_mode & 0o777 == 0o600
    (tmp_path / "local-secrets.json").unlink()
    (tmp_path / "mail.sqlite3").touch()
    with pytest.raises(ValueError, match="Restore"):
        private_settings(tmp_path)


def test_key_removal_disables_environment_fallback(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "environment-fallback")
    store = Store(tmp_path)
    credentials = Credentials(store)
    assert credentials.status()["typesafe"]
    credentials.save({"remove_typesafe": True})
    assert credentials.values()["typesafe_key"] == ""
    store.db.close()


def test_saved_key_is_passed_to_classifier_without_global_environment_mutation(tmp_path, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "not-the-local-key")
    store = Store(tmp_path)
    item = sample.messages()[0]
    result = item["result"]
    result["latency_ms"] = 1
    item["result"] = None
    store.put("gmail", item["id"], item)
    captured = Mock(return_value=result)
    monkeypatch.setattr("jevzero.classifier.classify", captured)
    service = MailService(store, FakeGmail(), key_provider=lambda: "personal-key")
    service.mode = "gmail"
    service.classify({"consent": True})
    assert captured.call_args.kwargs["api_key"] == "personal-key"
    assert os.environ["TYPESAFE_API_KEY"] == "not-the-local-key"
    service.key_provider = lambda: ""
    item["result"] = None
    store.put("gmail", item["id"], item)
    with pytest.raises(ValueError, match="Connections"):
        service.classify({"consent": True})
    store.db.close()


@pytest.mark.parametrize(
    "picture,expected",
    [
        ("https://lh3.googleusercontent.com/photo", "https://lh3.googleusercontent.com/photo"),
        ("https://lh3.googleusercontent.com.evil.test/photo", ""),
        ("http://127.0.0.1/photo", ""),
        ("https://attacker@lh3.googleusercontent.com/photo", ""),
    ],
)
def test_google_profile_uses_fixed_endpoint_and_allowlisted_photos(tmp_path, picture, expected):
    def handler(request):
        assert str(request.url) == "https://openidconnect.googleapis.com/v1/userinfo"
        assert request.headers["authorization"] == "Bearer synthetic"
        return httpx.Response(200, json={"name": "Test Person", "email": "test@example.com", "picture": picture})

    gmail = Gmail(tmp_path, "http://127.0.0.1:3000", transport=httpx.MockTransport(handler), include_profile=True)
    gmail.token = lambda: "synthetic"
    assert gmail.user_profile()["picture"] == expected
    assert "https://www.googleapis.com/auth/userinfo.profile" in gmail.scopes
    gmail.http.close()


def test_local_oauth_uses_saved_client_and_requests_photo_scopes(tmp_path, monkeypatch):
    store = Store(tmp_path)
    credentials = Credentials(store)
    credentials.save({"google_client_id": "local.apps.googleusercontent.com", "google_client_secret": "local-secret"})
    gmail = Gmail(tmp_path, "http://127.0.0.1:3000", credentials=credentials, include_profile=True)
    url, state = gmail.authorization()
    assert "local.apps.googleusercontent.com" in url
    assert "profile" in url and "openid" in url and "code_challenge" in url
    assert state and gmail.configured
    gmail.http.close()
    store.db.close()
