"""Offline behavior and boundary tests; all Google/TypeSafe traffic is mocked."""

import base64
import copy
import json
import os
import re
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from jevzero import classifier, sample
from jevzero.gmail import Gmail, normalize
from jevzero.server import make_server
from jevzero.service import MailService
from jevzero.store import Store


@pytest.fixture(autouse=True)
def no_live_network(monkeypatch):
    # Explicit MockTransports still work; accidental real provider calls fail the suite.
    def blocked(*args, **kwargs):
        raise AssertionError("Tests must not call live services")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr("requests.sessions.Session.request", blocked)


@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path / "mail")
    yield value
    value.db.close()


def raw_result():
    r = sample.messages()[0]["result"]
    return {"model": "jev-test-fixture", "answers": copy.deepcopy(r["answers"]), "usage": {"input_tokens": 100}}


def test_request_composes_independent_questions_and_minimizes_data():
    email = sample.messages()[6]
    settings = classifier.validate_settings({"rules": [{"name": "Clients", "condition": "A customer asks for help"}]})
    body = classifier.request_body(email, settings)
    assert len(body["questions"]) == 8
    assert body["questions"]["rule_0"]["type"] == "noul"
    assert "ignore previous instructions" in body["state"]["email"]["body"]
    assert "id" not in body["state"]["email"]
    assert "label_ids" not in body["state"]["email"]
    assert all("untrusted" in q["instructions"]["boundary"] for q in body["questions"].values())


@pytest.mark.parametrize(
    "alter",
    [
        lambda r: r["answers"]["category"].update(choice="execute_shell"),
        lambda r: r["answers"]["category"]["probabilities"].update(work=float("nan")),
        lambda r: r["answers"]["category"]["probabilities"].pop("other"),
        lambda r: r["answers"]["priority"].update(type="noul"),
        lambda r: r["answers"]["reply"].update(noul=True),
        lambda r: r["answers"]["risk"].update(noul=1.1),
        lambda r: r["answers"]["importance"].update(score=float("nan")),
        lambda r: r["answers"]["importance"].update(score=0.1),
        lambda r: r["answers"]["importance"]["legend"].update({"3": "incorrect"}),
        lambda r: r["answers"].pop("reply"),
    ],
)
def test_invalid_model_output_fails_closed(alter):
    raw = raw_result()
    alter(raw)
    with pytest.raises(ValueError, match="invalid classification"):
        classifier.parse_result(raw, classifier.DEFAULT_SETTINGS)


def test_ambiguous_and_risky_judgments_route_to_review():
    messages = sample.messages()
    assert "Potential safety concern" in messages[6]["result"]["review_reasons"]
    assert "No clear category" in messages[9]["result"]["review_reasons"]
    assert "Ambiguous signal" in messages[9]["result"]["review_reasons"]
    assert messages[0]["result"]["review_reasons"] == []


def test_model_one_request_and_no_retry(monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "test-not-a-real-key")
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=raw_result())

    result = classifier.classify(sample.messages()[0], classifier.DEFAULT_SETTINGS, httpx.MockTransport(respond))
    assert len(calls) == 1 and result["source"] == "jev"
    assert json.loads(calls[0].content)["model"]
    calls.clear()

    def unavailable(request):
        calls.append(request)
        return httpx.Response(503)

    with pytest.raises(ValueError, match="503"):
        classifier.classify(sample.messages()[0], classifier.DEFAULT_SETTINGS, httpx.MockTransport(unavailable))
    assert len(calls) == 1


@pytest.mark.parametrize(
    "settings",
    [
        {"threshold": float("nan")},
        {"threshold": True},
        {"rules": [{}]},
        {"rules": [{"name": "../../trash", "condition": "a"}]},
        {"rules": [{"name": "Test", "condition": "a"}, {"name": "test", "condition": "b"}]},
        {"rules": [{"name": "Test", "condition": ""}]},
    ],
)
def test_settings_reject_invalid_threshold_and_rule_names(settings):
    with pytest.raises(ValueError):
        classifier.validate_settings(settings)


def part(mime, text, **extra):
    return {"mimeType": mime, "body": {"data": base64.urlsafe_b64encode(text.encode()).decode()}, **extra}


def test_gmail_mime_uses_plain_text_excludes_attachments_and_bounds_body():
    raw = {
        "id": "abc",
        "payload": {
            "parts": [
                part("text/plain", "A" * 13000),
                part("text/html", "<script>bad()</script><p>Alternative</p>"),
                part("text/plain", "SECRET ATTACHMENT", filename="private.txt"),
            ]
        },
    }
    email = normalize(raw)
    assert len(email["body"]) == 12000 and email["truncated"]
    assert "SECRET" not in email["body"]
    assert "Alternative" not in email["body"]


def test_html_fallback_is_text_without_loading_remote_content():
    email = normalize(
        {
            "id": "abc",
            "payload": part(
                "text/html",
                '<head>hidden</head><p>Hello &amp; welcome</p><img src="https://tracker.invalid"><script>bad()</script>',
            ),
        }
    )
    assert email["body"].strip() == "Hello & welcome"
    fallback = normalize({"id": "x", "snippet": "preview", "payload": {}})
    assert fallback["body"] == "preview" and fallback["truncated"]


class FakeGmail:
    connected = configured = True
    account = "owner@example.com"

    def __init__(self):
        self.current = {"INBOX", "UNREAD", "existing"}
        self.definitions = {"JevZero/Category/work": "existing"}
        self.calls = []
        self.fail = False
        self.apply_then_timeout = False
        self.bad_read = False

    def profile(self):
        return self.account

    def labels(self):
        return [{"id": value, "name": key} for key, value in self.definitions.items()]

    def create_label(self, name):
        self.calls.append(("create", name))
        if self.fail:
            raise ValueError("network lost")
        key = "label-" + str(len(self.definitions))
        self.definitions[name] = key
        return key

    def message(self, key, full=False):
        if self.bad_read:
            raise ValueError("Cannot read")
        return {
            "id": key,
            "labelIds": list(self.current),
            "payload": part("text/plain", "Hello"),
            "internalDate": "100",
        }

    def modify(self, key, add=(), remove=()):
        self.calls.append(("modify", key, list(add), list(remove)))
        self.current.update(add)
        self.current.difference_update(remove)
        if self.apply_then_timeout:
            raise ValueError("Timeout after apply")
        return {"labelIds": ["UNTRUSTED_MUTATION_RESPONSE"]}

    def disconnect(self):
        self.connected = False


def live_service(store):
    gmail = FakeGmail()
    service = MailService(store, gmail)
    service.mode = "gmail"
    email = sample.messages()[0]
    email["id"] = "message-1"
    store.put("gmail", email["id"], email)
    store.put("meta", "account", gmail.account)
    return service, gmail


def test_review_required_duplicate_prevention_and_independent_undo(store):
    service, gmail = live_service(store)
    with pytest.raises(ValueError, match="Review"):
        service.apply("message-1")
    service.review({"id": "message-1", "category": "work"})
    service.apply("message-1")
    receipt = service.state()["receipts"][0]
    assert receipt["status"] == "verified"
    assert "existing" not in receipt["added"]
    assert "UNTRUSTED_MUTATION_RESPONSE" not in service.message("message-1")["label_ids"]
    count = len(gmail.calls)
    with pytest.raises(ValueError, match="already has a receipt"):
        service.apply("message-1")
    assert len(gmail.calls) == count
    gmail.current.add("external-label-after-apply")
    service.undo(receipt["id"])
    assert gmail.current == {"INBOX", "UNREAD", "existing", "external-label-after-apply"}
    assert service.state()["receipts"][0]["status"] == "undone"
    with pytest.raises(ValueError, match="Only a verified"):
        service.undo(receipt["id"])


def test_journal_precedes_mutations_and_readback(store):
    service, gmail = live_service(store)
    original_create, original_modify = gmail.create_label, gmail.modify

    def create(name):
        receipt = store.all("receipt")[-1]
        assert receipt["status"] == "preparing" and receipt["steps"][-1]["status"] == "pending"
        return original_create(name)

    def modify(*args, **kwargs):
        receipt = store.all("receipt")[-1]
        assert receipt["status"] == "pending" and receipt["added"]
        return original_modify(*args, **kwargs)

    gmail.create_label, gmail.modify = create, modify
    service.review({"id": "message-1"})
    service.apply("message-1")


def test_timeout_after_apply_reconciles_without_repeating_mutation(store):
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    gmail.apply_then_timeout = True
    with pytest.raises(ValueError, match="did not verify"):
        service.apply("message-1")
    receipt = service.state()["receipts"][0]
    assert receipt["status"] == "uncertain"
    before = len(gmail.calls)
    # Simulate restart: receipt and uncertainty survive.
    restarted = MailService(store, gmail)
    restarted.mode = "gmail"
    with pytest.raises(ValueError):
        restarted.apply("message-1")
    restarted.reconcile(receipt["id"])
    assert len(gmail.calls) == before
    assert restarted.state()["receipts"][0]["status"] == "verified"


def test_undo_timeout_reconciles_without_retry(store):
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    service.apply("message-1")
    key = service.state()["receipts"][0]["id"]
    gmail.apply_then_timeout = True
    with pytest.raises(ValueError, match="Undo did not verify"):
        service.undo(key)
    before = len(gmail.calls)
    service.reconcile(key)
    assert len(gmail.calls) == before and service.get_receipt(key)["status"] == "undone"


def test_label_creation_failure_cannot_mutate_or_retry_message(store):
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    gmail.fail = True
    with pytest.raises(ValueError):
        service.apply("message-1")
    receipt = service.state()["receipts"][0]
    assert not any(c[0] == "modify" for c in gmail.calls)
    service.reconcile(receipt["id"])
    assert service.get_receipt(receipt["id"])["status"] == "not_applied"


def test_account_mismatch_blocks_writes(store):
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    gmail.account = "someone-else@example.com"
    with pytest.raises(ValueError, match="account changed"):
        service.apply("message-1")
    assert not gmail.calls


def test_sync_uses_pagination_and_repeated_sync_preserves_review(store):
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    gmail.list_messages = Mock(return_value={"messages": [{"id": "message-1"}], "nextPageToken": "page-2"})
    service.sync({"query": "in:inbox"})
    assert service.message("message-1")["approved"]
    service.sync({"query": "in:inbox", "more": True})
    gmail.list_messages.assert_called_with("in:inbox", "page-2")
    service.sync({"query": "from:example.com", "more": True})
    gmail.list_messages.assert_called_with("from:example.com", None)


def test_inference_requires_consent_limits_batch_and_saves_partial_progress(store, monkeypatch):
    monkeypatch.setenv("TYPESAFE_API_KEY", "offline-test-key")
    service, gmail = live_service(store)
    for i in range(13):
        email = sample.messages()[0]
        email.update(id=f"unclassified-{i}", result=None)
        store.put("gmail", email["id"], email)
    mock = Mock(return_value=sample.messages()[0]["result"])
    monkeypatch.setattr(classifier, "classify", mock)
    with pytest.raises(ValueError, match="Confirm sending"):
        service.classify({})
    mock.assert_not_called()
    service.classify({"consent": True})
    assert mock.call_count == 10
    assert service.state()["stats"]["attempts"] == 10
    mock.side_effect = [sample.messages()[0]["result"], ValueError("provider failed")]
    with pytest.raises(ValueError, match="provider failed"):
        service.classify({"consent": True})
    assert service.state()["stats"]["completed"] == 11
    assert service.state()["stats"]["attempts"] == 12


def test_settings_invalidate_unreviewed_but_preserve_approved(store):
    service, _ = live_service(store)
    second = sample.messages()[1]
    store.put("gmail", second["id"], second)
    service.review({"id": "message-1"})
    service.command("settings", {"threshold": 0.9, "rules": []})
    assert service.message("message-1")["result"] is not None
    assert service.message(second["id"])["result"] is None


def test_demo_cannot_invoke_model_or_touch_google(store, monkeypatch):
    gmail = Mock(configured=False, connected=False)
    service = MailService(store, gmail)
    model = Mock(side_effect=AssertionError("No live model"))
    monkeypatch.setattr(classifier, "classify", model)
    service.review({"id": "demo-1"})
    service.apply("demo-1")
    service.undo(service.state()["receipts"][0]["id"])
    with pytest.raises(ValueError, match="authored"):
        service.classify({"consent": True})
    model.assert_not_called()
    assert not gmail.mock_calls


def test_oauth_state_cookie_expiry_and_pkce(tmp_path, monkeypatch):
    monkeypatch.setenv("GMAIL_CLIENT_ID", "test-client")
    monkeypatch.setenv("GMAIL_CLIENT_SECRET", "test-secret")
    gmail = Gmail(tmp_path, "http://127.0.0.1:8767", httpx.MockTransport(lambda r: httpx.Response(500)))
    url, state = gmail.authorization()
    params = parse_qs(urlsplit(url).query)
    assert params["code_challenge_method"] == ["S256"]
    assert params["scope"] == ["https://www.googleapis.com/auth/gmail.modify"]
    with pytest.raises(ValueError, match="mismatch"):
        gmail.callback(state, "code", "other-browser-cookie")
    gmail.started = time.time() - 601
    with pytest.raises(ValueError, match="expired"):
        gmail.callback(state, "code", state)
    assert gmail.state is None


def test_oauth_token_file_permissions(tmp_path):
    gmail = Gmail(tmp_path, "http://127.0.0.1:8767")
    gmail.save(SimpleNamespace(to_json=lambda: '{"token":"test-only"}'))
    assert os.stat(gmail.path).st_mode & 0o777 == 0o600
    gmail.disconnect()
    assert not gmail.connected


def test_gmail_rest_errors_are_redacted_and_not_retried(tmp_path, monkeypatch):
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(401, json={"error": "sensitive content"})

    gmail = Gmail(tmp_path, "http://127.0.0.1:8767", httpx.MockTransport(respond))
    monkeypatch.setattr(gmail, "token", lambda: "test-token")
    with pytest.raises(ValueError, match="401") as caught:
        gmail.modify("message/a", add=["label1"])
    assert len(calls) == 1 and "sensitive" not in str(caught.value)
    assert json.loads(calls[0].content) == {"addLabelIds": ["label1"], "removeLabelIds": []}
    assert "%2F" in str(calls[0].url)


def test_loopback_csrf_host_validation_and_demo_http(tmp_path):
    # stdlib client only, against an ephemeral loopback server; provider transports remain blocked.
    import http.client

    server = make_server(tmp_path / "http", 0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    connection = http.client.HTTPConnection("127.0.0.1", server.server_port)

    def request(method, path, body=None, headers=None):
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        return response.status, response.read(), dict(response.getheaders())

    try:
        status, html, headers = request("GET", "/")
        assert status == 200 and "frame-ancestors 'none'" in headers["Content-Security-Policy"]
        token = re.search(r'name="mail-token" content="([^"]+)"', html.decode())[1]
        assert request("GET", "/api/state")[0] == 403
        assert request("GET", "/", headers={"Host": "evil.test"})[0] == 403
        assert request("POST", "/api/review", "{}", {"Content-Type": "application/json"})[0] == 403
        auth = {"X-Mail-Token": token, "Content-Type": "application/json"}
        assert request("POST", "/api/mode", '{"mode":"gmail"}', {**auth, "Origin": "https://evil.test"})[0] == 403
        status, content, _ = request("GET", "/api/state", headers=auth)
        assert status == 200 and len(json.loads(content)["messages"]) == 12
        assert request("POST", "/api/review", '{"id":"demo-1"}', auth)[0] == 200
        assert request("POST", "/api/apply", '{"id":"demo-1"}', auth)[0] == 200
        assert request("POST", "/api/apply", '{"id":"demo-1"}', auth)[0] == 400
        assert request("POST", "/api/mode", "[]", auth)[0] == 400
        assert request("GET", "/../google-token.json")[0] == 404
    finally:
        connection.close()
        server.shutdown()
        server.server_close()
        store = server.store
        store.db.close()
        server.service.gmail.http.close()


def test_reconcile_partial_and_unapplied_without_more_mutations(store):
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    gmail.apply_then_timeout = True
    with pytest.raises(ValueError):
        service.apply("message-1")
    receipt = service.state()["receipts"][0]
    assert len(receipt["added"]) >= 2
    gmail.current.remove(receipt["added"][0])
    before = len(gmail.calls)
    service.reconcile(receipt["id"])
    assert len(gmail.calls) == before
    partial = service.get_receipt(receipt["id"])
    assert partial["status"] == "partial" and len(partial["added"]) == len(receipt["added"]) - 1
    gmail.apply_then_timeout = False
    service.undo(receipt["id"])
    assert gmail.current == {"INBOX", "UNREAD", "existing"}
    # A later explicit action fails before any labels arrive; checking it never retries.
    service.review({"id": "message-1"})
    gmail.modify = Mock(side_effect=ValueError("Offline"))
    with pytest.raises(ValueError):
        service.apply("message-1")
    second = service.state()["receipts"][0]
    service.reconcile(second["id"])
    assert service.get_receipt(second["id"])["status"] == "not_applied"
    assert gmail.modify.call_count == 1


def test_missing_api_key_does_not_count_an_inference_attempt(store, monkeypatch):
    service, _ = live_service(store)
    email = service.message("message-1")
    email["result"] = None
    store.put("gmail", email["id"], email)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(ValueError, match="TypeSafe API key"):
        service.classify({"consent": True})
    assert service.state()["stats"]["attempts"] == 0


def test_multiple_custom_rules_can_match_without_overriding_base_category():
    settings = classifier.validate_settings(
        {
            "rules": [
                {"name": "Clients", "condition": "A client asks for help"},
                {"name": "Launch", "condition": "The launch is discussed"},
            ]
        }
    )
    raw = raw_result()
    raw["answers"].update(rule_0={"type": "noul", "noul": 0.91}, rule_1={"type": "noul", "noul": 0.96})
    result = classifier.parse_result(raw, settings)
    labels = classifier.proposed_labels(result)
    assert {"JevZero/Rules/Clients", "JevZero/Rules/Launch", "JevZero/Category/work"}.issubset(labels)
    del raw["answers"]["rule_1"]
    with pytest.raises(ValueError, match="invalid classification"):
        classifier.parse_result(raw, settings)


def test_declared_email_charset_and_bad_encoding_are_handled():
    payload = {
        "mimeType": "text/plain",
        "headers": [{"name": "Content-Type", "value": "text/plain; charset=iso-8859-1"}],
        "body": {"data": base64.urlsafe_b64encode("Café".encode("iso-8859-1")).decode()},
    }
    email = normalize({"id": "encoded", "payload": payload})
    assert email["body"] == "Café" and not email["truncated"]
    payload["headers"][0]["value"] = "text/plain; charset=unknown-charset"
    assert normalize({"id": "broken", "payload": payload})["truncated"]
