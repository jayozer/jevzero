"""Google OAuth and a narrow Gmail adapter. No send, trash, or archive endpoints."""

import base64
import json
import os
import secrets
import time
from email.message import Message
from html.parser import HTMLParser
from urllib.parse import quote, urlsplit

import httpx
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

SCOPE = "https://www.googleapis.com/auth/gmail.modify"
API = "https://gmail.googleapis.com/gmail/v1/users/me"


class PlainText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style", "head"}:
            self.hidden += 1
        if tag in {"br", "p", "div", "li", "tr"}:
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in {"script", "style", "head"}:
            self.hidden = max(0, self.hidden - 1)

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def normalize(raw):
    payload = raw.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    plain, rich = [], []
    unavailable = False

    def walk(part, depth=0):
        nonlocal unavailable
        if depth > 20:
            unavailable = True
            return
        if part.get("filename") or part.get("mimeType", "").startswith("message/"):
            return  # Attachments, including forwarded message files, are never ingested.
        mime = part.get("mimeType", "")
        if mime in {"text/plain", "text/html"}:
            body = part.get("body", {})
            data = body.get("data", "")
            if body.get("attachmentId"):
                unavailable = True
            if len(data) > 1_000_000:
                unavailable = True
                data = data[:1_000_000]
            try:
                content_type = Message()
                content_type["Content-Type"] = next(
                    (h["value"] for h in part.get("headers", []) if h["name"].lower() == "content-type"), mime
                )
                charset = content_type.get_content_charset() or "utf-8"
                raw_bytes = base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))
                try:
                    decoded = raw_bytes.decode(charset)
                except (UnicodeError, LookupError):
                    unavailable = True
                    decoded = raw_bytes.decode("utf-8", errors="replace")
                (plain if mime == "text/plain" else rich).append(decoded)
            except (ValueError, TypeError):
                unavailable = True
        for part_child in part.get("parts", []):
            walk(part_child, depth + 1)

    walk(payload)
    body = "\n".join(plain)
    if not body and rich:
        parser = PlainText()
        parser.feed("\n".join(rich))
        body = " ".join(parser.parts)
    if not body:
        body, unavailable = raw.get("snippet", ""), True
    return {
        "id": raw["id"],
        "thread_id": raw.get("threadId", raw["id"]),
        "sender": headers.get("from", "Unknown sender")[:500],
        "subject": headers.get("subject", "(No subject)")[:1000],
        "date": headers.get("date", "")[:100],
        "timestamp": int(raw.get("internalDate", "0")),
        "body": body[:12000],
        "truncated": unavailable or len(body) > 12000,
        "label_ids": raw.get("labelIds", []),
        "result": None,
        "approved": False,
    }


class Gmail:
    def __init__(self, directory, origin, transport=None, cipher=None, credentials=None, include_profile=False):
        self.cipher = cipher
        self.credentials = credentials
        self.scopes = (
            [
                SCOPE,
                "openid",
                "https://www.googleapis.com/auth/userinfo.email",
                "https://www.googleapis.com/auth/userinfo.profile",
            ]
            if include_profile
            else [SCOPE]
        )
        self.path = directory / ("google-token.enc" if cipher else "google-token.json")
        self.origin = origin
        self.http = httpx.Client(timeout=30, transport=transport)
        self.flow = None
        self.state = None
        self.started = 0

    @property
    def configured(self):
        return bool(self.client_settings()["google_client_id"] and self.client_settings()["google_client_secret"])

    def client_settings(self):
        return (
            self.credentials.values()
            if self.credentials
            else {
                "google_client_id": os.environ.get("GMAIL_CLIENT_ID", ""),
                "google_client_secret": os.environ.get("GMAIL_CLIENT_SECRET", ""),
            }
        )

    @property
    def connected(self):
        return self.path.exists()

    def authorization(self):
        if not self.configured:
            raise ValueError("Add your Google OAuth client ID and secret in Connections; see docs/local.md")
        config = {
            "web": {
                "client_id": self.client_settings()["google_client_id"],
                "client_secret": self.client_settings()["google_client_secret"],
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
            }
        }
        self.flow = Flow.from_client_config(config, scopes=self.scopes, autogenerate_code_verifier=True)
        self.flow.redirect_uri = self.origin + "/oauth/callback"
        url, self.state = self.flow.authorization_url(access_type="offline", prompt="consent select_account")
        self.started = time.time()
        return url, self.state

    def callback(self, state, code, cookie):
        if (
            not self.state
            or not secrets.compare_digest(state, self.state)
            or not secrets.compare_digest(cookie, self.state)
        ):
            raise ValueError("OAuth state mismatch; reconnect from this browser")
        flow, self.flow = self.flow, None
        self.state = None  # Consume once, even on failure.
        if time.time() - self.started > 600 or not code:
            raise ValueError("OAuth expired or denied; reconnect")
        flow.fetch_token(code=code)
        credentials = flow.credentials
        if credentials.granted_scopes is not None and SCOPE not in credentials.granted_scopes:
            raise ValueError("Gmail permission was not granted")
        self.save(credentials)

    def save(self, credentials):
        temporary = self.path.with_suffix(".tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w") as file:
            value = credentials.to_json()
            file.write(self.cipher.encrypt(value.encode()).decode() if self.cipher else value)
        temporary.replace(self.path)
        self.path.chmod(0o600)

    def token(self):
        if not self.connected:
            raise ValueError("Connect Gmail first")
        value = self.path.read_text()
        if self.cipher:
            value = self.cipher.decrypt(value.encode()).decode()
        credentials = Credentials.from_authorized_user_info(json.loads(value), scopes=self.scopes)
        if not credentials.valid:
            if not credentials.refresh_token:
                raise ValueError("Reconnect Gmail; the authorization has expired")
            credentials.refresh(Request())
            self.save(credentials)
        return credentials.token

    def request(self, method, path, **kwargs):
        try:
            response = self.http.request(
                method, API + path, headers={"Authorization": f"Bearer {self.token()}"}, **kwargs
            )
            if response.is_error:
                raise ValueError(f"Gmail returned HTTP {response.status_code}; no automatic retry")
            return response.json()
        except httpx.HTTPError:
            raise ValueError("Gmail connection failed; verify the receipt before trying another action") from None

    def profile(self):
        return self.request("GET", "/profile")["emailAddress"]

    def user_profile(self):
        # A read from Google's fixed UserInfo endpoint, never an email-provided URL.
        response = self.http.get(
            "https://openidconnect.googleapis.com/v1/userinfo", headers={"Authorization": f"Bearer {self.token()}"}
        )
        response.raise_for_status()
        value = response.json()
        picture = value.get("picture", "")
        parsed = urlsplit(picture) if isinstance(picture, str) else urlsplit("")
        if (
            parsed.scheme != "https"
            or parsed.hostname
            not in {
                "lh3.googleusercontent.com",
                "lh4.googleusercontent.com",
                "lh5.googleusercontent.com",
                "lh6.googleusercontent.com",
            }
            or parsed.username
            or parsed.port not in {None, 443}
        ):
            picture = ""
        return {
            "name": str(value.get("name", ""))[:150],
            "email": str(value.get("email", ""))[:254],
            "picture": picture,
        }

    def list_messages(self, query, page=None):
        params = {"q": query, "maxResults": 25}
        if page:
            params["pageToken"] = page
        return self.request("GET", "/messages", params=params)

    def message(self, message_id, full=False):
        return self.request(
            "GET", "/messages/" + quote(message_id, safe=""), params={"format": "full" if full else "minimal"}
        )

    def labels(self):
        return self.request("GET", "/labels").get("labels", [])

    def create_label(self, name):
        return self.request(
            "POST", "/labels", json={"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}
        )["id"]

    def modify(self, message_id, add=(), remove=()):
        return self.request(
            "POST",
            "/messages/" + quote(message_id, safe="") + "/modify",
            json={"addLabelIds": list(add), "removeLabelIds": list(remove)},
        )

    def disconnect(self):
        # Local disconnect is intentionally distinct from revoking Google account permissions.
        self.path.unlink(missing_ok=True)
        self.flow, self.state = None, None
