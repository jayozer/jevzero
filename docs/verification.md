# Local JevZero verification

September 21, 2026. All tests use synthetic mail, mock providers, or loopback servers. No real Google account was connected and no paid Jev call was made.

- **PASS:** 53 Python tests, including local credential encryption/removal, explicit key routing without environment mutation, stable launcher secrets, refusal to replace a lost storage key, Google photo allowlisting, profile OAuth scopes, API authorization, serialized jobs and restart recovery, and existing Gmail classification/review/receipt/undo behavior.
- **PASS:** 5 frontend domain tests and 1 real Next.js route integration scenario. The integration covers automatic local session setup, missing-cookie rejection, cross-origin rejection, raw HTTP hostile Host rejection, key-saving proxy routes, body bounds, and OAuth cookie issuance. No owner-password route remains.
- **PASS:** Ruff, Python package build, TypeScript, Next.js production build. Source archive inspected to exclude `.jevzero-local`, `local-secrets.json`, and `.env`.
- **PASS:** `uv run jevzero --port 3012 --api-port 8770` installed dependencies, built the frontend, and started both loopback services. Local settings form displayed the matching callback URL. A synthetic TypeSafe key saved without provider calls, cleared from the input, and remained saved after refresh.
- **PASS:** Restart reused the frontend build and local settings; Ctrl+C closed both loopback ports. The default `uv run jevzero` then installed, built, and started successfully in the actual repository at port 3000, with its own fresh local data directory. The connection form showed the correct port-3000 callback and empty credential fields.
- **PASS (earlier GUI checks):** desktop review/apply/undo demo, mobile list/detail and navigation, no horizontal overflow at 320/390/768/1024/1440, keyboard dialog dismissal/focus restoration.
- **NOT RUN:** real Gmail authorization and profile-photo retrieval, Gmail writes, Jev quality/cost/latency, Windows qualification. No cloud deployment is required or performed.

Two upstream deprecation warnings remain in the FastAPI/Starlette test client. See [local setup](local.md) for live-test instructions and local data boundaries. The current connection form is captured in `docs/design/jevzero-local-setup.png`. Other screenshots in `docs/design` record the original redesign; hosted setup shown in older captures is superseded by this local form.

## Custom categories update

- **PASS:** 62 Python tests and 7 frontend tests (6 domain tests plus the Next.js route integration scenario), Ruff, formatting, TypeScript and the production build.
- Custom-category tests cover the exact Jev choice distribution, malformed and duplicate categories, persistence, legacy settings updates, preservation of approved decisions, and mocked Gmail review/apply/undo. No paid model or live Gmail mutation was used.
- Browser demo check: adding and saving Webinars makes it available in both the category filter and review dropdown.
- The actual local workspace was updated with the requested Webinars category through the authenticated settings API and read back successfully; the Google connection remained present. Saved categories keep their names, while descriptions remain editable.
