# JevZero capabilities

This inventory describes the primary local app started with `uv run jevzero`. [Installation and first-use walkthrough](local.md) · [Architecture](architecture.md) · [Verification evidence](verification.md).

## Run and connect

- Start the Python API and Next.js interface with one command. Dependencies install on first run, and the frontend rebuilds when its source changes.
- Run entirely on your computer with loopback servers, local storage, configurable ports, and an optional custom data directory. No Vercel, Render, or hosted database is required.
- Use development hot reload with `uv run jevzero --dev`; stop both services with Ctrl+C.
- Enter, replace, or remove your TypeSafe API key, an optional OpenAI API key for attachments, and Google OAuth client credentials in the app. Optional `.env` configuration is also supported. Saving a key does not validate it or make a paid request.
- Connect one Gmail account per local workspace through Google OAuth. Google is the only user-facing sign-in; no separate JevZero account or password is needed.
- Display the connected Google name and profile photo when available, with an initials fallback.
- Refresh Google access tokens locally when possible. Disconnect, clear cached Gmail messages/profile/token, and connect a different account. Settings and action receipts remain; receipts are bound to the original mailbox.

## Import and read email

- Import messages using a Gmail search query, including a dedicated test label.
- Fetch up to **25 messages per page**, with **Next 25** pagination.
- Accumulate imports in the local workspace. Re-importing an existing message preserves its classification and review.
- Read sender, subject, date, and message text in a responsive desktop or mobile interface.
- Extract MIME text, prefer plain text, and convert HTML-only messages to text. Flag unavailable or truncated bodies for review.
- Limit stored/classified body text to **12,000 characters per message**. Email images, trackers, and scripts are not loaded.
- Keep only the **name, type, and size** of up to 10 attachments per message at import. Attachment bytes stay in Gmail until you explicitly allow attachment classification, and they are never stored locally.

## Classify with Jev

- Classify up to **10 unclassified, unapproved messages per action**, in newest-first order across the imported workspace. Selection and visible filters do not restrict this batch.
- Make **one paid Jev request per message** containing the category, priority, importance, signals, and custom-rule questions together. No hidden inference retry is performed.
- Choose one primary category from nine built-ins: **Work & projects, Personal, Finance, Purchases, Newsletters, Promotions, Security, Events & travel, Other**.
- Assign **urgent, normal, or low** priority and an **importance score from 0–100**.
- Independently evaluate **reply requested, potential risk, newsletter, and receipt** signals. Multiple signals can match the same message.
- Show the category probability distribution, confidence, signal/rule probabilities, model identity, and review reasons.
- Route uncertain categories/priorities, ambiguous signals, potential risks, no-match results, and truncated/unavailable content into review. Adjust the confidence threshold in preferences.
- Require explicit consent before sending sender, subject, date, message text, and classification instructions to TypeSafe. Default model: `jev-latest`; override through `TYPESAFE_MODEL`.
- Validate model answers against the configured choices and expected probability/score shapes before accepting results.

## Classify attachments with the OpenAI Decisions API

- Opt in with a **second consent checkbox** in the Classify step, available once an OpenAI API key is saved. Body classification never sends a file on its own.
- Fetch each pending PDF or image from Gmail, render the **first 3 PDF pages** (or the one image) to bounded PNG/JPEG locally, and send them with the sender, subject, date, file name, type, size, and page counts to `POST https://api.openai.com/v1/decisions` (`gpt-6-luna`). No email body text is sent to OpenAI. Up to **10 files per action**, **one paid request per file**, no hidden retry. A failure stops the batch; the file is marked failed and is not retried automatically.
- Ask one request per file: a **kind** choice from twelve options (**invoice, receipt, statement, contract, tax, identity-or-health, resume, ticket-or-itinerary, report-or-slides, marketing, photo-or-screenshot, other**); **payment due, signature requested, matches the email, and risk** predicates; and a four-level **sensitivity** score (public, routine, personal-financial, secret).
- Skip Word, Excel, archives, forwarded `.eml` files, inline parts, files over 15 MB, and password-protected or broken PDFs as **unsupported**; only their name, type, and size are shown. A model refusal is recorded as **declined** and left for manual review.
- Validate every answer (allowed kinds, probability distributions, score range) before saving. Discard the downloaded bytes and rendered pages after the request.
- Show each file's kind, confidence, predicate tags, and sensitivity on the message. Add attachment review reasons when the kind is uncertain, the file does not match the email, or the risk predicate is high.

## Custom categories and rules

- Add up to **12 custom categories** with names and descriptions, such as **Webinars** for invitations, registrations, reminders, and recordings.
- Use custom categories in Jev's allowed choices, manual category review, inbox filters, label previews, and Insights.
- Edit saved category descriptions. Saved category names cannot currently be renamed or removed, preserving existing label/review references.
- Add, edit, or remove up to **six natural-language rules**. Rules are independent, so several can match an email and propose additional labels.
- Save categories, rules, and the confidence threshold locally. Saving preferences clears unreviewed Gmail classifications for fresh evaluation; approved decisions and existing Gmail labels remain unchanged.
- Correct an individual message's category manually after classification. Corrections persist for that message; they do not train or fine-tune Jev.

## Browse and organize

- **Overview:** workspace counts and quick access to messages needing attention or review.
- **Inbox:** searchable message list and detail view, including sender, subject, and body search.
- Filter by category, reply-needed signals, newsletters, or low priority; sort by newest, importance, or lowest confidence.
- **Needs attention:** urgent messages and messages requesting a reply.
- **Review queue:** flagged classifications that have not yet been approved.
- **Your digest:** grouped original subjects and excerpts, with links back to the selected message inside JevZero. This is not a generated summary or a scheduled email.
- **Insights:** category counts, reviewed-message counts, inference attempts, valid results, and mean successful request latency. These describe imported data, not your entire Gmail mailbox.
- Export the current filtered/sorted view as a local **JSON file**, including message content and classifications.
- Use mobile navigation/list-detail layouts, **Cmd/Ctrl+K** to focus search, and keyboard-accessible dialogs.

## Review, apply, verify, and undo

- Inspect the exact proposed Gmail labels and change the primary category before approval.
- Keep **Approve labels** separate from **Apply to Gmail**. Approval saves the decision locally; applying changes Gmail.
- Create or reuse labels under `JevZero/Category/`, `JevZero/Priority/`, `JevZero/Signals/`, `JevZero/Rules/`, and `JevZero/Attachments/`. For example: `JevZero/Category/webinars` or `JevZero/Attachments/invoice`. A confident attachment kind, a likely payment due, or an attachment risk cue adds labels through the same review and apply path.
- Add only the reviewed labels to one message at a time. Read/unread state and unrelated existing labels are preserved.
- Record durable action receipts before mutations; perform a separate Gmail read to verify the resulting labels.
- Block duplicate application while an action has an active receipt. Use **Activity → Check outcome** to reconcile uncertain results without replaying the mutation.
- Use **Undo labels** for verified or partial actions. Undo removes only the label IDs recorded as newly added by that action and verifies removal; label definitions remain in Gmail.
- Retain partial/interrupted outcomes for inspection. Serialize commands and mark interrupted jobs on restart without automatically replaying them.

## Local storage and privacy controls

- Encrypt primary-app message records, provider credentials, settings, profiles, jobs, and receipts in local SQLite storage; encrypt Google token storage separately. Record identifiers and table kinds remain plaintext metadata.
- Generate internal API/session secrets and the storage key automatically. Protect the local directory and key file with filesystem permissions, and refuse to silently replace a missing key when encrypted data exists.
- Keep `.env` files, local data, and downloaded OAuth secret files out of Git. Commit only credential-free example configuration.
- Protect local requests with signed HttpOnly/SameSite cookies, host/origin checks, bounded request bodies, a server-side API token, and an allowlist of proxy operations.
- Keep credentials out of browser API responses; render email bodies as text and constrain optional profile-image sources.
- Persist Gmail workspace data and reviews across restarts. Backups are manual and must include the storage key.

The storage key is on the same computer, so encryption does not protect against someone who can read both key and data. Classification uses TypeSafe over the internet; attachment classification, when allowed, sends rendered pages to OpenAI; Google operations and optional profile photos also leave the local boundary. Disconnect is local removal, not Google consent revocation or guaranteed forensic erasure. Exports contain message content.

## Demo, development, and extensions

- Explore **12 synthetic messages with authored classifications** without credentials or provider calls. Simulate review, labels, undo, views, rules/category configuration, and export. Demo configuration does not run Jev, and frontend demo changes reset on reload.
- Use the retained `uv run jevzero-legacy` prototype on port 8767, with separate plaintext storage. It is not the primary encrypted app; see [legacy usage](usage.md).
- Develop against a Python backend and Next.js/React frontend, with mocked-provider tests for classification, OAuth, persistence, review/apply/undo, and route boundaries. See [verification](verification.md) for evidence and limitations.
- Review the proposed `jev_ultrafast` Action Center architecture for finding invoices, checking orders, and browser navigation. **That integration is not implemented or installed.**

## Current limits

There is no email sending or drafting, deletion, archiving, unsubscribe action, automatic polling/classification, scheduled digest, push notification, calendar integration, thread-level reply tracking, learned sender rules, or model-generated summary. Attachment classification covers PDF and image files only: no OCR, no text extraction from Word, Excel, or archives, no stored thumbnails, and no attachment fixtures in the demo. The OpenAI Decisions API is in public beta; its per-image token cost is not published, and its choice probabilities have not been calibrated here, so measure your first batch. There is no multi-account interface, hosted multi-user service, automatic backup, or key rotation.

A reply signal means that a message asks for a reply, not that it is still unanswered. A risk flag is a review cue, not a verified phishing verdict. Confidence is not measured accuracy, and scores/rules have not been calibrated against every user's mailbox. Automated tests and demo results do not establish live classification quality or provider performance. Gmail modifications still require your review and explicit apply action.
