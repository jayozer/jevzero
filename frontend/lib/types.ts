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
  credentials?: { typesafe: boolean; google: boolean };
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
