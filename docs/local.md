# Run JevZero locally

No website deployment is necessary. GitHub distributes the code; Python and Next.js run on your computer. Each developer uses their own Google Cloud OAuth client and TypeSafe key. There is one connected Gmail account per local workspace, no hosted accounts or shared tenant database.

## Requirements and startup

Install uv and Node.js 22+. From a Git clone, run `uv run jevzero`. uv installs Python dependencies; the launcher runs `npm ci` when needed and builds the frontend when its source changes. Open `http://127.0.0.1:3000`. Stop with Ctrl+C. The API uses port 8768; both processes bind only to `127.0.0.1`.

You can browse and test the synthetic inbox immediately, with no API calls. Click **Connect Gmail** or the profile button to configure your own connections. There is no JevZero password or account creation.

## Google setup (once per developer)

1. Create/select your own project in [Google Cloud](https://console.cloud.google.com/).
2. Enable the Gmail API.
3. Configure the Google Auth Platform consent screen. For a personal Gmail account, use an External app in Testing and add your own Google email as a test user. Workspace administrators may impose additional restrictions.
4. Create an OAuth client of type **Web application**.
5. Register exactly `http://127.0.0.1:3000/oauth/callback` as an authorized redirect URI. Localhost callbacks are supported; you do not need a public domain. Do not substitute the API's port.
6. Save the client ID and secret in JevZero's connection form. These identify your local app; they are not your Gmail password.
7. Click **Connect Gmail with Google** and approve your account. The app requests Gmail modification permission for reading bodies and applying reviewed labels, plus basic Google profile scopes for your name and photo. If profile details are unavailable, initials remain visible.

Google's [web-server OAuth documentation](https://developers.google.com/identity/protocols/oauth2/web-server) describes localhost redirects. [OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect) describes profile data. Google's testing/verification and token-expiration rules still apply. This repository does not provide a shared, verified OAuth client for everyone: each developer supplies their own.

You can disconnect and reconnect a different Gmail account. Disconnect clears cached Gmail messages and profile details; settings and action receipts remain. OAuth client changes are blocked while Gmail is connected. Old receipts retain account binding so a different account cannot use them to change another mailbox.

## TypeSafe setup

Enter your own `TYPESAFE_API_KEY` in the same form and save it. The input is cleared after saving; the app returns only a saved/not-saved status. Blank fields preserve saved values. Separate remove controls delete saved settings and disable any corresponding environment fallback. Saving does not validate the key or make a paid request.

Your TypeSafe account is billed when you explicitly classify messages. No OpenAI key, text-generation key, Vercel token, or Render token is needed. `TYPESAFE_MODEL` defaults to `jev-latest` and can be overridden through `.env`.

## Custom categories

Open **Categories & rules**, click **Add category**, then enter a name and a description of what belongs there. For example, **Webinars**: "Webinar invitations, registration confirmations, reminders, and recordings." Click **Save preferences**. Up to 12 custom categories are supported alongside the nine built-in categories.

Jev chooses one primary category per message. Custom categories appear in the category filter, review dropdown, probability display, and Insights. You can also select a custom category manually when reviewing a classified message. Preview and approve it before applying the `JevZero/Category/webinars` label to Gmail.

Saving preferences clears unreviewed Gmail results for fresh classification; approved decisions and applied labels remain unchanged. No paid call or Gmail write happens when saving. Saved category names cannot be renamed or removed in this version, to preserve label and review history; descriptions remain editable. Multiple matching labels can instead be expressed as additional rules. Demo judgments are authored examples and do not run Jev against new categories.

## First live test

Create a Gmail label containing 3–5 non-sensitive test messages. In JevZero import using a query for that label, then confirm the TypeSafe data-sharing checkbox and classify. Inspect categories and signals, correct one category, approve its label preview, then apply. Verify the labels directly in Gmail. Use Activity to undo and independently verify removal in Gmail.

Imports are limited to 25 messages per page and classification to 10 unclassified messages per action. There is no automatic polling of Gmail or hidden inference retry. A failed or interrupted mutation must be checked in Activity before trying another action.

## Local files and privacy

By default `.jevzero-local/` contains:

- `local-secrets.json`: automatically generated storage key and internal API/session secrets; mode 0600.
- `mail.sqlite3`: encrypted JSON records for messages, provider keys, settings, profile details, jobs and receipts. Record IDs and table kinds are plaintext metadata.
- `google-token.enc`: encrypted Google access/refresh credentials.

The directory is mode 0700 and is ignored by Git. `local-secrets.json` must stay with a protected backup of your workspace. The encryption key lives on the same computer, so application encryption is not protection against someone who can read both the data and its key. Losing the key makes encrypted data unreadable; the launcher refuses to silently replace it when encrypted data exists. No migration from `.jevzero` or `.jevzero-hosted` is performed automatically.

Set `JEVZERO_LOCAL_DATA_DIR` to an absolute directory outside the repository if preferred. Back up that directory securely yourself; automatic backups and key rotation are not implemented. Removing cached rows is logical deletion, not guaranteed forensic erasure. Export files include message content and are your responsibility. Disconnecting does not revoke Google consent; revoke separately in your Google account if desired.

The local browser still uses HttpOnly/SameSite cookies, exact host/origin checks, bounded request bodies, and a private server-to-server token to keep other websites from operating the app. These internal protections do not create a user-facing login. Anyone with access to your OS account can use the local workspace. Do not bind either server to a LAN/public address or expose them through a tunnel.

Data leaves the computer only for the requested integrations: Google OAuth/mailbox requests, optional Google profile image loading, and explicitly selected message text sent to TypeSafe. Classification sends sender, subject, date, up to 12,000 body characters and rule instructions; it excludes attachments and Google tokens. This is not offline inference. Provider retention terms have not been qualified here.

## Ports and development

```bash
uv run jevzero --port 3001 --api-port 8769
uv run jevzero --dev
```

Update Google's registered callback if you change the frontend port. The app displays the current callback in its setup form. If a port is occupied, the launcher stops instead of replacing another process. `--dev` runs the hot-reload frontend; both modes use the same encrypted local data.

A frontend-only `cd frontend && npm run dev` remains a keyless demo. To enable real connections, use the launcher so it supplies the local API URL and internal secrets automatically. Launch from a repository checkout: the Python wheel alone does not include the full Node.js frontend.
