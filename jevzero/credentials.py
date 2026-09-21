"""Encrypted local connection settings. Never serialize keys into API responses."""

import os

FIELDS = {
    "typesafe_key": "TYPESAFE_API_KEY",
    "google_client_id": "GMAIL_CLIENT_ID",
    "google_client_secret": "GMAIL_CLIENT_SECRET",
}


class Credentials:
    def __init__(self, store):
        self.store = store

    def values(self):
        saved = self.store.get("secrets", "providers", {})
        return {key: saved.get(key, os.environ.get(env, "")) for key, env in FIELDS.items()}

    def status(self):
        values = self.values()
        return {
            "typesafe": bool(values["typesafe_key"]),
            "google": bool(values["google_client_id"] and values["google_client_secret"]),
        }

    def save(self, body, connected=False):
        if not isinstance(body, dict) or set(body) - {*FIELDS, "remove_typesafe", "remove_google"}:
            raise ValueError("Unknown connection setting")
        saved = self.store.get("secrets", "providers", {})
        if connected and (body.get("remove_google") or any(body.get(k) for k in FIELDS if k.startswith("google_"))):
            raise ValueError("Disconnect Gmail before changing its OAuth client")
        for key in FIELDS:
            value = body.get(key)
            if value is None or value == "":
                continue  # Blank inputs leave saved credentials unchanged.
            if (
                not isinstance(value, str)
                or not 8 <= len(value) <= 512
                or not value.isascii()
                or any(c.isspace() for c in value)
            ):
                raise ValueError("Credentials must contain 8–512 characters without spaces")
            if key == "google_client_id" and not value.endswith(".apps.googleusercontent.com"):
                raise ValueError("Use a Google Web application OAuth client ID")
            saved[key] = value
        for flag, keys in [
            ("remove_typesafe", ["typesafe_key"]),
            ("remove_google", ["google_client_id", "google_client_secret"]),
        ]:
            if body.get(flag) is True:
                for key in keys:
                    saved[key] = ""  # Explicit removal also disables an environment fallback.
        self.store.put("secrets", "providers", saved)
        return self.status()
