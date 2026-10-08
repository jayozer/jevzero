export type CustomCategory = { id: string; name: string; description: string };
export type Rule = { name: string; condition: string };
export type Classification = {
  category: string;
  priority: string;
  confidence: number;
  probabilities: Record<string, number>;
  importance: number;
  signals: Record<string, number>;
  rules: (Rule & { probability: number })[];
  review_reasons: string[];
  model: string;
  source: string;
  latency_ms: number;
};
export type AttachmentResult = {
  kind: string;
  confidence: number;
  probabilities: Record<string, number>;
  predicates: Record<string, number>;
  sensitivity: number; // 0 public … 3 secret
  model: string;
};
export type Attachment = {
  id: string; // Gmail attachmentId; the only handle to the bytes
  filename: string;
  mime: string;
  size: number;
  status: "pending" | "classified" | "unsupported" | "refused" | "failed";
  reason?: string | null;
  pages_total?: number;
  pages_sent?: number;
  result: AttachmentResult | null;
};
export type Email = {
  id: string;
  thread_id: string;
  sender: string;
  subject: string;
  body: string;
  date: string;
  timestamp: number;
  label_ids: string[];
  truncated: boolean;
  attachments?: Attachment[];
  result: Classification | null;
  approved: boolean;
  approved_category?: string;
  proposed_labels?: string[];
};
export type Receipt = {
  id: string;
  time: number;
  mode: string;
  message_id: string;
  names: string[];
  status: string;
  added: string[];
};
export type MailState = {
  credentials?: { typesafe: boolean; openai?: boolean; google: boolean };
  google_profile?: { name: string; email: string; picture: string } | null;
  mode: "demo" | "gmail";
  messages: Email[];
  settings: {
    threshold: number;
    rules: Rule[];
    custom_categories?: CustomCategory[];
  };
  categories: Record<string, string>;
  priorities: Record<string, string>;
  receipts: Receipt[];
  connected: boolean;
  configured: boolean;
  account: string;
  cursor: { query: string; page: string } | null;
  stats: { attempts: number; completed: number; latency_ms: number };
};
