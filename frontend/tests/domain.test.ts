import assert from "node:assert/strict";
import { test } from "node:test";
import { demoCommand, labels, validateRules } from "../lib/mail";
import {
  signSession,
  verifySession,
  MAX_AGE,
  sameOrigin,
} from "../lib/session";
import fixture from "../lib/demo-state.json";
import type { MailState } from "../lib/types";

test("signed local sessions reject tampering, wrong keys and expiry", () => {
  process.env.JEVZERO_SESSION_SECRET = "s".repeat(40);
  const now = Date.now(),
    session = signSession(now);
  assert.equal(verifySession(session, now), true);
  assert.equal(verifySession(session, now + MAX_AGE * 1000), false);
  assert.equal(verifySession(session.replace(/^./, "!"), now), false);
  assert.equal(verifySession(session + ".extra", now), false);
  process.env.JEVZERO_SESSION_SECRET = "x".repeat(40);
  assert.equal(verifySession(session, now), false);
});
test("mutations require exact configured browser origin", () => {
  process.env.JEVZERO_APP_ORIGIN = "https://jevzero.example";
  assert.equal(
    sameOrigin(
      new Request("http://internal/api", {
        headers: { origin: "https://jevzero.example" },
      }),
    ),
    true,
  );
  for (const origin of [
    "https://evil.example",
    "https://jevzero.example.evil.example",
    "null",
    "",
  ])
    assert.equal(
      sameOrigin(new Request("http://internal/api", { headers: { origin } })),
      false,
    );
});
test("review, apply, duplicate prevention, and undo preserve preexisting labels", () => {
  let s = structuredClone(fixture) as MailState;
  const e = s.messages[0];
  e.label_ids = ["INBOX", ...labels(e)];
  assert.throws(() => demoCommand(s, "apply", { id: e.id }), /Review/);
  s = demoCommand(s, "review", { id: e.id, category: "finance" });
  const before = [...s.messages[0].label_ids];
  s = demoCommand(s, "apply", { id: e.id });
  assert.equal(s.receipts[0].status, "verified");
  assert.deepEqual(s.receipts[0].added, ["JevZero/Category/finance"]);
  assert.throws(() => demoCommand(s, "apply", { id: e.id }), /Undo/);
  s = demoCommand(s, "undo", { id: s.receipts[0].id });
  assert.deepEqual(s.messages[0].label_ids, before);
  assert.equal(s.receipts[0].status, "undone");
});
test("demo commands cannot operate on live state", () => {
  const s = structuredClone(fixture) as MailState;
  s.mode = "gmail";
  assert.throws(
    () => demoCommand(s, "review", { id: s.messages[0].id, category: "work" }),
    /cannot change Gmail/,
  );
});
test("rules reject ambiguous labels and invalid thresholds", () => {
  assert.throws(() =>
    validateRules(
      [
        { name: "Team", condition: "team" },
        { name: "team", condition: "duplicate" },
      ],
      0.75,
    ),
  );
  assert.throws(() =>
    validateRules([{ name: "../x", condition: "team" }], 0.75),
  );
  assert.throws(() => validateRules([], NaN));
  validateRules(
    [{ name: "Customers", condition: "A customer needs help" }],
    0.75,
  );
});

test("custom categories support preview, review, filtering names, apply and undo", () => {
  let s = structuredClone(fixture) as MailState;
  const custom = {
    id: "webinars",
    name: "Webinars",
    description: "Webinar invitations and recordings",
  };
  s = demoCommand(s, "settings", {
    ...s.settings,
    custom_categories: [custom],
  });
  assert.equal(s.categories.webinars, "Webinars");
  s = demoCommand(s, "review", { id: s.messages[0].id, category: "webinars" });
  assert.equal(s.messages[0].proposed_labels?.[0], "JevZero/Category/webinars");
  s = demoCommand(s, "apply", { id: s.messages[0].id });
  assert.equal(s.receipts[0].status, "verified");
  s = demoCommand(s, "undo", { id: s.receipts[0].id });
  assert.equal(
    s.messages[0].label_ids.includes("JevZero/Category/webinars"),
    false,
  );
  assert.throws(
    () => demoCommand(s, "settings", { ...s.settings, custom_categories: [] }),
    /cannot be removed/,
  );
  assert.throws(
    () =>
      demoCommand(s, "settings", {
        ...s.settings,
        custom_categories: [custom, custom],
      }),
    /unique/,
  );
  assert.throws(
    () =>
      demoCommand(s, "review", { id: s.messages[1].id, category: "toString" }),
    /valid category/,
  );
});
