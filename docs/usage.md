# JevZero — legacy loopback setup and shared behavior

For the primary local Next.js GUI and encrypted Python API, use [the local guide](local.md). The port 8767 commands and local storage statements below describe the retained loopback application. Classification and label policies are shared by both frontends.

A standalone Gmail classifier and review dashboard powered by TypeSafe's Jev. Browser automation is a proposed optional extension; see [the integration design](architecture.md).

```bash
uv sync --frozen
uv run jevzero-legacy
# Open http://127.0.0.1:8767
```

The initial inbox contains **12 synthetic emails with authored classifications**. Browsing, reviewing, labeling, and undoing in demo mode are local simulations. They do not call Jev or Gmail. Demo classifications are not an accuracy benchmark.

## What it does

- Nine categories: work, personal, finance, purchases, newsletters, promotions, security, events/travel, and other.
- Independent priority, importance, reply-request, potential-risk, newsletter, and receipt judgments.
- Up to six natural-language rules, each evaluated independently so several can match one message.
- Full category probability distributions, confidence, model identity, request latency, and actual inference-attempt counts.
- Search, category filtering, importance/confidence sorting, attention and review queues.
- A digest built from message subjects and excerpts; category analytics; local JSON export.
- Gmail OAuth, bounded imports (25 messages per page), Gmail search queries, and pagination.
- Classify up to ten unclassified messages per click, with one Jev HTTP request per message and no hidden retries. Seven base questions plus one per custom rule share that request.
- Edit a suggested category, inspect the exact label names, approve the review, then separately apply it.
- Durable action receipts, independent Gmail read-back, uncertainty reconciliation, and verified undo.

Gmail changes are **additive labels only**, under `JevZero/Category/`, `JevZero/Priority/`, `JevZero/Signals/`, and `JevZero/Rules/`. The app has no mail-send, draft, delete, archive, unsubscribe, or background scheduler implementation. It leaves read/unread state alone. Undo removes only label IDs absent before that action and added by it; label definitions remain. Avoid changing those same labels concurrently in another app, since Gmail does not expose label ownership or conditional transactions.

## Research and design choice

Sources reviewed September 20, 2026:

| Example | Useful pattern | What JevZero takes from it |
| --- | --- | --- |
| [Inbox Zero — elie222/inbox-zero](https://github.com/elie222/inbox-zero) | Broad email assistant with natural-language rules, reply tracking, analytics, and inbox organization | Primary product inspiration: rules, attention views, classification, analytics, explicit user control |
| [gmail-ai-helper — ophirshiran](https://github.com/ophirshiran/gmail-ai-helper) | Python/Gmail classification and prioritization with a dashboard | Separate category and priority judgments in the existing Python stack |
| [InboxZero — supermario0711](https://github.com/supermario0711/InboxZero) | Rich categories, summary reports, and category-dependent archive policies | Finance, purchases, security, and newsletter views; a local digest |

This is an original implementation, not a fork or a copy of those projects. Inbox Zero offers a much broader assistant; JevZero focuses on classification and review. It does not claim feature parity or Inbox Zero's reply-drafting/calendar/attachment workflows.

The classifier follows the current [TypeSafe HTTP contract](https://docs.typesafe.ai/api), [Choice](https://docs.typesafe.ai/primitives/choice), [Noul](https://docs.typesafe.ai/primitives/noul), and [Score](https://docs.typesafe.ai/primitives/score) semantics. The [hierarchical-classification cookbook](https://docs.typesafe.ai/cookbooks/hierarchical_classification) informed the bounded taxonomy and visible distributions; a flat Choice is sufficient for nine categories. Independent questions follow the skill's composition guidance. The [confidence-routing pattern](https://docs.typesafe.ai/patterns/confidence-routing) informs human review, not authority to mutate a mailbox.

## Connect your own Gmail

1. In Google Cloud, enable the **Gmail API** and configure the OAuth consent screen. For a testing application, add your Gmail address as a test user.
2. Create an OAuth client with application type **Web application**.
3. Register exactly `http://127.0.0.1:8767/oauth/callback` as an authorized redirect URI. If setting `JEVZERO_PORT`, use that port in both Google and the browser.
4. Add the following values to the ignored `.env` file (never put keys in browser code, chat, or Git):

   ```dotenv
   TYPESAFE_API_KEY=your-typesafe-key
   TYPESAFE_MODEL=jev-latest
   GMAIL_CLIENT_ID=your-google-client-id
   GMAIL_CLIENT_SECRET=your-google-client-secret
   ```

   JevZero does not need `TEXT_MODEL_API_KEY`. It does not generate reply prose.
5. Restart `uv run jevzero-legacy`, click **Connect Gmail**, and complete Google's account selection and consent flow.
6. Import a page using the default `in:inbox newer_than:30d` search, or enter your own Gmail search. Imported messages accumulate in the local workspace; changing the search does not erase earlier imports.
7. Read and select the TypeSafe data-sharing checkbox, then click **Classify with Jev**. Repeat for additional batches. This makes paid TypeSafe calls.
8. Open a message, review the suggested labels, optionally change its category, and click **Approve these labels**. **Apply labels to Gmail** performs the reviewed change. Visit **Activity & undo** for read-back results and undo.

The OAuth implementation uses Google's Python OAuth library, PKCE, expiring one-use state, and a matching HttpOnly/SameSite browser cookie. Tokens refresh server-side. It requests `https://www.googleapis.com/auth/gmail.modify`, the Google scope needed to read bodies and modify message labels. Google grants broader rights than this app implements; the app exposes only the endpoints listed above. See Google's [OAuth web-server guide](https://developers.google.com/identity/protocols/oauth2/web-server), [Gmail modify reference](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify), and [scope descriptions](https://developers.google.com/workspace/gmail/api/auth/scopes) for Google-side requirements. Public distribution may require Google's verification process. Testing authorizations can expire and require reconnecting.

## What stays local, what leaves

- **Local:** imported message text, classification results, settings, reviewed categories, label receipts, and Google refresh/access tokens. The web server binds only to `127.0.0.1`, validates Host, and protects API access with a per-process token and same-origin checks.
- **Google:** OAuth token requests, mailbox/profile/label reads, and your explicitly applied or undone label changes.
- **TypeSafe:** on an explicit classification request, the selected message's sender, subject, date, up to 12,000 body characters, a truncation flag, and classification/rule instructions. Attachments, OAuth tokens, Gmail message IDs, and Gmail label IDs are excluded from model state.
- **Browser:** plain text only for email bodies. HTML is stripped; embedded images, trackers, links, scripts, and attachments are not rendered or fetched.

Local data lives in ignored `.jevzero/` by default. Set `JEVZERO_DATA_DIR` for another location, keeping it outside version control. The directory is mode `0700` and the database/token file `0600`; **there is no application-level encryption**. Local exports include email content. This is a hybrid app, not local-only inference. TypeSafe account retention/training/contract terms have not been qualified here.

**Disconnect Gmail** removes the local token and cached Gmail message records, retaining settings and action receipts (message IDs and label metadata). It does not revoke Google's authorization. Revoke access in your Google account separately if desired. SQLite row deletion is logical deletion, not guaranteed forensic erasure. To remove the local workspace, stop the app and remove the configured data directory; account for backups and exports separately.

## Reliability boundaries

Email is untrusted evidence. The model is instructed to disregard embedded commands, but prompting alone does not establish injection resistance. Jev only returns bounded typed judgments. Native code validates all required answers, probabilities, category membership, and score consistency. It never executes model text, follows emailed links, or creates model-chosen endpoints. A human reviews every label action, including confident results.

Default review routing: Choice confidence below `0.75`, category `other`, risk probability at least `0.35`, ambiguous Noul probabilities between `0.35` and `0.65`, or truncated/unavailable body content. Positive ordinary signal/custom-rule labels use `0.65`. These are initial product defaults, **not calibrated on your mailbox**. The confidence threshold is editable. A risk flag is a review cue, not a phishing verdict. Classification sees one message rather than full conversation history; “reply needed” means that message requests a reply, not that the request remains unanswered today. Importance is a normalized probability-weighted Score, not a factual measurement.

Changing rules or confidence settings invalidates **unreviewed Gmail results** for a fresh evaluation. Reviewed decisions stay fixed. Custom rules are not evaluated against the authored demo. User corrections are per-message edits, not model training. Re-importing the same Gmail ID preserves its existing review and result; already classified messages are not automatically billed again.

Each Gmail mutation is journaled before it is sent. The mutation response is not treated as proof; a separate message read checks the label delta. A timeout creates an uncertain receipt and blocks duplicate application. **Check outcome** only reads/reconciles; it does not repeat the mutation. Partial outcomes preserve both the intended and observed deltas, with undo limited to observed additions. An unresolved undo stays blocked until read-back confirms removal. A failed batch stops, retaining earlier successful classifications and counting the attempted request.

The current app is single-user, one Gmail account at a time. All commands are serialized; imports/classification may take time. Receipts and reviews survive restarts. There is no automatic sync, background classification, push notification, multi-account interface, thread-level reply tracking, date extraction, attachment analysis, model-generated summary, or learned sender rule system.

## Validation

All automated tests use synthetic inputs and mocked provider responses. A network guard blocks accidental real HTTP transports in the mail tests. Coverage includes malformed output, NaN/boolean probabilities, uncertain/risky routing, MIME/HTML handling, body limits, consent, bounded batches and pagination, account mismatch, OAuth/PKCE/state/cookie checks, durable mutation intent, duplicate protection, failed/partial writes, independent read-back, undo, and loopback API authorization.

```bash
uv run ruff check .
uv run pytest
node --check jevzero/static/mail.js
uv build
```

Browser checks use the local synthetic inbox. Offline tests and demo screenshots do not prove live OAuth, actual Gmail write-back, Jev accuracy, latency, cost, or production suitability. Those require a separately authorized live qualification with representative messages.

## Code map

| File | Responsibility |
| --- | --- |
| `jevzero/classifier.py` | Typed Jev request, strict response validation, review routing, label proposals |
| `jevzero/gmail.py` | OAuth, Google REST adapter, MIME/plain-text normalization |
| `jevzero/service.py` | Import/classify/review/apply/reconcile/undo policy |
| `jevzero/store.py` | Private local SQLite storage and durable receipts |
| `jevzero/sample.py` | Synthetic inbox and authored fixture judgments |
| `jevzero/server.py` | Loopback HTTP server and request authorization |
| `jevzero/static/` | Responsive dashboard, no external scripts or fonts |
| `tests/test_mail.py` | Offline contract and workflow tests |
