# JevZero

![JevZero — a glass zero and paper envelope](frontend/public/quiet-zero.png)

**A calmer Gmail inbox, powered by Jev. Runs on your computer.**

Classify emails into categories and priorities, spot reply requests, and create custom categories like **Webinars**. Review suggested Gmail labels before applying them, with an activity history and undo.

## Install and run

Install [uv](https://docs.astral.sh/uv/getting-started/installation/) and [Node.js 22+](https://nodejs.org/), then:

```bash
git clone https://github.com/jayozer/jevzero.git
cd jevzero
uv run jevzero
```

Open **http://127.0.0.1:3000**. The first run installs dependencies and builds the interface. Stop with **Ctrl+C**. For development, use `uv run jevzero --dev`.

## Connect your inbox

Try the demo without keys, or open **Connect Gmail** and save your own TypeSafe API key and Google OAuth client ID/secret. Then sign in with Google. Register this callback in your Google Cloud project:

```text
http://127.0.0.1:3000/oauth/callback
```

**[Complete setup and testing guide →](docs/local.md)** — includes Google credentials, test users, custom categories, and your first import → classify → review → apply → undo test.

No Render, Vercel, or separate JevZero account is required. Credentials and mailbox data are encrypted locally in `.jevzero-local/`; that folder and `.env` files are ignored by Git. Google and TypeSafe require internet access, and classification sends message text to TypeSafe and incurs API usage.

[Architecture](docs/architecture.md) · [Verification](docs/verification.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [MIT license](LICENSE)
