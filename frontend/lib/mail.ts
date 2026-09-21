import type { CustomCategory, Email, MailState, Rule } from "./types";
export const categories: Record<string, string> = {
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
export const categoryNames = (settings: MailState["settings"]) => ({
  ...categories,
  ...Object.fromEntries(
    (settings.custom_categories || []).map((c) => [c.id, c.name]),
  ),
});
export const categoryId = (name: string) =>
  name.trim().toLowerCase().replace(/[ -]+/g, "-");
export function validateCategories(items: CustomCategory[]) {
  if (items.length > 12)
    throw Error("You can create up to 12 custom categories.");
  const ids = new Set(Object.keys(categories));
  const names = new Set(
    Object.values(categories).map((name) => name.toLowerCase()),
  );
  for (const item of items) {
    if (
      !/^[A-Za-z][A-Za-z0-9 -]{0,39}$/.test(item.name) ||
      item.id !== categoryId(item.name) ||
      ids.has(item.id) ||
      names.has(item.name.trim().toLowerCase()) ||
      !item.description.trim() ||
      item.description.trim().length > 500
    )
      throw Error(
        "Use unique category names (1–40 letters, numbers, spaces or hyphens) and descriptions (1–500 characters).",
      );
    ids.add(item.id);
    names.add(item.name.trim().toLowerCase());
  }
}
export const sender = (e: Email) => e.sender.split("<")[0].trim() || e.sender;
export const category = (e: Email) =>
  e.approved_category || e.result?.category || "";
export const signal = (e: Email, k: string) => e.result?.signals[k] ?? 0;
export const attention = (e: Email) =>
  e.result?.priority === "urgent" || signal(e, "reply") >= 0.65;
export const review = (e: Email) =>
  !!e.result?.review_reasons.length && !e.approved;
export const percent = (n: number) => `${Math.round(n * 100)}%`;
export function labels(e: Email, cat = category(e), options = categories) {
  if (!e.result || !Object.hasOwn(options, cat)) return [];
  const values = [
    `JevZero/Category/${cat}`,
    `JevZero/Priority/${e.result.priority}`,
  ];
  for (const [key, name] of [
    ["reply", "Reply needed"],
    ["risk", "Review risk"],
    ["newsletter", "Newsletter"],
    ["receipt", "Receipt"],
  ])
    if (signal(e, key) >= (key === "risk" ? 0.35 : 0.65))
      values.push(`JevZero/Signals/${name}`);
  for (const rule of e.result.rules)
    if (rule.probability >= 0.65) values.push(`JevZero/Rules/${rule.name}`);
  return values;
}
export function validateRules(rules: Rule[], threshold: number) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
    throw Error("Choose a confidence threshold between 0 and 1.");
  if (rules.length > 6) throw Error("You can create up to six rules.");
  const seen = new Set();
  for (const r of rules) {
    if (
      !/^[A-Za-z][A-Za-z0-9 -]{0,39}$/.test(r.name) ||
      !r.condition.trim() ||
      r.condition.length > 500 ||
      seen.has(r.name.toLowerCase())
    )
      throw Error(
        "Use unique rule names (1–40 characters) and a condition of 1–500 characters.",
      );
    seen.add(r.name.toLowerCase());
  }
}
export function demoCommand(
  previous: MailState,
  name: string,
  body: Record<string, unknown>,
): MailState {
  if (previous.mode !== "demo")
    throw Error("Demo commands cannot change Gmail.");
  const s = structuredClone(previous),
    email = s.messages.find((e) => e.id === body.id);
  if (name === "settings") {
    const rules = body.rules as Rule[],
      threshold = Number(body.threshold);
    validateRules(rules, threshold);
    const custom_categories = (body.custom_categories ??
      s.settings.custom_categories ??
      []) as CustomCategory[];
    validateCategories(custom_categories);
    for (const old of s.settings.custom_categories || []) {
      if (
        !custom_categories.some((c) => c.id === old.id && c.name === old.name)
      )
        throw Error("Saved categories cannot be removed or renamed.");
    }
    s.settings = { rules, threshold, custom_categories };
    s.categories = categoryNames(s.settings);
    return s;
  }
  if (name === "undo") {
    const receipt = s.receipts.find((r) => r.id === body.id);
    if (!receipt || receipt.status !== "verified")
      throw Error("This action cannot be undone.");
    const e = s.messages.find((e) => e.id === receipt.message_id)!;
    e.label_ids = e.label_ids.filter((id) => !receipt.added.includes(id));
    receipt.status = "undone";
    return s;
  }
  if (!email || !email.result)
    throw Error("Select a classified message first.");
  if (
    s.receipts.some(
      (r) =>
        r.message_id === email.id &&
        r.status !== "undone" &&
        r.status !== "not_applied",
    )
  )
    throw Error("Undo the existing label action before making another change.");
  if (name === "review") {
    const cat = String(body.category);
    if (!Object.hasOwn(categoryNames(s.settings), cat))
      throw Error("Choose a valid category.");
    email.approved = true;
    email.approved_category = cat;
    email.proposed_labels = labels(email, cat, categoryNames(s.settings));
  } else if (name === "apply") {
    if (!email.approved || !email.proposed_labels)
      throw Error("Review the proposed labels first.");
    const added = email.proposed_labels.filter(
      (id) => !email.label_ids.includes(id),
    );
    email.label_ids = [...email.label_ids, ...added];
    s.receipts.unshift({
      id: crypto.randomUUID(),
      time: Date.now() / 1000,
      mode: "demo",
      message_id: email.id,
      names: email.proposed_labels,
      status: "verified",
      added,
    });
  } else throw Error("This action requires a live Gmail workspace.");
  return s;
}
