"""Application policy: bounded reads, explicit review, journaled writes and verified undo."""

import copy
import os
import time

from . import classifier, sample
from .gmail import normalize


class MailService:
    def __init__(self, store, gmail, key_provider=None):
        self.store, self.gmail = store, gmail
        self.key_provider = key_provider
        self.mode = "demo"
        if not store.all("demo"):
            for email in sample.messages():
                store.put("demo", email["id"], email)

    def settings(self):
        return {**copy.deepcopy(classifier.DEFAULT_SETTINGS), **self.store.get("settings", "current", {})}

    def emails(self):
        return sorted(self.store.all(self.mode), key=lambda e: e["timestamp"], reverse=True)

    def message(self, key):
        email = self.store.get(self.mode, key)
        if email is None:
            raise ValueError("Message not found in the current mailbox")
        return email

    def state(self):
        receipts = [r for r in self.store.all("receipt") if r["mode"] == self.mode]
        return {
            "mode": self.mode,
            "messages": self.emails(),
            "settings": self.settings(),
            "categories": classifier.category_options(self.settings()),
            "priorities": classifier.PRIORITIES,
            "receipts": sorted(receipts, key=lambda r: r["time"], reverse=True)[:100],
            "connected": self.gmail.connected,
            "configured": self.gmail.configured,
            "account": self.store.get("meta", "account", ""),
            "cursor": self.store.get("meta", "cursor"),
            "stats": self.store.get("meta", "inference", {"attempts": 0, "completed": 0, "latency_ms": 0}),
        }

    def active_receipt(self, email_id):
        return next(
            (
                r
                for r in self.store.all("receipt")
                if r["mode"] == self.mode
                and r.get("message_id") == email_id
                and r["status"] not in {"undone", "not_applied"}
            ),
            None,
        )

    def command(self, name, body):
        if name == "mode":
            if body.get("mode") not in {"demo", "gmail"}:
                raise ValueError("Unknown mailbox")
            self.mode = body["mode"]
        elif name == "settings":
            current = self.settings()
            settings = classifier.validate_settings({**current, **body})
            saved = {item["id"]: item for item in settings["custom_categories"]}
            for item in current["custom_categories"]:
                if item["id"] not in saved or item["name"] != saved[item["id"]]["name"]:
                    raise ValueError("Saved categories cannot be removed or renamed; edit their descriptions instead")
            self.store.put("settings", "current", settings)
            # Changed judgments must be recomputed; do not alter reviewed decisions or active receipts.
            for email in self.store.all("gmail"):
                if not email["approved"]:
                    email["result"] = None
                    self.store.put("gmail", email["id"], email)
        elif name == "sync":
            self.sync(body)
        elif name == "classify":
            self.classify(body)
        elif name == "review":
            self.review(body)
        elif name == "apply":
            self.apply(body["id"])
        elif name == "undo":
            self.undo(body["id"])
        elif name == "reconcile":
            self.reconcile(body["id"])
        elif name == "disconnect":
            self.gmail.disconnect()
            self.store.clear("gmail")
            self.store.put("meta", "account", "")
            self.store.put("meta", "google_profile", None)
            self.store.put("meta", "cursor", None)
            self.mode = "demo"
        else:
            raise ValueError("Unknown action")
        return self.state()

    def sync(self, body):
        if self.mode != "gmail":
            raise ValueError("Switch to Gmail first")
        query = body.get("query", "in:inbox newer_than:30d")
        if not isinstance(query, str) or not 1 <= len(query) <= 500:
            raise ValueError("Enter a Gmail search of 1–500 characters")
        account = self.gmail.profile()
        old_account = self.store.get("meta", "account")
        if old_account and old_account != account:
            raise ValueError("Account changed. Disconnect to clear cached messages before switching accounts")
        self.store.put("meta", "account", account)
        cursor = self.store.get("meta", "cursor")
        page = cursor["page"] if body.get("more") and cursor and cursor["query"] == query else None
        listing = self.gmail.list_messages(query, page)
        for item in listing.get("messages", []):
            email = normalize(self.gmail.message(item["id"], full=True))
            existing = self.store.get("gmail", email["id"])
            if existing:
                for key in ("result", "approved", "approved_category", "proposed_labels", "fingerprint"):
                    if key in existing:
                        email[key] = existing[key]
            self.store.put("gmail", email["id"], email)
        self.store.put(
            "meta",
            "cursor",
            {"query": query, "page": listing["nextPageToken"]} if listing.get("nextPageToken") else None,
        )

    def classify(self, body):
        if self.mode != "gmail":
            raise ValueError("The demo contains authored sample classifications. Switch to Gmail for Jev inference")
        if body.get("consent") is not True:
            raise ValueError("Confirm sending sender, subject, date and up to 12,000 body characters to TypeSafe")
        settings = self.settings()
        emails = [e for e in self.emails() if not e["result"] and not e["approved"]][:10]
        key = self.key_provider() if self.key_provider else os.environ.get("TYPESAFE_API_KEY")
        if emails and not key:
            raise ValueError("Add your TypeSafe API key in Connections before classification")
        for email in emails:
            stats = self.store.get("meta", "inference", {"attempts": 0, "completed": 0, "latency_ms": 0})
            stats["attempts"] += 1
            self.store.put("meta", "inference", stats)
            result = (
                classifier.classify(email, settings, api_key=key)
                if self.key_provider
                else classifier.classify(email, settings)
            )
            email.update(result=result, fingerprint=classifier.fingerprint(email, settings))
            self.store.put("gmail", email["id"], email)
            stats["completed"] += 1
            stats["latency_ms"] += result["latency_ms"]
            self.store.put("meta", "inference", stats)

    def review(self, body):
        email = self.message(body["id"])
        if self.active_receipt(email["id"]):
            raise ValueError("Undo or reconcile the existing receipt before changing this review")
        if not email["result"]:
            raise ValueError("Classify the message first")
        category = body.get("category", email["result"]["category"])
        labels = classifier.proposed_labels(email["result"], category, self.settings())
        email.update(approved=True, approved_category=category, proposed_labels=labels)
        self.store.put(self.mode, email["id"], email)

    def require_account(self):
        if self.mode == "gmail" and self.gmail.profile() != self.store.get("meta", "account"):
            raise ValueError("Gmail account changed; reconnect the original account before this action")

    def apply(self, key):
        email = self.message(key)
        if not email["approved"]:
            raise ValueError("Review the exact proposed labels first")
        if self.active_receipt(key):
            raise ValueError("This message already has a receipt. Reconcile or undo it; do not repeat the mutation")
        self.require_account()
        receipt = self.store.receipt(
            self.mode,
            message_id=key,
            account=self.store.get("meta", "account", ""),
            names=email["proposed_labels"],
            status="preparing",
            added=[],
            steps=[],
        )
        try:
            if self.mode == "demo":
                before = email["label_ids"]
                ids = email["proposed_labels"]
            else:
                before = self.gmail.message(key).get("labelIds", [])
                available = {label["name"]: label["id"] for label in self.gmail.labels()}
                ids = []
                for name in email["proposed_labels"]:
                    if name not in available:
                        receipt["steps"].append({"operation": "create_label", "name": name, "status": "pending"})
                        self.store.put("receipt", receipt["id"], receipt)
                        available[name] = self.gmail.create_label(name)
                        receipt["steps"][-1]["status"] = "returned"
                        self.store.put("receipt", receipt["id"], receipt)
                    ids.append(available[name])
            receipt.update(added=sorted(set(ids) - set(before)), before=before, status="pending")
            self.store.put("receipt", receipt["id"], receipt)
            if self.mode == "demo":
                email["label_ids"] = sorted(set(before) | set(ids))
                self.store.put(self.mode, key, email)
            elif receipt["added"]:
                self.gmail.modify(key, add=receipt["added"])
            self.verify(receipt, undo=False)
        except Exception:
            receipt["status"] = "uncertain"
            self.store.put("receipt", receipt["id"], receipt)
            raise ValueError(
                "Label action did not verify. Inspect the receipt and use Check outcome; do not repeat"
            ) from None

    def get_receipt(self, key):
        receipt = self.store.get("receipt", key)
        if not receipt or receipt["mode"] != self.mode:
            raise ValueError("Receipt not found in this mailbox")
        if self.mode == "gmail" and receipt["account"] != self.store.get("meta", "account"):
            raise ValueError("Receipt belongs to another Gmail account")
        return receipt

    def verify(self, receipt, undo):
        key = receipt["message_id"]
        email = self.message(key)
        actual = email["label_ids"] if self.mode == "demo" else self.gmail.message(key).get("labelIds", [])
        added = set(receipt["added"])
        matched = not added.intersection(actual) if undo else added.issubset(actual)
        if not matched:
            raise ValueError("Gmail read-back did not match the intended label change")
        receipt.update(status="undone" if undo else "verified", verified_at=time.time())
        email["label_ids"] = actual
        self.store.put(self.mode, key, email)
        self.store.put("receipt", receipt["id"], receipt)

    def undo(self, key):
        receipt = self.get_receipt(key)
        if receipt["status"] not in {"verified", "partial"}:
            raise ValueError("Only a verified action can be undone; check the outcome first")
        self.require_account()
        receipt["status"] = "undo_pending"
        receipt["undo_started"] = True
        self.store.put("receipt", key, receipt)
        try:
            if self.mode == "demo":
                email = self.message(receipt["message_id"])
                email["label_ids"] = [label for label in email["label_ids"] if label not in receipt["added"]]
                self.store.put(self.mode, email["id"], email)
            elif receipt["added"]:
                self.gmail.modify(receipt["message_id"], remove=receipt["added"])
            self.verify(receipt, undo=True)
        except Exception:
            receipt["status"] = "undo_uncertain"
            self.store.put("receipt", key, receipt)
            raise ValueError("Undo did not verify. Use Check outcome before any further action") from None

    def reconcile(self, key):
        receipt = self.get_receipt(key)
        if receipt["status"] in {"verified", "partial", "undone", "not_applied"}:
            raise ValueError("This receipt is already resolved")
        self.require_account()
        # Preparing failed before a message mutation; a label definition might still have been created.
        if "before" not in receipt:
            receipt["status"] = "not_applied"
            self.store.put("receipt", key, receipt)
            return
        if receipt.get("undo_started"):
            self.verify(receipt, undo=True)
            return
        email = self.message(receipt["message_id"])
        actual = (
            email["label_ids"] if self.mode == "demo" else self.gmail.message(receipt["message_id"]).get("labelIds", [])
        )
        observed = set(receipt["added"]).intersection(actual)
        if set(receipt["added"]).issubset(actual):
            receipt["status"] = "verified"
        elif not observed:
            receipt["status"] = "not_applied"
        else:
            # Keep the original intent, but restrict undo to the delta observed now.
            receipt.update(status="partial", intended_added=receipt["added"], added=sorted(observed))
        receipt["verified_at"] = time.time()
        email["label_ids"] = actual
        self.store.put(self.mode, email["id"], email)
        self.store.put("receipt", key, receipt)
