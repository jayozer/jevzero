"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CheckCheck,
  ChevronDown,
  Clock3,
  Folder,
  Home,
  Inbox,
  Layers3,
  LoaderCircle,
  Mail,
  Menu,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Undo2,
  X,
  AlertCircle,
  Plus,
  Trash2,
  LockKeyhole,
} from "lucide-react";
import fixture from "@/lib/demo-state.json";
import {
  attention,
  categoryNames,
  categoryId,
  validateCategories,
  category,
  demoCommand,
  labels,
  percent,
  review,
  sender,
  signal,
  validateRules,
} from "@/lib/mail";
import type { CustomCategory, Email, MailState, Rule } from "@/lib/types";

type View =
  | "overview"
  | "inbox"
  | "attention"
  | "review"
  | "digest"
  | "insights"
  | "rules"
  | "activity";
const navigation = [
  { id: "overview", label: "Overview", icon: Home },
  { id: "inbox", label: "Inbox", icon: Inbox },
  { id: "attention", label: "Needs attention", icon: AlertCircle },
  { id: "review", label: "Review queue", icon: Layers3 },
  { id: "digest", label: "Your digest", icon: Mail },
  { id: "rules", label: "Categories & rules", icon: Settings2 },
  { id: "insights", label: "Insights", icon: BarChart3 },
  { id: "activity", label: "Activity", icon: Undo2 },
] as const;
const headings: Record<View, [string, string]> = {
  overview: [
    "Clear inbox. Clear head.",
    "A little intelligence. A lot less noise.",
  ],
  inbox: [
    "Everything in its place.",
    "A clear view of what matters, and what can wait.",
  ],
  attention: [
    "Start with what matters.",
    "The conversations that could use a little of your attention.",
  ],
  review: [
    "Your judgment matters.",
    "A second look for uncertain or potentially risky messages.",
  ],
  digest: [
    "Make a little reading room.",
    "A digest of original subjects and excerpts, collected for you.",
  ],
  insights: [
    "See the bigger picture.",
    "An honest look at your inbox and its classifications.",
  ],
  rules: [
    "Make it feel like your inbox.",
    "Tell Jev what matters. Keep the decisions in your hands.",
  ],
  activity: [
    "Nothing happens in the dark.",
    "A clear trail of reviewed changes. And a way back.",
  ],
};
const time = (e: Email) =>
  new Date(e.timestamp).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
const initials = (value: string) =>
  value
    .split(/\s+/)
    .slice(0, 2)
    .map((x) => x[0])
    .join("")
    .toUpperCase();
const seed = () => structuredClone(fixture) as MailState;
async function request(path: string, body?: unknown) {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "The request could not complete.");
  return data;
}

export default function Dashboard() {
  const [state, setState] = useState<MailState>(seed),
    [view, setView] = useState<View>("overview"),
    [selected, setSelected] = useState<string | null>("demo-1"),
    [tab, setTab] = useState("all"),
    [search, setSearch] = useState(""),
    [cat, setCat] = useState(""),
    [sort, setSort] = useState("newest"),
    [draftCategory, setDraftCategory] = useState("work"),
    [busy, setBusy] = useState(""),
    [toast, setToast] = useState(""),
    [mobile, setMobile] = useState(false),
    [mobileDetail, setMobileDetail] = useState(false),
    [modal, setModal] = useState<"connect" | "classify" | "disconnect" | null>(
      null,
    ),
    [keys, setKeys] = useState({
      typesafe_key: "",
      google_client_id: "",
      google_client_secret: "",
    }),
    [connections, setConnections] = useState({
      typesafe: false,
      google: false,
    }),
    [profile, setProfile] = useState<MailState["google_profile"]>(null),
    [session, setSession] = useState({
      authenticated: false,
      configured: false,
    }),
    [query, setQuery] = useState("in:inbox newer_than:30d"),
    [rules, setRules] = useState<Rule[]>([]),
    [customCategories, setCustomCategories] = useState<CustomCategory[]>([]),
    [threshold, setThreshold] = useState(0.75),
    [consent, setConsent] = useState(false);
  const demoState = useRef<MailState>(seed()),
    searchRef = useRef<HTMLInputElement>(null),
    busyRef = useRef(false),
    modalRef = useRef<HTMLDialogElement>(null),
    returnFocus = useRef<HTMLElement | null>(null);
  const notify = (message: string) => setToast(message);
  const demo = state.mode === "demo";
  const categories = categoryNames(state.settings);
  useEffect(() => {
    request("/api/session")
      .then(async (session) => {
        setSession(session);
        if (session.authenticated) {
          const current = await request("/api/backend/state");
          setConnections(current.credentials);
          setProfile(current.google_profile);
          if (current.connected) {
            setState(current);
            setConnections(current.credentials);
            setProfile(current.google_profile);
            setSelected(current.messages[0]?.id ?? null);
          }
        }
      })
      .catch((e) => notify(e.message));
    if (new URLSearchParams(location.search).has("oauth"))
      notify("Google connection was not completed. Try connecting again.");
    if (location.search) history.replaceState(null, "", "/");
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 8000);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") setMobile(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  useEffect(() => {
    if (modal) {
      returnFocus.current = document.activeElement as HTMLElement;
      modalRef.current?.showModal();
    } else {
      modalRef.current?.close();
      returnFocus.current?.focus();
    }
  }, [modal]);
  useEffect(() => {
    setRules(structuredClone(state.settings.rules));
    setCustomCategories(
      structuredClone(state.settings.custom_categories || []),
    );
    setThreshold(state.settings.threshold);
  }, [state.settings]);
  const emails = useMemo(() => {
    let list = state.messages.filter(
      (e) =>
        (!search ||
          `${e.sender} ${e.subject} ${e.body}`
            .toLowerCase()
            .includes(search.toLowerCase())) &&
        (!cat || category(e) === cat),
    );
    if (view === "attention") list = list.filter(attention);
    if (view === "review") list = list.filter(review);
    if (tab === "low") list = list.filter((e) => e.result?.priority === "low");
    if (tab === "reply") list = list.filter((e) => signal(e, "reply") >= 0.65);
    if (tab === "newsletters")
      list = list.filter((e) => signal(e, "newsletter") >= 0.65);
    return [...list].sort((a, b) =>
      sort === "importance"
        ? (b.result?.importance ?? -1) - (a.result?.importance ?? -1)
        : sort === "confidence"
          ? (a.result?.confidence ?? 1) - (b.result?.confidence ?? 1)
          : b.timestamp - a.timestamp,
    );
  }, [state.messages, search, cat, view, tab, sort]);
  const email = emails.find((e) => e.id === selected) || emails[0];
  useEffect(() => {
    setDraftCategory(email ? category(email) : "");
  }, [email?.id, email?.approved_category, email?.result?.category]);
  const counts = {
    attention: state.messages.filter(attention).length,
    review: state.messages.filter(review).length,
    low: state.messages.filter((e) => e.result?.priority === "low").length,
  };
  const navigate = (next: View) => {
    setView(next);
    setTab("all");
    setCat("");
    setSearch("");
    setMobile(false);
    setMobileDetail(false);
  };
  async function run(name: string, body: Record<string, unknown> = {}) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(
      name === "classify"
        ? "Jev is classifying your messages…"
        : "Saving and verifying your changes…",
    );
    try {
      if (demo) {
        const next = demoCommand(state, name, body);
        setState(next);
        demoState.current = next;
      } else {
        const job = await request(`/api/backend/commands/${name}`, body);
        sessionStorage.setItem("jevzero-pending-job", job.id);
        let done = false;
        for (let n = 0; n < 600; n++) {
          const status = await request(`/api/backend/jobs/${job.id}`);
          if (["succeeded", "failed", "interrupted"].includes(status.status)) {
            done = true;
            sessionStorage.removeItem("jevzero-pending-job");
            const fresh = await request("/api/backend/state");
            setState(fresh);
            setConnections(fresh.credentials);
            setProfile(fresh.google_profile);
            if (status.status !== "succeeded")
              throw Error(
                status.error || "Operation interrupted. Check Activity.",
              );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!done)
          throw Error(
            "This operation is still running. Reopen the live workspace to check its outcome.",
          );
      }
      notify(
        name === "review"
          ? "Review saved. Apply the exact labels when you’re ready."
          : name === "apply"
            ? demo
              ? "Demo labels applied. No Gmail changes."
              : "Gmail labels verified independently."
            : name === "undo"
              ? "Undo verified. Other labels were preserved."
              : name === "settings"
                ? demo
                  ? "Preferences saved for this demo. Sample judgments remain fixed."
                  : "Preferences saved. Unreviewed emails are ready to classify again."
                : "Workspace updated.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
      busyRef.current = false;
    }
  }
  async function liveWorkspace() {
    if (busyRef.current) return;
    if (!session.authenticated) {
      setModal("connect");
      return;
    }
    setBusy("Opening your workspace…");
    busyRef.current = true;
    try {
      const pending = sessionStorage.getItem("jevzero-pending-job");
      if (pending) {
        const job = await request(`/api/backend/jobs/${pending}`);
        if (["queued", "running"].includes(job.status))
          throw Error(
            "Your previous operation is still running. Wait before opening the workspace again.",
          );
        sessionStorage.removeItem("jevzero-pending-job");
        if (job.status !== "succeeded")
          notify(
            job.error ||
              "Previous operation was interrupted. Inspect Activity.",
          );
      }
      const next = await request("/api/backend/state");
      if (demo) demoState.current = state;
      setState(next);
      setConnections(next.credentials);
      setProfile(next.google_profile);
      next.messages[0]?.id ?? null;
      navigate("inbox");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
      busyRef.current = false;
    }
  }
  async function connect() {
    if (!session.authenticated) {
      setModal("connect");
      return;
    }
    if (!connections.google) {
      setModal("connect");
      return;
    }
    if (state.connected) {
      await liveWorkspace();
      return;
    }
    setBusy("Opening Google authorization…");
    try {
      const current = await request("/api/backend/state");
      if (current.connected) {
        setState(current);
        setConnections(current.credentials);
        setProfile(current.google_profile);
        setModal(null);
        navigate("inbox");
        setBusy("");
        return;
      }
      const data = await request("/api/backend/connect", {});
      location.assign(data.url);
    } catch (e) {
      notify((e as Error).message);
      setBusy("");
    }
  }
  async function saveKeys(
    e?: React.FormEvent,
    remove?: "remove_typesafe" | "remove_google",
  ) {
    e?.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy("Saving local connection settings…");
    try {
      const result = await request(
        "/api/backend/credentials",
        remove ? { [remove]: true } : keys,
      );
      setConnections(result);
      setKeys({
        typesafe_key: "",
        google_client_id: "",
        google_client_secret: "",
      });
      notify(
        remove
          ? "Credentials removed from this workspace."
          : "Saved locally. Keys stay hidden after saving; no paid test request was made.",
      );
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy("");
      busyRef.current = false;
    }
  }
  function exportView() {
    const payload = {
      mode: state.mode,
      exported_at: new Date().toISOString(),
      messages: emails,
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `jevzero-${state.mode}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Exported to your device. The file includes message content.");
  }
  const inboxView = ["overview", "inbox", "attention", "review"].includes(view);
  const receipt = email
    ? state.receipts.find(
        (r) =>
          r.message_id === email.id &&
          !["undone", "not_applied"].includes(r.status),
      )
    : undefined;

  return (
    <div className="app-shell">
      {mobile && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside className={`sidebar ${mobile ? "is-open" : ""}`}>
        <button
          className="wordmark"
          onClick={() => navigate("overview")}
          aria-label="JevZero home"
        >
          <span className="zero-mark">0</span>
          <span>JevZero</span>
        </button>
        <span className="nav-caption">YOUR WORKSPACE</span>
        <nav aria-label="Main navigation">
          {navigation.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={`nav-link ${view === id ? "active" : ""}`}
              onClick={() => navigate(id)}
              aria-current={view === id ? "page" : undefined}
            >
              <Icon size={19} strokeWidth={1.65} />
              <span>{label}</span>
              {id === "attention" && counts.attention > 0 && (
                <b className="warm-count">{counts.attention}</b>
              )}
              {id === "review" && counts.review > 0 && <b>{counts.review}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Less email.
            <br />A more human day.
          </p>
          <span className="little-line" />
          <div className="workspace-switch">
            <span className="owner-avatar">
              {profile?.picture && !demo ? (
                <img
                  src={profile.picture}
                  alt=""
                  referrerPolicy="no-referrer"
                />
              ) : demo ? (
                "D"
              ) : (
                initials(profile?.name || state.account || "Your Workspace")
              )}
            </span>
            <div>
              <strong>{demo ? "Demo workspace" : "Your workspace"}</strong>
              <small>
                {demo
                  ? "Made for a quieter inbox"
                  : profile?.email || state.account || "Ready to connect"}
              </small>
            </div>
            <ChevronDown size={14} />
          </div>
          <button
            className="sidebar-action"
            disabled={!!busy}
            onClick={() =>
              demo
                ? liveWorkspace()
                : (setState(demoState.current), navigate("overview"))
            }
          >
            {demo ? (
              <>
                <ArrowUpRight size={14} /> Open my Gmail
              </>
            ) : (
              <>
                <Sparkles size={14} /> Explore the demo
              </>
            )}
          </button>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setMobile(!mobile)}
            aria-label="Open navigation"
            aria-expanded={mobile}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{navigation.find((n) => n.id === view)?.label}</strong>
          </div>
          <label className="global-search">
            <Search size={16} />
            <input
              ref={searchRef}
              aria-label="Search emails"
              placeholder="Search emails, senders, or words…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (!inboxView) setView("inbox");
              }}
            />
            <kbd>⌘ K</kbd>
          </label>
          <span className={`mode-tag ${demo ? "is-demo" : ""}`}>
            {demo ? "DEMO" : "GMAIL"}
          </span>
          <button
            className="profile-button"
            disabled={!!busy}
            onClick={() => setModal("connect")}
            aria-label="Workspace connection"
          >
            <span>
              {profile?.picture ? (
                <img
                  src={profile.picture}
                  alt="Your Google profile"
                  referrerPolicy="no-referrer"
                />
              ) : demo ? (
                "D"
              ) : (
                "J"
              )}
            </span>
            <ChevronDown size={14} />
          </button>
        </header>
        <div className="page-content">
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                {demo
                  ? "A FRESH PERSPECTIVE ON YOUR INBOX"
                  : "YOUR INBOX, WITH INTENTION"}
              </div>
              <h1>{headings[view][0]}</h1>
              <p>{headings[view][1]}</p>
            </div>
            <button
              className="button dark"
              onClick={() => setModal("connect")}
              disabled={!!busy}
            >
              <GoogleMark />
              {state.connected && !demo ? "Gmail connected" : "Connect Gmail"}
              <ArrowUpRight size={15} />
            </button>
          </section>
          {view === "overview" && (
            <section className="brief">
              <div className="brief-copy">
                <div className="eyebrow">YOUR DAILY BRIEF</div>
                <h2>
                  {state.messages.length} emails.
                  <br className="brief-break" /> {counts.attention} need you.
                </h2>
                <p>Start with what matters. Let the rest wait.</p>
                <button
                  className="button dark"
                  onClick={() => navigate("attention")}
                >
                  Review your inbox <ArrowRight size={17} />
                </button>
              </div>
              <div className="brief-art">
                <Image
                  src="/quiet-zero.png"
                  alt="A sculptural sage glass zero and a folded paper envelope"
                  fill
                  sizes="(max-width: 700px) 100vw, 500px"
                  priority
                />
              </div>
              <span className="brief-note">
                SORT
                <br />
                FOCUS
                <br />
                BREATHE
                <br />
                REPEAT<span>JevZero</span>
              </span>
            </section>
          )}
          {inboxView && (
            <>
              <section className="metrics" aria-label="Inbox summary">
                <button onClick={() => navigate("attention")}>
                  <strong>{counts.attention}</strong>
                  <div>
                    <b>Needs attention</b>
                    <small>Urgent or reply requested</small>
                  </div>
                  <ArrowUpRight size={17} />
                </button>
                <button onClick={() => navigate("review")}>
                  <strong>{counts.review}</strong>
                  <div>
                    <b>To review</b>
                    <small>Worth a second look</small>
                  </div>
                  <Layers3 size={18} />
                </button>
                <button
                  onClick={() => {
                    navigate("inbox");
                    setTab("low");
                  }}
                >
                  <strong>{counts.low}</strong>
                  <div>
                    <b>Can wait</b>
                    <small>Low-priority suggestions</small>
                  </div>
                  <Clock3 size={18} />
                </button>
              </section>
              {!demo && (
                <section className="live-controls">
                  <label>
                    <span>Import from Gmail</span>
                    <input
                      aria-label="Gmail query"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </label>
                  <button
                    className="button light"
                    disabled={!!busy || !state.connected}
                    onClick={() => run("sync", { query })}
                  >
                    Import 25 emails
                  </button>
                  {state.cursor && (
                    <button
                      className="button light"
                      disabled={!!busy}
                      onClick={() => run("sync", { query, more: true })}
                    >
                      Next 25
                    </button>
                  )}
                  <button
                    className="button dark"
                    disabled={!!busy || !state.messages.some((e) => !e.result)}
                    onClick={() =>
                      setModal(connections.typesafe ? "classify" : "connect")
                    }
                  >
                    <Sparkles size={15} /> Classify with Jev
                  </button>
                  {!state.connected && (
                    <p>
                      Connect Gmail to import your first batch. Nothing is sent
                      to Jev until you choose to classify it.
                    </p>
                  )}
                </section>
              )}
              <div
                className={`inbox-grid ${mobileDetail ? "show-detail" : ""}`}
              >
                <section className="email-panel" aria-label="Message list">
                  <div className="list-tabs">
                    {[
                      ["all", "All mail"],
                      ["reply", "Reply needed"],
                      tab === "low"
                        ? ["low", "Can wait"]
                        : ["newsletters", "Newsletters"],
                    ].map(([id, label]) => (
                      <button
                        key={id}
                        className={tab === id ? "active" : ""}
                        onClick={() => setTab(id)}
                      >
                        {label}
                        {id === "all" && <span>({emails.length})</span>}
                      </button>
                    ))}
                    <button
                      className="icon-button export-button"
                      title="Export current view"
                      aria-label="Export current view"
                      onClick={exportView}
                    >
                      <ArrowDownToLine size={15} />
                    </button>
                  </div>
                  <div className="list-filters">
                    <label>
                      <Folder size={13} />
                      <select
                        aria-label="Filter category"
                        value={cat}
                        onChange={(e) => setCat(e.target.value)}
                      >
                        <option value="">All categories</option>
                        {Object.entries(categories).map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="sort-control">
                      <select
                        aria-label="Sort messages"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="newest">Newest first</option>
                        <option value="importance">Importance</option>
                        <option value="confidence">Lowest confidence</option>
                      </select>
                    </label>
                  </div>
                  <div className="email-list">
                    {emails.length ? (
                      emails.map((e, index) => (
                        <button
                          key={e.id}
                          className={`email-row ${email?.id === e.id ? "selected" : ""}`}
                          onClick={() => {
                            setSelected(e.id);
                            setMobileDetail(true);
                          }}
                          aria-pressed={email?.id === e.id}
                        >
                          <span className={`sender-avatar avatar-${index % 4}`}>
                            {initials(sender(e))}
                          </span>
                          <span className="email-row-content">
                            <span className="email-row-top">
                              <strong>{sender(e)}</strong>
                              <time>{time(e)}</time>
                            </span>
                            <span className="email-subject">{e.subject}</span>
                            <span className="email-preview">{e.body}</span>
                            <span className="email-labels">
                              <Tag kind={category(e)}>
                                {categories[category(e)] || "Unclassified"}
                              </Tag>
                              {signal(e, "reply") >= 0.65 && (
                                <Tag kind="reply">Reply needed</Tag>
                              )}
                              {signal(e, "risk") >= 0.35 ? (
                                <Tag kind="risk">Review risk</Tag>
                              ) : (
                                review(e) && (
                                  <Tag kind="review">Needs review</Tag>
                                )
                              )}
                              {e.approved && (
                                <span className="reviewed-mini">
                                  <Check size={11} /> Reviewed
                                </span>
                              )}
                            </span>
                          </span>
                        </button>
                      ))
                    ) : (
                      <Empty
                        title="A little breathing room."
                        text={
                          demo
                            ? "No emails match this view. Try another filter."
                            : "Import a batch from Gmail, or adjust your filters."
                        }
                      />
                    )}
                  </div>
                  <div className="list-foot">
                    <span>
                      {emails.length} {demo ? "sample" : "imported"} messages
                    </span>
                    <span>
                      {demo
                        ? "Synthetic data · no API calls"
                        : "Every label change is reviewed"}
                    </span>
                  </div>
                </section>
                <aside className="detail-panel" aria-label="Selected message">
                  {email ? (
                    <>
                      <button
                        className="back-to-list"
                        onClick={() => setMobileDetail(false)}
                      >
                        <ArrowLeft size={16} /> Back to inbox
                      </button>
                      <div className="detail-sender">
                        <span className="sender-avatar">
                          {initials(sender(email))}
                        </span>
                        <div>
                          <strong>{sender(email)}</strong>
                          <small>
                            {email.sender.match(/<(.+)>/)?.[1] || email.sender}
                          </small>
                        </div>
                        <time>{time(email)} UTC</time>
                      </div>
                      <h2>{email.subject}</h2>
                      <div className="message-body">{email.body}</div>
                      {email.truncated && (
                        <div className="notice warning">
                          Only part of this message was available. Review the
                          original before deciding.
                        </div>
                      )}
                      {email.result ? (
                        <>
                          <div className="judgment">
                            <div className="judgment-heading">
                              <div>
                                <span className="tiny-zero">0</span>
                                <h3>Jev’s take</h3>
                              </div>
                              <span>
                                Confidence{" "}
                                <b>{percent(email.result.confidence)}</b>
                              </span>
                            </div>
                            <div className="confidence-track">
                              <span
                                style={{
                                  width: percent(email.result.confidence),
                                }}
                              />
                            </div>
                            <p>
                              {signal(email, "reply") >= 0.65
                                ? "This message asks for a reply or decision. "
                                : "Jev does not strongly identify a reply request. "}
                              {`The suggested category is ${categories[email.result.category].toLowerCase()}.`}
                            </p>
                            {email.result.review_reasons.length > 0 && (
                              <div className="review-reasons">
                                <AlertCircle size={14} />
                                <span>
                                  {email.result.review_reasons.join(" · ")}
                                </span>
                              </div>
                            )}
                            <div className="judgment-fields">
                              <label>
                                Review category
                                <select
                                  value={draftCategory}
                                  onChange={(e) =>
                                    setDraftCategory(e.target.value)
                                  }
                                  disabled={!!receipt || !!busy}
                                >
                                  {Object.entries(categories).map(
                                    ([id, label]) => (
                                      <option value={id} key={id}>
                                        {label}
                                      </option>
                                    ),
                                  )}
                                </select>
                              </label>
                              <div>
                                <span className="field-label">
                                  Priority & importance
                                </span>
                                <div className="priority-value">
                                  <span
                                    className={`priority-dot ${email.result.priority}`}
                                  />
                                  {email.result.priority}
                                  <span>{email.result.importance}/100</span>
                                </div>
                              </div>
                            </div>
                            <div className="suggested-labels">
                              <span className="field-label">
                                Exact Gmail labels to apply
                              </span>
                              <div>
                                {labels(email, draftCategory, categories).map(
                                  (label) => (
                                    <span className="exact-label" key={label}>
                                      {label}
                                    </span>
                                  ),
                                )}
                              </div>
                            </div>
                            <details className="signal-details">
                              <summary>
                                See all signals <ChevronDown size={13} />
                              </summary>
                              <div className="signal-grid">
                                {Object.entries(email.result.signals).map(
                                  ([name, n]) => (
                                    <div key={name}>
                                      <span>{name}</span>
                                      <b>{percent(n)}</b>
                                    </div>
                                  ),
                                )}
                                {email.result.rules.map((rule) => (
                                  <div key={rule.name}>
                                    <span>{rule.name}</span>
                                    <b>{percent(rule.probability)}</b>
                                  </div>
                                ))}
                              </div>
                              <div className="probability-list">
                                {Object.entries(email.result.probabilities).map(
                                  ([id, n]) => (
                                    <div key={id}>
                                      <span>{categories[id] || id}</span>
                                      <progress max={1} value={n} />
                                      <b>{percent(n)}</b>
                                    </div>
                                  ),
                                )}
                              </div>
                              <p className="microcopy">
                                Probabilities guide review; they do not prove
                                correctness.{" "}
                                {demo
                                  ? "Authored demo judgments."
                                  : `Model: ${email.result.model}.`}
                              </p>
                            </details>
                          </div>
                          <div className="detail-actions">
                            <button
                              className="button light"
                              onClick={() =>
                                run("review", {
                                  id: email.id,
                                  category: draftCategory,
                                })
                              }
                              disabled={!!receipt || !!busy}
                            >
                              <Check size={16} />
                              {email.approved
                                ? "Save review"
                                : "Approve labels"}
                            </button>
                            <button
                              className="button dark"
                              disabled={
                                !!busy ||
                                !email.approved ||
                                !!receipt ||
                                draftCategory !== category(email)
                              }
                              onClick={() => run("apply", { id: email.id })}
                            >
                              {receipt ? (
                                <>
                                  <CheckCheck size={16} />
                                  {receipt.status === "verified"
                                    ? "Verified"
                                    : "See Activity"}
                                </>
                              ) : (
                                <>
                                  {demo ? "Apply to demo" : "Apply to Gmail"}
                                  <ArrowRight size={15} />
                                </>
                              )}
                            </button>
                          </div>
                          <p className="detail-footnote">
                            <ShieldCheck size={12} />
                            {demo
                              ? "A local simulation. Your Gmail stays untouched."
                              : "Adds only these labels. No sending, archiving, or deletion."}
                          </p>
                        </>
                      ) : (
                        <Empty
                          title="Ready for a fresh perspective."
                          text="Classify this message with Jev to see its suggested labels."
                        />
                      )}
                    </>
                  ) : (
                    <Empty
                      title="Nothing selected."
                      text="Choose a message to see what Jev thinks."
                    />
                  )}
                </aside>
              </div>
            </>
          )}
          {view === "rules" && (
            <section className="settings-panel">
              <div className="panel-intro">
                <div className="panel-icon">
                  <Settings2 size={24} />
                </div>
                <div>
                  <h2>Your categories and rules.</h2>
                  <p>
                    Several rules can match one email. Each match suggests a
                    label for you to review.
                  </p>
                </div>
              </div>
              <h3>Custom categories</h3>
              <p>
                Jev chooses one primary category per email. Describe what
                belongs in each category. Saved names stay fixed so your labels
                and past reviews remain consistent.
              </p>
              <div className="rule-list">
                {customCategories.map((item, index) => {
                  const saved = (state.settings.custom_categories || []).some(
                    (c) => c.id === item.id,
                  );
                  return (
                    <div className="rule-editor" key={index}>
                      <span className="rule-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <label>
                        Category name
                        <input
                          value={item.name}
                          maxLength={40}
                          disabled={saved || !!busy}
                          placeholder="Webinars"
                          onChange={(e) =>
                            setCustomCategories(
                              customCategories.map((c, i) =>
                                i === index
                                  ? {
                                      ...c,
                                      name: e.target.value,
                                      id: categoryId(e.target.value),
                                    }
                                  : c,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        What belongs here?
                        <textarea
                          value={item.description}
                          maxLength={500}
                          disabled={!!busy}
                          placeholder="Webinar invitations, registrations, reminders, and recordings."
                          onChange={(e) =>
                            setCustomCategories(
                              customCategories.map((c, i) =>
                                i === index
                                  ? { ...c, description: e.target.value }
                                  : c,
                              ),
                            )
                          }
                        />
                      </label>
                      {!saved && (
                        <button
                          className="icon-button"
                          disabled={!!busy}
                          aria-label={`Remove unsaved category ${index + 1}`}
                          onClick={() =>
                            setCustomCategories(
                              customCategories.filter((_, i) => i !== index),
                            )
                          }
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                className="button light"
                disabled={!!busy || customCategories.length >= 12}
                onClick={() =>
                  setCustomCategories([
                    ...customCategories,
                    { id: "", name: "", description: "" },
                  ])
                }
              >
                <Plus size={16} /> Add category
              </button>
              <h3 className="additional-rules-heading">Additional rules</h3>
              <p>
                Several rules can match the same email and suggest extra labels.
              </p>
              <div className="rule-list">
                {rules.map((rule, index) => (
                  <div className="rule-editor" key={index}>
                    <span className="rule-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <label>
                      Label name
                      <input
                        value={rule.name}
                        maxLength={40}
                        placeholder="Customer requests"
                        onChange={(e) =>
                          setRules(
                            rules.map((r, i) =>
                              i === index ? { ...r, name: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      When should it match?
                      <textarea
                        value={rule.condition}
                        maxLength={500}
                        placeholder="A customer is asking for help, a refund, or a product change."
                        onChange={(e) =>
                          setRules(
                            rules.map((r, i) =>
                              i === index
                                ? { ...r, condition: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </label>
                    <button
                      className="icon-button"
                      onClick={() =>
                        setRules(rules.filter((_, i) => i !== index))
                      }
                      aria-label={`Remove rule ${index + 1}`}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
              <button
                className="button light"
                disabled={rules.length >= 6}
                onClick={() =>
                  setRules([...rules, { name: "", condition: "" }])
                }
              >
                <Plus size={16} /> Add a rule
              </button>
              <div className="threshold-setting">
                <div>
                  <h3>Leave room for your judgment.</h3>
                  <p>
                    Flag category or priority confidence below this threshold.
                  </p>
                </div>
                <label>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={threshold}
                    onChange={(e) => setThreshold(Number(e.target.value))}
                  />{" "}
                  confidence
                </label>
              </div>
              <div className="settings-bottom">
                <p>
                  Saving clears unreviewed Gmail results for a fresh
                  classification. Reviewed decisions stay fixed. Demo judgments
                  do not evaluate custom categories or rules.
                </p>
                <button
                  className="button dark"
                  disabled={!!busy}
                  onClick={() => {
                    try {
                      validateRules(rules, threshold);
                      validateCategories(customCategories);
                      run("settings", {
                        rules,
                        threshold,
                        custom_categories: customCategories,
                      });
                    } catch (e) {
                      notify((e as Error).message);
                    }
                  }}
                >
                  Save preferences
                  <ArrowRight size={16} />
                </button>
              </div>
            </section>
          )}
          {view === "activity" && (
            <section className="content-card">
              <h2>A clear trail.</h2>
              <p className="muted">
                Undo removes only the labels added by that action. Existing
                labels stay in place.
              </p>
              {state.receipts.length ? (
                state.receipts.map((r) => (
                  <div className="receipt-row" key={r.id}>
                    <span className="receipt-icon">
                      {r.status === "undone" ? (
                        <Undo2 size={18} />
                      ) : (
                        <CheckCheck size={18} />
                      )}
                    </span>
                    <div>
                      <strong>
                        {state.messages.find((m) => m.id === r.message_id)
                          ?.subject || r.message_id}
                      </strong>
                      <small>
                        {new Date(r.time * 1000)
                          .toISOString()
                          .replace("T", " ")
                          .slice(0, 16)}{" "}
                        UTC · {r.status} ·{" "}
                        {r.mode === "demo" ? "Simulated" : "Gmail"}
                      </small>
                      <p>{r.names.join(" · ")}</p>
                    </div>
                    {["verified", "partial"].includes(r.status) ? (
                      <button
                        className="button light"
                        disabled={!!busy}
                        onClick={() => run("undo", { id: r.id })}
                      >
                        <Undo2 size={14} /> Undo labels
                      </button>
                    ) : !["undone", "not_applied"].includes(r.status) ? (
                      <button
                        className="button light"
                        onClick={() => run("reconcile", { id: r.id })}
                        disabled={!!busy}
                      >
                        Check outcome
                      </button>
                    ) : (
                      <Tag>
                        {r.status === "undone" ? "Undone" : "Not applied"}
                      </Tag>
                    )}
                  </div>
                ))
              ) : (
                <Empty
                  title="Your first receipt starts here."
                  text="Review and apply labels to a message. Every verified change will appear in this view."
                />
              )}
            </section>
          )}
          {view === "digest" && (
            <div className="digest-grid">
              {[
                [
                  "Waiting on you",
                  state.messages.filter((e) => signal(e, "reply") >= 0.65),
                ],
                [
                  "Worth a closer look",
                  state.messages.filter((e) => signal(e, "risk") >= 0.35),
                ],
                [
                  "For a slower moment",
                  state.messages.filter((e) => signal(e, "newsletter") >= 0.65),
                ],
              ].map(([title, list], i) => (
                <section className="content-card" key={String(title)}>
                  <span className="eyebrow">0{i + 1} / YOUR READING LIST</span>
                  <h2>{String(title)}</h2>
                  {(list as Email[]).length ? (
                    (list as Email[]).map((e) => (
                      <button
                        className="digest-email"
                        key={e.id}
                        onClick={() => {
                          navigate("inbox");
                          setSelected(e.id);
                          setMobileDetail(true);
                        }}
                      >
                        <strong>{e.subject}</strong>
                        <span>{sender(e)}</span>
                        <p>{e.body.slice(0, 160)}…</p>
                        <ArrowUpRight size={16} />
                      </button>
                    ))
                  ) : (
                    <p className="muted">Nothing here right now.</p>
                  )}
                </section>
              ))}
            </div>
          )}
          {view === "insights" && (
            <div className="insights-grid">
              <section className="content-card">
                <h2>Where your mail lands.</h2>
                <p className="muted">Categories across this workspace.</p>
                {Object.entries(categories).map(([id, name]) => {
                  const count = state.messages.filter(
                    (e) => category(e) === id,
                  ).length;
                  return (
                    <div className="category-bar" key={id}>
                      <span>{name}</span>
                      <progress
                        max={Math.max(state.messages.length, 1)}
                        value={count}
                      />
                      <b>{count}</b>
                    </div>
                  );
                })}
              </section>
              <section className="content-card">
                <span className="eyebrow">A VIEW INTO THE DECISIONS</span>
                <h2>
                  {state.messages.filter((e) => e.approved).length} reviewed by
                  you.
                </h2>
                <p className="muted">
                  Your corrections stay with the message. They do not train or
                  fine-tune Jev.
                </p>
                <div className="insight-number">
                  {demo ? 0 : state.stats.attempts}
                  <span>inference attempts</span>
                </div>
                <p className="muted">
                  {demo
                    ? "The demo uses authored fixtures. No model calls, no provider cost."
                    : `${state.stats.completed} valid results. Mean successful latency: ${state.stats.completed ? Math.round(state.stats.latency_ms / state.stats.completed) : 0} ms.`}
                </p>
                <div className="notice">
                  <ShieldCheck size={19} />
                  <span>
                    Confidence is a review signal, not measured accuracy. Every
                    Gmail change still needs your approval.
                  </span>
                </div>
              </section>
            </div>
          )}
          <footer className="footer">
            <span>
              <span className="status-dot" />
              Thoughtful classification. You’re in control.
            </span>
            <span>
              {demo
                ? "Synthetic inbox · no API calls"
                : "Gmail + Jev · reviewed by you"}
            </span>
          </footer>
        </div>
      </main>
      <dialog
        ref={modalRef}
        aria-label={
          modal === "connect"
            ? "Workspace connection"
            : modal === "classify"
              ? "Confirm classification"
              : "Disconnect Gmail"
        }
        className="modal"
        onCancel={() => setModal(null)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setModal(null);
        }}
      >
        <button
          className="icon-button modal-close"
          onClick={() => setModal(null)}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
        {modal === "connect" && (
          <>
            <div className="modal-emblem">
              <LockKeyhole size={25} />
            </div>
            <span className="eyebrow">A WORKSPACE THAT’S YOURS</span>
            <h2>
              A little less inbox.
              <br />
              Starting with yours.
            </h2>
            {!session.configured ? (
              <>
                <p>
                  Start JevZero with <code>uv run jevzero</code> to enable local
                  saving and Gmail. This frontend-only preview contains sample
                  messages.
                </p>
                <button
                  className="button dark full"
                  onClick={() => setModal(null)}
                >
                  Keep exploring <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <p>
                  Your keys and inbox are saved on this computer. Google is the
                  only sign-in—there’s no separate JevZero account.
                </p>
                {profile && (
                  <div className="connected-profile">
                    {profile.picture && (
                      <img
                        src={profile.picture}
                        alt=""
                        referrerPolicy="no-referrer"
                      />
                    )}
                    <div>
                      <strong>{profile.name}</strong>
                      <small>{profile.email}</small>
                    </div>
                  </div>
                )}
                <form onSubmit={saveKeys} className="connection-form">
                  <label>
                    TypeSafe API key{" "}
                    <span className="saved-status">
                      {connections.typesafe
                        ? "Saved"
                        : "Required for classification"}
                    </span>
                    <input
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={keys.typesafe_key}
                      placeholder={
                        connections.typesafe
                          ? "Enter a new key to replace"
                          : "Your TypeSafe key"
                      }
                      onChange={(e) =>
                        setKeys({ ...keys, typesafe_key: e.target.value })
                      }
                    />
                  </label>
                  {connections.typesafe && (
                    <button
                      type="button"
                      className="text-button"
                      disabled={!!busy}
                      onClick={() => saveKeys(undefined, "remove_typesafe")}
                    >
                      Remove TypeSafe key
                    </button>
                  )}
                  <details open={!connections.google} className="google-setup">
                    <summary>
                      Google OAuth setup{" "}
                      <span className="saved-status">
                        {connections.google ? "Saved" : "Required once"}
                      </span>
                    </summary>
                    <p>
                      Create a Web application OAuth client with Gmail API
                      enabled. Add your Google account as a test user. Register
                      this exact callback:
                    </p>
                    <code className="callback-url">
                      {typeof window !== "undefined"
                        ? window.location.origin
                        : "http://127.0.0.1:3000"}
                      /oauth/callback
                    </code>
                    <a
                      href="https://console.cloud.google.com/auth/clients"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Google Cloud settings ↗
                    </a>
                    <label>
                      Google client ID
                      <input
                        autoComplete="off"
                        spellCheck={false}
                        disabled={state.connected}
                        value={keys.google_client_id}
                        placeholder="…apps.googleusercontent.com"
                        onChange={(e) =>
                          setKeys({ ...keys, google_client_id: e.target.value })
                        }
                      />
                    </label>
                    <label>
                      Google client secret
                      <input
                        type="password"
                        autoComplete="off"
                        disabled={state.connected}
                        value={keys.google_client_secret}
                        placeholder={
                          connections.google
                            ? "Leave blank to keep saved secret"
                            : "Your Google client secret"
                        }
                        onChange={(e) =>
                          setKeys({
                            ...keys,
                            google_client_secret: e.target.value,
                          })
                        }
                      />
                    </label>
                    {connections.google && (
                      <button
                        type="button"
                        className="text-button"
                        disabled={!!busy || state.connected}
                        onClick={() => saveKeys(undefined, "remove_google")}
                      >
                        Remove Google client settings
                      </button>
                    )}
                  </details>
                  <button
                    className="button light full"
                    disabled={!!busy || !Object.values(keys).some(Boolean)}
                  >
                    Save keys on this computer <Check size={16} />
                  </button>
                </form>
                <p className="microcopy">
                  Keys are encrypted locally and never displayed again. Saving
                  does not validate the key or make paid calls. Your TypeSafe
                  account is billed when you classify emails.
                </p>
                <button
                  className="button dark full"
                  disabled={!!busy || !connections.google}
                  onClick={() => {
                    setModal(null);
                    connect();
                  }}
                >
                  <GoogleMark />
                  {state.connected
                    ? "Open my Gmail"
                    : "Connect Gmail with Google"}
                  <ArrowUpRight size={16} />
                </button>
                {state.connected && (
                  <button
                    className="text-button full"
                    disabled={!!busy}
                    onClick={() => setModal("disconnect")}
                  >
                    Disconnect Gmail
                  </button>
                )}
              </>
            )}
          </>
        )}
        {modal === "classify" && (
          <>
            <div className="modal-emblem">
              <Sparkles size={25} />
            </div>
            <span className="eyebrow">ONE SMALL STEP TOWARD CLARITY</span>
            <h2>Let Jev take a look.</h2>
            <p>
              Classify up to 10 unclassified emails. Each email is one paid Jev
              request, with all category, priority, and rule questions evaluated
              together.
            </p>
            <label className="consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>
                I allow sending sender, subject, date, and up to 12,000 body
                characters per email to TypeSafe. Attachments are excluded.
              </span>
            </label>
            <button
              className="button dark full"
              disabled={!consent || !!busy}
              onClick={() => {
                setModal(null);
                run("classify", { consent: true });
              }}
            >
              Classify this batch <ArrowRight size={16} />
            </button>
          </>
        )}
        {modal === "disconnect" && (
          <>
            <h2>Disconnect this mailbox?</h2>
            <p>
              This removes the saved Google token and cached messages from the
              backend. Action receipts remain. Google’s authorization can be
              revoked separately in your Google account.
            </p>
            <button
              className="button dark full"
              disabled={!!busy}
              onClick={() => {
                setModal(null);
                run("disconnect");
              }}
            >
              Disconnect Gmail
            </button>
          </>
        )}
      </dialog>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          <span>{toast}</span>
          <button onClick={() => setToast("")} aria-label="Dismiss message">
            <X size={15} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator" role="status">
          <LoaderCircle size={16} className="spin" />
          {busy}
        </div>
      )}
    </div>
  );
}
function Tag({
  children,
  kind = "",
}: {
  children: React.ReactNode;
  kind?: string;
}) {
  return <span className={`tag tag-${kind}`}>{children}</span>;
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty-state">
      <Inbox size={30} strokeWidth={1} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
function GoogleMark() {
  return (
    <svg viewBox="0 0 24 20" width="17" height="15" aria-hidden="true">
      <path
        d="M2 18V4l10 7L22 4v14"
        fill="none"
        stroke="#7da396"
        strokeWidth="4"
        strokeLinejoin="round"
      />
      <path
        d="M2 4l10 7L22 4"
        fill="none"
        stroke="#f0c29f"
        strokeWidth="4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
