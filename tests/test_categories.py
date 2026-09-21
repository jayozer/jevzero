"""Custom category policy, classification contracts and reviewed Gmail writes, offline."""

import copy

import httpx
import pytest
from test_mail import live_service, raw_result

from jevzero import classifier, sample
from jevzero.service import MailService
from jevzero.store import Store

WEBINARS = {
    "id": "webinars",
    "name": "Webinars",
    "description": "Webinar invitations, registration confirmations, reminders, and recordings.",
}


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("No live provider calls")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)
    monkeypatch.setattr("requests.sessions.Session.request", blocked)


def test_custom_category_is_in_single_request_and_validates_complete_distribution():
    settings = classifier.validate_settings({"custom_categories": [WEBINARS]})
    email = sample.messages()[0]
    body = classifier.request_body(email, settings)
    assert body["questions"]["category"]["criteria"]["webinars"] == "Webinars: " + WEBINARS["description"]
    assert len(body["questions"]) == 7
    assert classifier.fingerprint(email, settings) != classifier.fingerprint(email, classifier.DEFAULT_SETTINGS)
    raw = raw_result()
    category = raw["answers"]["category"]
    category.update(choice="webinars", probabilities={key: 0.0 for key in classifier.category_options(settings)})
    category["probabilities"]["webinars"] = 1.0
    result = classifier.parse_result(raw, settings)
    assert classifier.proposed_labels(result, settings=settings)[0] == "JevZero/Category/webinars"
    with pytest.raises(ValueError, match="invalid classification"):
        classifier.parse_result(raw, classifier.DEFAULT_SETTINGS)
    del category["probabilities"]["work"]
    with pytest.raises(ValueError, match="invalid classification"):
        classifier.parse_result(raw, settings)


@pytest.mark.parametrize(
    "items",
    [
        [{**WEBINARS, "id": "../../x"}],
        [{**WEBINARS, "id": "work", "name": "Work"}],
        [WEBINARS, {**WEBINARS, "name": "WEBINARS"}],
        [{**WEBINARS, "name": "Webinars/Other"}],
        [{**WEBINARS, "description": " "}],
        [{**WEBINARS, "description": "x" * 501}],
        [WEBINARS] * 13,
    ],
)
def test_invalid_categories_rejected(items):
    with pytest.raises(ValueError):
        classifier.validate_settings({"custom_categories": items})


def test_custom_category_persists_review_apply_undo_and_old_settings_updates(tmp_path):
    store = Store(tmp_path)
    service, gmail = live_service(store)
    service.review({"id": "message-1"})
    old = copy.deepcopy(service.message("message-1"))
    unreviewed = sample.messages()[1]
    store.put("gmail", unreviewed["id"], unreviewed)
    service.command("settings", {"custom_categories": [WEBINARS]})
    assert service.message("message-1") == old
    assert service.message(unreviewed["id"])["result"] is None
    assert gmail.calls == []
    # Legacy clients which omit custom categories must preserve them.
    service.command("settings", {"threshold": 0.8, "rules": []})
    restarted = MailService(store, gmail)
    assert restarted.settings()["custom_categories"] == [WEBINARS]
    assert "webinars" in restarted.state()["categories"]
    service.review({"id": "message-1", "category": "webinars"})
    assert service.message("message-1")["proposed_labels"][0] == "JevZero/Category/webinars"
    service.apply("message-1")
    receipt = service.state()["receipts"][0]
    assert receipt["status"] == "verified"
    assert "JevZero/Category/webinars" in receipt["names"]
    service.undo(receipt["id"])
    assert gmail.current == {"INBOX", "UNREAD", "existing"}
    for items in ([], [{**WEBINARS, "name": "WEBINARS"}]):
        with pytest.raises(ValueError, match="cannot be removed or renamed"):
            service.command("settings", {"custom_categories": items})
    service.command("settings", {"custom_categories": [{**WEBINARS, "description": "Live webinars only"}]})
    assert service.settings()["custom_categories"][0]["description"] == "Live webinars only"
    store.db.close()
