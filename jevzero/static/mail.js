"use strict";
const $ = (id) => document.getElementById(id);
const token = document.querySelector('meta[name="mail-token"]').content;
const names = {
  work: "Work & projects",
  personal: "Personal",
  finance: "Finance",
  purchases: "Purchases",
  newsletters: "Newsletters",
  promotions: "Promotions",
  security: "Security",
  events: "Events & travel",
  other: "Other",
};
const titles = {
  inbox: [
    "Everything in its place.",
    "A clear view of what matters, and what can wait.",
  ],
  focus: [
    "Start with what matters.",
    "Urgent messages and conversations waiting on you.",
  ],
  review: [
    "A second look goes a long way.",
    "Uncertain and potentially risky messages, ready for your judgment.",
  ],
  digest: [
    "The shape of your inbox.",
    "A reading list assembled from your messages. No generated summaries.",
  ],
  analytics: [
    "A little perspective.",
    "See what’s arriving, what needs you, and how classification is performing.",
  ],
  rules: [
    "An inbox that knows your priorities.",
    "Describe what matters. Jev evaluates each rule independently.",
  ],
  activity: [
    "Every change, accounted for.",
    "Saved receipts, independent verification, and a way back.",
  ],
};
let state,
  view = "inbox",
  tab = "all",
  selected = null,
  working = false,
  toastTimer;
const esc = (text) =>
  String(text ?? "").replace(
    /[&<>"']/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        ch
      ],
  );
const pct = (n) => `${Math.round(n * 100)}%`;
const senderName = (e) => e.sender.split("<")[0].trim() || e.sender;
const signal = (e, key) => e.result?.signals?.[key] ?? 0;
const category = (e) => e.approved_category || e.result?.category;
const needsReview = (e) => !!e.result?.review_reasons.length && !e.approved;
const needsAttention = (e) =>
  e.result?.priority === "urgent" || signal(e, "reply") >= 0.65;
const options = (current) =>
  Object.entries(names)
    .map(
      ([key, label]) =>
        `<option value="${key}" ${key === current ? "selected" : ""}>${label}</option>`,
    )
    .join("");
function toast(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 9000);
}
async function fetchState() {
  const r = await fetch("/api/state", { headers: { "X-Mail-Token": token } });
  const data = await r.json();
  if (!r.ok) throw Error(data.error);
  state = data;
  render();
}
async function command(action, body = {}, label = "Working…") {
  if (working) return;
  working = true;
  $("busy-text").textContent = label;
  $("busy").hidden = false;
  document.body.setAttribute("aria-busy", "true");
  try {
    const response = await fetch(`/api/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Mail-Token": token },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    if (!response.ok) throw Error(data.error || "Request failed");
    if (action === "connect") {
      const url = new URL(data.url);
      if (url.origin !== "https://accounts.google.com")
        throw Error("Invalid authorization destination");
      location.assign(url.href);
      return;
    }
    state = data;
    render();
    return true;
  } catch (error) {
    toast(error.message);
    try {
      await fetchState();
    } catch {
      /* Keep the last visible state during a disconnect. */
    }
  } finally {
    working = false;
    $("busy").hidden = true;
    document.body.removeAttribute("aria-busy");
  }
}
function filtered() {
  const query = $("search").value.toLowerCase(),
    cat = $("category-filter").value;
  let emails = state.messages.filter(
    (e) =>
      (!query ||
        `${e.sender} ${e.subject} ${e.body}`.toLowerCase().includes(query)) &&
      (!cat || category(e) === cat),
  );
  if (view === "focus") emails = emails.filter(needsAttention);
  if (view === "review") emails = emails.filter(needsReview);
  if (tab === "reply")
    emails = emails.filter((e) => signal(e, "reply") >= 0.65);
  if (tab === "newsletters")
    emails = emails.filter((e) => signal(e, "newsletter") >= 0.65);
  const sort = $("sort").value;
  emails.sort((a, b) =>
    sort === "importance"
      ? (b.result?.importance ?? -1) - (a.result?.importance ?? -1)
      : sort === "confidence"
        ? (a.result?.confidence ?? 1) - (b.result?.confidence ?? 1)
        : b.timestamp - a.timestamp,
  );
  return emails;
}
function pill(text, kind = "") {
  return `<span class="pill ${esc(kind)}">${esc(text)}</span>`;
}
function render() {
  const demo = state.mode === "demo",
    emails = state.messages,
    judged = emails.filter((e) => e.result);
  $("mode-badge").textContent = demo ? "SYNTHETIC DEMO" : "GMAIL WORKSPACE";
  $("account").textContent = demo
    ? "A calmer corner of your day"
    : state.account || "Ready when you are";
  $("connection").textContent = state.connected
    ? "Disconnect Gmail"
    : "Connect Gmail ↗";
  $("connect-now").disabled = !state.configured;
  $("mobile-mail").textContent = demo ? "Gmail ↗" : "Demo";
  $("switch-mode").textContent = demo
    ? "Switch to Gmail workspace"
    : "Explore synthetic demo";
  $("notice").innerHTML = demo
    ? '<span>✦</span><span><strong>A little less inbox. A little more headspace.</strong> Explore 12 sample emails. No API calls. Demo actions stay local.</span><button class="text-button" data-setup>Make it yours ↗</button>'
    : '<span>✦</span><span><strong>Your Gmail workspace.</strong> Import, classify, review, then apply labels. Every Gmail change is yours to approve.</span><button class="text-button" data-setup>Connection details ↗</button>';
  $("title").textContent = titles[view][0];
  $("subtitle").textContent = titles[view][1];
  $("breadcrumb").textContent = document
    .querySelector(`[data-view="${view}"]`)
    .textContent.replace(/\d+/g, "")
    .trim()
    .slice(1)
    .trim();
  $("nav-total").textContent = emails.length;
  $("nav-focus").textContent = emails.filter(needsAttention).length;
  $("nav-review").textContent = emails.filter(needsReview).length;
  const stats = [
    [
      "Messages in view",
      emails.length,
      "▤",
      demo ? "Synthetic sample inbox" : "Imported locally",
    ],
    [
      "Need your attention",
      emails.filter(needsAttention).length,
      "✳",
      "Urgent or reply needed",
    ],
    [
      "Ready for a quieter moment",
      judged.filter((e) => e.result.priority === "low").length,
      "◷",
      "Low priority suggestions",
    ],
    [
      "Worth a second look",
      emails.filter(needsReview).length,
      "◇",
      "Uncertain or flagged for review",
    ],
  ];
  $("stats").innerHTML = stats
    .map(
      ([label, n, icon, note]) =>
        `<div class="stat"><div class="stat-head">${label}<span class="stat-icon">${icon}</span></div><div class="stat-value">${n}</div><small>${note}</small></div>`,
    )
    .join("");
  document
    .querySelectorAll("[data-view]")
    .forEach((el) => el.classList.toggle("active", el.dataset.view === view));
  document
    .querySelectorAll("[data-tab]")
    .forEach((el) => el.classList.toggle("active", el.dataset.tab === tab));
  const mail = ["inbox", "focus", "review"].includes(view);
  $("mail-view").hidden = !mail;
  $("extra-view").hidden = mail;
  $("gmail-controls").hidden = demo;
  $("sync").disabled = !state.connected;
  $("more").hidden = !state.cursor;
  $("classify").disabled = !state.connected || !emails.some((e) => !e.result);
  $("footer-status").textContent = demo
    ? "Authored demo fixtures · zero inference calls"
    : `${state.stats.attempts} inference attempts · ${state.stats.completed} valid results`;
  if (mail) renderMail();
  else renderExtra();
}
function renderMail() {
  const emails = filtered();
  $("tab-count").textContent = emails.length;
  if (!emails.some((e) => e.id === selected)) selected = emails[0]?.id ?? null;
  $("mail-list").innerHTML = emails.length
    ? emails
        .map((e) => {
          const r = e.result,
            date = new Date(e.timestamp).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            });
          const initials = senderName(e)
            .split(/\s+/)
            .slice(0, 2)
            .map((s) => s[0])
            .join("")
            .toUpperCase();
          return `<button class="mail-row ${selected === e.id ? "selected" : ""}" data-message="${esc(e.id)}" aria-pressed="${selected === e.id}"><span class="sender-avatar">${esc(initials)}</span><span class="mail-main"><span class="row-top"><span class="sender">${esc(senderName(e))}</span><span class="row-time">${esc(date)}</span></span><div class="subject">${esc(e.subject)}</div><div class="snippet">${esc(e.body.slice(0, 140))}</div><span class="pills">${r ? pill(names[category(e)], category(e)) : pill("Awaiting classification")}${r?.priority === "urgent" ? pill("↑ Urgent", "urgent") : ""}${signal(e, "reply") >= 0.65 ? pill("Reply needed", "reply") : ""}${signal(e, "risk") >= 0.35 ? pill("Review risk", "risk") : needsReview(e) ? pill("Needs review", "review") : ""}${e.approved ? pill("✓ Reviewed") : ""}${r ? `<span class="confidence">${e.approved_category && e.approved_category !== r.category ? "Edited by you" : pct(r.confidence)}</span>` : ""}</span></span></button>`;
        })
        .join("")
    : '<div class="empty">A little breathing room.<br>No messages match this view.<br>Import Gmail messages or change your filters to get started.</div>';
  renderDetail();
}
function renderDetail() {
  const e = state.messages.find((e) => e.id === selected);
  if (!e) {
    $("detail").innerHTML =
      '<div class="empty">Select a message to explore its classification.</div>';
    return;
  }
  const r = e.result,
    receipt = state.receipts.find(
      (x) =>
        x.message_id === e.id && !["undone", "not_applied"].includes(x.status),
    );
  const name = category(e);
  let analysis = r
    ? `<div class="decision-heading">✦ ${r.source === "demo" ? "Sample classification" : "Jev’s classification"}<span>${r.source === "demo" ? "Authored fixture" : `${r.latency_ms} ms`}</span></div><div class="metric"><span>${esc(names[r.category])} confidence</span><strong>${pct(r.confidence)}</strong></div><div class="meter"><progress max="100" value="${Math.round(r.confidence * 100)}" aria-label="Category confidence"></progress></div><div class="metric"><span>Importance</span><strong>${r.importance} / 100</strong></div><div class="metric"><span>Reply requested</span><strong>${pct(r.signals.reply)} probability</strong></div><div class="metric"><span>Potential risk</span><strong>${pct(r.signals.risk)} probability</strong></div>${r.rules.map((rule) => `<div class="metric"><span>${esc(rule.name)}</span><strong>${pct(rule.probability)}</strong></div>`).join("")}${r.review_reasons.length ? `<div class="review-note">◇ ${r.review_reasons.map(esc).join(" · ")}</div>` : ""}<label>Review category<select id="review-category" ${receipt ? "disabled" : ""}>${options(name)}</select></label><div id="label-preview" class="label-preview">${previewLabels(e, name).map(esc).join("<br>")}</div><button class="button secondary" data-review="${esc(e.id)}" ${receipt ? "disabled" : ""}>${e.approved ? "Save reviewed labels" : "Approve these labels"}</button><button class="button primary" data-apply="${esc(e.id)}" ${!e.approved || receipt ? "disabled" : ""}>${receipt ? (receipt.status === "verified" ? "✓ Label change verified" : "Check receipt outcome") : state.mode === "demo" ? "Apply to demo" : "Apply labels to Gmail"}</button><small>${state.mode === "demo" ? "This is a local simulation. No Gmail changes or Jev calls." : "Adds only the labels shown. Does not archive, mark read, or send mail."}</small><details><summary>See the full category distribution</summary><div class="distribution">${Object.entries(
        r.probabilities,
      )
        .sort((a, b) => b[1] - a[1])
        .map(([k, p]) => `<span>${names[k]}</span><span>${pct(p)}</span>`)
        .join(
          "",
        )}</div><p>Confidence guides review; it does not prove correctness. Model: ${esc(r.model)}</p></details>`
    : '<div class="empty">Ready for a fresh perspective.<br>Use “Classify with Jev” to evaluate up to 10 unclassified messages.</div>';
  $("detail").innerHTML =
    `<div class="detail-eyebrow"><span>Message detail</span><span>${r?.source === "demo" ? "DEMO" : ""}</span></div><h2>${esc(e.subject)}</h2><div class="detail-from">${esc(e.sender)}<br>${esc(new Date(e.timestamp).toLocaleString())}</div><div class="message-body">${esc(e.body)}</div>${e.truncated ? '<div class="review-note">Message body is truncated or partly unavailable. Review the original in Gmail.</div>' : ""}${analysis}`;
}
function previewLabels(e, cat) {
  const r = e.result;
  const labels = [`JevZero/Category/${cat}`, `JevZero/Priority/${r.priority}`];
  for (const [key, label] of [
    ["reply", "Reply needed"],
    ["risk", "Review risk"],
    ["newsletter", "Newsletter"],
    ["receipt", "Receipt"],
  ])
    if (r.signals[key] >= (key === "risk" ? 0.35 : 0.65))
      labels.push(`JevZero/Signals/${label}`);
  for (const rule of r.rules)
    if (rule.probability >= 0.65) labels.push(`JevZero/Rules/${rule.name}`);
  return labels;
}
function renderExtra() {
  const e = state.messages,
    root = $("extra-view");
  if (view === "digest") {
    const groups = [
      ["01", "Waiting on you", e.filter((x) => signal(x, "reply") >= 0.65)],
      ["02", "Keep an eye on", e.filter((x) => signal(x, "risk") >= 0.35)],
      [
        "03",
        "Save for a slower moment",
        e.filter((x) => signal(x, "newsletter") >= 0.65),
      ],
    ];
    root.innerHTML = groups
      .map(
        ([n, title, list]) =>
          `<div class="panel"><div class="eyebrow">${n} / YOUR READING LIST</div><h2>${title}</h2>${list.length ? list.map((m) => `<button class="digest-item" data-open-message="${esc(m.id)}">${esc(m.subject)}<small>${esc(senderName(m))} · ${esc(m.body.slice(0, 160))}…</small></button>`).join("") : "<p>Nothing here right now.</p>"}</div>`,
      )
      .join("");
  } else if (view === "analytics") {
    const judged = e.filter((x) => x.result),
      avg = judged.length
        ? Math.round(
            (judged.reduce((n, x) => n + x.result.confidence, 0) /
              judged.length) *
              100,
          )
        : 0;
    root.innerHTML = `<div class="analytics-grid"><div class="panel"><h2>Where your mail lands</h2>${Object.entries(
      names,
    )
      .map(([k, n]) => {
        const count = e.filter((x) => category(x) === k).length;
        return `<div class="bar-row"><span>${n}</span><progress max="${Math.max(e.length, 1)}" value="${count}" aria-label="${n}"></progress><span>${count}</span></div>`;
      })
      .join(
        "",
      )}</div><div class="panel"><h2>A view into the decisions</h2><h1>${avg}%</h1><p>Average category confidence across ${judged.length} classified messages. This is a model signal, not measured accuracy.</p><h3>${e.filter((x) => x.approved).length} reviewed by you</h3><p>Corrections are saved per message. They do not train or fine-tune Jev.</p><h3>${state.mode === "demo" ? 0 : state.stats.attempts} inference attempts</h3><p>${state.mode === "demo" ? "The demo uses authored fixtures and makes no model calls." : `${state.stats.completed} valid responses. Mean successful request latency: ${state.stats.completed ? Math.round(state.stats.latency_ms / state.stats.completed) : 0} ms. Counters include interrupted attempts.`}</p></div></div>`;
  } else if (view === "rules") {
    root.innerHTML = `<div class="panel"><h2>Your rules, in plain English.</h2><p>Give a rule a short label and describe when it applies. Several rules can match the same email. Matches suggest labels; you approve every change.</p><div id="rule-list">${state.settings.rules.map(ruleRow).join("")}</div><button class="button secondary" id="add-rule">+ Add a rule</button><p class="muted">Example: “Customer requests” → “A customer is asking for help, a refund, or a product change.” Up to six rules.</p><label>Flag category or priority confidence below <input id="threshold" type="number" step="0.05" min="0" max="1" value="${state.settings.threshold}"></label><div class="panel-actions"><button id="save-settings" class="button primary">Save preferences</button></div><p class="muted">Saving clears unreviewed Gmail classifications for a fresh evaluation. Reviewed decisions stay fixed. Demo judgments are fixed examples and do not evaluate custom rules.</p></div>`;
  } else if (view === "activity") {
    root.innerHTML = `<div class="panel"><h2>A clear trail.</h2><p>Undo removes only label IDs added by that action. Existing labels stay in place. Empty label definitions remain in Gmail.</p>${state.receipts.length ? state.receipts.map((r) => `<div class="receipt"><div class="receipt-main"><strong>${esc(state.messages.find((m) => m.id === r.message_id)?.subject || r.message_id)}</strong><small>${esc(new Date(r.time * 1000).toLocaleString())} · ${esc(r.status)} · ${state.mode === "demo" ? "SIMULATED" : "GMAIL"}</small><small>${r.names.map(esc).join(" · ")}</small></div>${["verified", "partial"].includes(r.status) ? `<button class="button secondary" data-undo="${esc(r.id)}">↺ Undo labels</button>` : !["undone", "not_applied"].includes(r.status) ? `<button class="button secondary" data-reconcile="${esc(r.id)}">Check outcome</button>` : pill(r.status === "undone" ? "Undone" : "Not applied")}</div>`).join("") : '<div class="empty">No changes yet. Your first reviewed label action will appear here.</div>'}</div>`;
  }
}
function ruleRow(rule = { name: "", condition: "" }) {
  return `<div class="rule-row"><label>Label name<input class="rule-name" maxlength="40" value="${esc(rule.name)}" placeholder="Customer requests"></label><label>When should it match?<textarea class="rule-condition" maxlength="500" placeholder="A customer is asking for help…">${esc(rule.condition)}</textarea></label><button class="text-button" data-remove-rule>Remove</button></div>`;
}
document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || working) return;
  if (target.dataset.view) {
    view = target.dataset.view;
    tab = "all";
    $("search").value = "";
    $("category-filter").value = "";
    render();
  }
  if (target.dataset.tab) {
    tab = target.dataset.tab;
    render();
  }
  if (target.dataset.message) {
    selected = target.dataset.message;
    renderMail();
    $("detail").scrollTop = 0;
  }
  if (target.dataset.openMessage) {
    selected = target.dataset.openMessage;
    view = "inbox";
    tab = "all";
    $("search").value = "";
    $("category-filter").value = "";
    render();
  }
  if (target.hasAttribute("data-setup") || target.id === "setup-open")
    $("setup").showModal();
  if (target.dataset.review) {
    if (
      await command(
        "review",
        { id: target.dataset.review, category: $("review-category").value },
        "Saving your review…",
      )
    )
      toast("Review saved. Apply when you’re ready.");
  }
  if (target.dataset.apply) {
    if (
      await command(
        "apply",
        { id: target.dataset.apply },
        "Applying labels and checking the result…",
      )
    )
      toast(
        state.mode === "demo"
          ? "Demo label change verified locally."
          : "Gmail labels independently verified.",
      );
  }
  if (target.dataset.undo) {
    if (
      await command(
        "undo",
        { id: target.dataset.undo },
        "Undoing labels and verifying…",
      )
    )
      toast("Undo verified. Other labels were preserved.");
  }
  if (target.dataset.reconcile)
    await command(
      "reconcile",
      { id: target.dataset.reconcile },
      "Reading the actual outcome…",
    );
  if (target.hasAttribute("data-remove-rule"))
    target.closest(".rule-row").remove();
  if (target.id === "add-rule") {
    if (document.querySelectorAll(".rule-row").length >= 6)
      return toast("You can add up to six rules.");
    $("rule-list").insertAdjacentHTML("beforeend", ruleRow());
  }
  if (target.id === "save-settings") {
    const rules = [...document.querySelectorAll(".rule-row")].map((row) => ({
      name: row.querySelector(".rule-name").value.trim(),
      condition: row.querySelector(".rule-condition").value.trim(),
    }));
    if (
      await command(
        "settings",
        { rules, threshold: Number($("threshold").value) },
        "Saving preferences…",
      )
    )
      toast(
        "Preferences saved. Unreviewed Gmail messages are ready to classify again.",
      );
  }
});
$("connection").onclick = () => {
  if (state.connected) {
    if (
      confirm(
        "Disconnect Gmail and delete locally cached Gmail messages? Google permissions and action receipts remain. Revoke access separately in your Google account if desired.",
      )
    )
      command("disconnect", {}, "Disconnecting…");
  } else $("setup").showModal();
};
$("connect-now").onclick = () =>
  command("connect", {}, "Opening Google authorization…");
$("switch-mode").onclick = () => {
  selected = null;
  command("mode", { mode: state.mode === "demo" ? "gmail" : "demo" });
};
$("mobile-mail").onclick = () => {
  if (state.mode === "demo" && !state.connected) $("setup").showModal();
  else $("switch-mode").click();
};
$("sync").onclick = () =>
  command(
    "sync",
    { query: $("gmail-query").value },
    "Importing up to 25 emails; nothing is sent to Jev…",
  );
$("more").onclick = () =>
  command(
    "sync",
    { query: $("gmail-query").value, more: true },
    "Importing the next page…",
  );
$("classify").onclick = () => {
  if (!$("consent").checked)
    return toast(
      "Select the TypeSafe data-sharing checkbox before classification.",
    );
  command(
    "classify",
    { consent: true },
    "Jev is classifying up to 10 messages. Completed results are saved as they arrive…",
  );
};
for (const id of ["search", "category-filter", "sort"])
  $(id).addEventListener(id === "search" ? "input" : "change", () => {
    if (state) renderMail();
  });
document.addEventListener("change", (e) => {
  if (e.target.id === "review-category") {
    const email = state.messages.find((m) => m.id === selected);
    $("label-preview").innerHTML = previewLabels(email, e.target.value)
      .map(esc)
      .join("<br>");
    const apply = document.querySelector("[data-apply]");
    if (apply) apply.disabled = true;
  }
});
$("export").onclick = () => {
  const data = {
    exported_at: new Date().toISOString(),
    mode: state.mode,
    messages: ["inbox", "focus", "review"].includes(view)
      ? filtered()
      : state.messages,
  };
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `jevzero-${state.mode}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast("Exported locally. The file includes message content.");
};
document.addEventListener("keydown", (e) => {
  if (
    e.key === "/" &&
    !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) &&
    !$("setup").open
  ) {
    e.preventDefault();
    $("search").focus();
  }
});
$("category-filter").insertAdjacentHTML("beforeend", options(""));
fetchState().catch((error) => toast(error.message));
