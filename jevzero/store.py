"""Local private storage. Every external mutation has a durable intent first."""

import json
import os
import sqlite3
import time
import uuid


class Store:
    def __init__(self, directory, cipher=None):
        self.cipher = cipher
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        directory.chmod(0o700)
        self.directory = directory
        self.db = sqlite3.connect(directory / "mail.sqlite3", check_same_thread=False)
        os.chmod(directory / "mail.sqlite3", 0o600)
        self.db.execute("CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, value TEXT, PRIMARY KEY(kind,id))")
        self.db.commit()

    def put(self, kind, key, value):
        payload = json.dumps(value)
        if self.cipher:
            payload = self.cipher.encrypt(payload.encode()).decode()
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO records VALUES (?,?,?)", (kind, key, payload))

    def get(self, kind, key, default=None):
        row = self.db.execute("SELECT value FROM records WHERE kind=? AND id=?", (kind, key)).fetchone()
        return self.decode(row[0]) if row else default

    def all(self, kind):
        return [self.decode(row[0]) for row in self.db.execute("SELECT value FROM records WHERE kind=?", (kind,))]

    def decode(self, value):
        if self.cipher:
            value = self.cipher.decrypt(value.encode()).decode()
        return json.loads(value)

    def clear(self, kind):
        with self.db:
            self.db.execute("DELETE FROM records WHERE kind=?", (kind,))

    def receipt(self, mode, **fields):
        item = {"id": uuid.uuid4().hex, "time": time.time(), "mode": mode, **fields}
        self.put("receipt", item["id"], item)
        return item
