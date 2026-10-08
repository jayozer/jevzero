"""Attachment rendering, Decisions API contract and service flow; all provider traffic is mocked."""

import copy
import io
import json
from unittest.mock import Mock

import httpx
import pypdfium2 as pdfium
import pytest
from PIL import Image
from test_mail import FakeGmail, sample

from jevzero import attachments, classifier, decisions
from jevzero.service import MailService
from jevzero.store import Store


@pytest.fixture(autouse=True)
def no_live_network(monkeypatch):
    def blocked(*args, **kwargs):
        raise AssertionError("Tests must not call live services")

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", blocked)


@pytest.fixture
def store(tmp_path):
    value = Store(tmp_path / "mail")
    yield value
    value.db.close()


def pdf_bytes(pages=5):
    document = pdfium.PdfDocument.new()
    for _ in range(pages):
        document.new_page(200, 100)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def png_bytes(size=(3000, 2000)):
    out = io.BytesIO()
    Image.new("RGB", size, "white").save(out, "PNG")
    return out.getvalue()


def meta(**extra):
    base = {
        "id": "att-1",
        "filename": "invoice.pdf",
        "mime": "application/pdf",
        "size": 2048,
        "status": "pending",
        "reason": None,
        "result": None,
    }
    return {**base, **extra}


def answer(kind="invoice", payment=0.8, signature=0.1, matches=0.9, risk=0.05, sensitivity=2.1):
    probabilities = {key: 0.0 for key in decisions.KINDS}
    probabilities[kind] = 0.91
    probabilities["other" if kind != "other" else "invoice"] = 0.09
    return {
        "model": "gpt-6-luna",
        "answers": [
            {
                "type": "choice",
                "name": "kind",
                "choice": kind,
                "confidence": 0.91,
                "probabilities": [{"value": k, "probability": p} for k, p in probabilities.items()],
            },
            {"type": "predicate", "name": "payment_due", "probability": payment},
            {"type": "predicate", "name": "signature_requested", "probability": signature},
            {"type": "predicate", "name": "matches_email", "probability": matches},
            {"type": "predicate", "name": "risk", "probability": risk},
            {"type": "score", "name": "sensitivity", "score": sensitivity, "confidence": 0.7, "probabilities": []},
        ],
        "usage": {"input_tokens": 1200},
    }


def test_pdf_pages_render_locally_with_a_page_budget():
    urls, total, reason = attachments.render_pages(pdf_bytes(5), "application/pdf")
    assert reason is None and total == 5 and len(urls) == attachments.DEFAULT_PAGES
    assert all(url.startswith("data:image/png;base64,") for url in urls)
    urls, total, _ = attachments.render_pages(pdf_bytes(2), "application/pdf", limit=50)
    assert total == 2 and len(urls) == 2  # Never more than the file has, never more than MAX_PAGES.
    assert attachments.render_pages(b"%PDF-1.4 garbage", "application/pdf") == ([], 0, "unreadable_pdf")


def test_images_shrink_and_other_files_are_never_sent():
    urls, total, reason = attachments.render_pages(png_bytes(), "image/png")
    assert reason is None and total == 1 and len(urls) == 1
    assert attachments.render_pages(b"not an image", "image/png") == ([], 0, "unreadable_image")
    assert attachments.render_pages(b"PK..", "application/vnd.ms-excel") == ([], 0, "unsupported_type")
    assert attachments.render_pages(b"x" * (attachments.MAX_BYTES + 1), "application/pdf") == ([], 0, "too_large")
    assert attachments.unsupported_reason(meta(id="")) == "inline"
    assert attachments.unsupported_reason(meta(mime="application/msword")) == "unsupported_type"
    assert attachments.unsupported_reason(meta(size=attachments.MAX_BYTES + 1)) == "too_large"
    assert attachments.unsupported_reason(meta()) is None


def test_request_sends_pages_and_context_but_no_body_text():
    email = sample.messages()[6]
    body = decisions.request_body(email, meta(), ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"], 4)
    assert body["model"] == "gpt-6-luna"
    content = body["input"][0]["content"]
    assert [part["type"] for part in content] == ["input_text", "input_image", "input_image"]
    context = json.loads(content[0]["text"])
    assert set(context) == {"boundary", "email", "attachment"}
    assert set(context["email"]) == {"sender", "subject", "date"}
    assert "ignore previous instructions" not in content[0]["text"]
    assert context["attachment"] == {
        "filename": "invoice.pdf",
        "mime": "application/pdf",
        "size": 2048,
        "pages_total": 4,
        "pages_sent": 2,
    }
    names = [q["name"] for q in body["questions"]]
    assert names == ["kind", "payment_due", "signature_requested", "matches_email", "risk", "sensitivity"]
    assert [c["value"] for c in body["questions"][0]["choices"]] == list(decisions.KINDS)
    assert all("untrusted" in q["instructions"] for q in body["questions"])


def test_valid_answers_become_a_bounded_result():
    parsed = decisions.parse_answers(answer())
    assert parsed["status"] == "classified"
    result = parsed["result"]
    assert result["kind"] == "invoice" and result["confidence"] == 0.91
    assert result["predicates"] == {"payment_due": 0.8, "signature_requested": 0.1, "matches_email": 0.9, "risk": 0.05}
    assert result["sensitivity"] == 2.1 and result["model"] == "gpt-6-luna"
    refused = copy.deepcopy(answer())
    refused["answers"][1] = {"type": "refusal", "name": "payment_due"}
    assert decisions.parse_answers(refused) == {"status": "refused", "result": None}


@pytest.mark.parametrize(
    "alter",
    [
        lambda r: r["answers"][0].update(choice="rm -rf"),
        lambda r: r["answers"][0]["probabilities"].pop(),
        lambda r: r["answers"][0]["probabilities"][0].update(probability=float("nan")),
        lambda r: r["answers"][0].update(confidence=1.2),
        lambda r: r["answers"][0].update(choice="receipt"),
        lambda r: r["answers"].pop(4),
        lambda r: r["answers"][2].update(type="choice"),
        lambda r: r["answers"][3].update(probability=True),
        lambda r: r["answers"][5].update(score=3.5),
        lambda r: r["answers"][5].update(score=float("inf")),
        lambda r: r.pop("answers"),
    ],
)
def test_invalid_answers_fail_closed(alter):
    raw = answer()
    alter(raw)
    with pytest.raises(ValueError, match="invalid attachment answer"):
        decisions.parse_answers(raw)


def test_one_request_per_attachment_and_no_retry():
    calls = []

    def respond(request):
        calls.append(request)
        return httpx.Response(200, json=answer())

    email = sample.messages()[0]
    pages = ["data:image/png;base64,AAAA"]
    result = decisions.classify_attachment(email, meta(), pages, 1, "k", httpx.MockTransport(respond))
    assert len(calls) == 1 and result["status"] == "classified" and result["latency_ms"] >= 0
    assert calls[0].headers["authorization"] == "Bearer k"
    assert str(calls[0].url) == decisions.ENDPOINT
    calls.clear()

    def overloaded(request):
        calls.append(request)
        return httpx.Response(429, json={"error": "sensitive detail"})

    with pytest.raises(ValueError, match="429") as caught:
        decisions.classify_attachment(email, meta(), [], 0, "k", httpx.MockTransport(overloaded))
    assert len(calls) == 1 and "sensitive" not in str(caught.value)
    with pytest.raises(ValueError, match="OpenAI API key"):
        decisions.classify_attachment(email, meta(), [], 0, "")


def test_attachment_labels_and_reasons_follow_thresholds():
    classified = meta(status="classified", result=decisions.parse_answers(answer())["result"])
    labels, reasons = classifier.attachment_labels([classified, meta(), {"result": None}])
    assert labels == ["JevZero/Attachments/invoice", "JevZero/Attachments/Payment due"]
    assert reasons == []
    risky = decisions.parse_answers(answer(risk=0.5, payment=0.1))["result"]
    labels, reasons = classifier.attachment_labels([meta(filename="scan.pdf", result=risky)], threshold=0.95)
    assert labels == ["JevZero/Signals/Review risk"]
    assert reasons == ["Attachment: uncertain kind for scan.pdf", "Attachment: needs a look (scan.pdf)"]
    other = meta(status="classified", result=decisions.parse_answers(answer(kind="other", payment=0))["result"])
    assert classifier.attachment_labels([other]) == ([], ["Attachment: uncertain kind for invoice.pdf"])


def live_service(store, gmail, openai_key="sk-test"):
    service = MailService(store, gmail, key_provider=lambda: "jev-key", openai_key_provider=lambda: openai_key)
    service.mode = "gmail"
    email = sample.messages()[0]
    email.update(
        id="message-1",
        result=None,
        attachments=[
            meta(),
            meta(id="att-2", filename="budget.xlsx", mime="application/vnd.ms-excel", size=100),
            meta(id="att-3", filename="photo.png", mime="image/png", size=100),
        ],
    )
    store.put("gmail", email["id"], email)
    return service


def test_service_classifies_pending_files_after_consent_and_keeps_bytes_out_of_storage(store, monkeypatch):
    gmail = FakeGmail()
    gmail.attachment_bytes = pdf_bytes(4)
    service = live_service(store, gmail)
    jev = sample.messages()[0]["result"]
    monkeypatch.setattr(classifier, "classify", Mock(return_value=copy.deepcopy(jev)))
    model = Mock(side_effect=[decisions.parse_answers(answer())])
    monkeypatch.setattr(decisions, "classify_attachment", model)

    service.classify({"consent": True})
    assert model.call_count == 0  # Body consent alone never sends a file.
    assert all(a["status"] == "pending" for a in service.message("message-1")["attachments"])

    gmail.attachment_bytes = pdf_bytes(4)
    service.classify({"consent": True, "attachments_consent": True})
    files = {a["filename"]: a for a in service.message("message-1")["attachments"]}
    assert files["invoice.pdf"]["status"] == "classified"
    assert files["invoice.pdf"]["pages_total"] == 4 and files["invoice.pdf"]["pages_sent"] == 3
    assert files["invoice.pdf"]["result"]["kind"] == "invoice"
    assert files["budget.xlsx"]["status"] == "unsupported" and files["budget.xlsx"]["reason"] == "unsupported_type"
    assert files["photo.png"]["status"] == "unsupported" and files["photo.png"]["reason"] == "unreadable_image"
    assert model.call_count == 1
    fetched = [c for c in gmail.calls if c[0] == "attachment"]
    assert fetched == [("attachment", "message-1", "att-1"), ("attachment", "message-1", "att-3")]
    _, _, images, total, key = model.call_args.args
    assert key == "sk-test" and total == 4 and len(images) == 3
    assert b"%PDF" not in (store.directory / "mail.sqlite3").read_bytes()
    assert "base64" not in json.dumps(service.message("message-1"))
    assert service.state()["messages"][0]["result"]["review_reasons"] == []

    # Already judged files stay fixed; nothing is billed twice.
    service.classify({"consent": True, "attachments_consent": True})
    assert model.call_count == 1

    # Labels and review reasons flow from the attachment result; apply/undo paths are unchanged.
    service.review({"id": "message-1"})
    labels = service.message("message-1")["proposed_labels"]
    assert "JevZero/Attachments/invoice" in labels and "JevZero/Attachments/Payment due" in labels
    assert labels.count("JevZero/Priority/" + jev["priority"]) == 1


def test_service_requires_openai_key_and_stops_the_batch_on_failure(store, monkeypatch):
    gmail = FakeGmail()
    gmail.attachment_bytes = pdf_bytes(1)
    service = live_service(store, gmail, openai_key="")
    monkeypatch.setattr(classifier, "classify", Mock(return_value=copy.deepcopy(sample.messages()[0]["result"])))
    model = Mock(side_effect=ValueError("The Decisions API returned HTTP 503; no labels changed"))
    monkeypatch.setattr(decisions, "classify_attachment", model)
    with pytest.raises(ValueError, match="OpenAI API key"):
        service.classify({"consent": True, "attachments_consent": True})
    model.assert_not_called()
    assert service.message("message-1")["result"] is not None  # Jev progress was kept.

    service.openai_key_provider = lambda: "sk-test"
    with pytest.raises(ValueError, match="503"):
        service.classify({"consent": True, "attachments_consent": True})
    files = {a["filename"]: a for a in service.message("message-1")["attachments"]}
    assert files["invoice.pdf"]["status"] == "failed" and "503" in files["invoice.pdf"]["reason"]
    # The batch stopped at the failure; later files were not touched.
    assert files["budget.xlsx"]["status"] == "pending" and files["photo.png"]["status"] == "pending"
    assert service.state()["stats"]["attempts"] == 1

    # A failed file is not retried automatically; the next Classify leaves it alone and continues.
    gmail.attachment_bytes = png_bytes((40, 40))
    photo = answer(kind="photo-or-screenshot", payment=0, risk=0.7, matches=0.2)
    model.side_effect = [decisions.parse_answers(photo)]
    service.classify({"consent": True, "attachments_consent": True})
    files = {a["filename"]: a for a in service.message("message-1")["attachments"]}
    assert files["invoice.pdf"]["status"] == "failed"
    assert files["budget.xlsx"]["status"] == "unsupported"
    assert files["photo.png"]["status"] == "classified"
    reasons = service.message("message-1")["result"]["review_reasons"]
    assert "Attachment: needs a look (photo.png)" in reasons
    service.review({"id": "message-1"})
    assert "JevZero/Signals/Review risk" in service.message("message-1")["proposed_labels"]


def test_reimport_keeps_attachment_judgments_by_gmail_attachment_id(store):
    class AttachmentGmail(FakeGmail):
        def message(self, key, full=False):
            raw = super().message(key, full)

            def pdf(name, attachment_id):
                return {"mimeType": "application/pdf", "filename": name, "body": {"attachmentId": attachment_id}}

            raw["payload"] = {"parts": [raw["payload"], pdf("invoice.pdf", "att-1"), pdf("new.pdf", "att-9")]}
            return raw

        def list_messages(self, query, page=None):
            return {"messages": [{"id": "message-1"}]}

    gmail = AttachmentGmail()
    service = live_service(store, gmail)
    email = service.message("message-1")
    email["attachments"][0].update(status="classified", result=decisions.parse_answers(answer())["result"])
    store.put("gmail", "message-1", email)
    service.sync({"query": "in:inbox"})
    files = {a["filename"]: a for a in service.message("message-1")["attachments"]}
    assert files["invoice.pdf"]["status"] == "classified" and files["invoice.pdf"]["result"]["kind"] == "invoice"
    assert files["new.pdf"]["status"] == "pending"
    assert "budget.xlsx" not in files
