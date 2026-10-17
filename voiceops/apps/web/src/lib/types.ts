// Shapes of API responses used by the dashboard.

export interface Me {
  user: { id: string; name: string; email: string; role: "owner" | "staff"; phone: string | null };
  business: { id: string; slug: string; name: string; timezone: string };
  isDemoAccount: boolean;
}

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "owner" | "staff";
  phone: string | null;
  createdAt: string;
}

export interface AuthOptions {
  demoLogin: { email: string; password: string } | null;
  signupEnabled: boolean;
}

export interface Appointment {
  id: string;
  bookingRef: string | null;
  status: "held" | "pending" | "confirmed" | "completed" | "cancelled" | "no_show" | "expired";
  source: "voice" | "web" | "phone" | "staff" | "whatsapp";
  serviceId: string;
  serviceName: string;
  resourceId: string;
  resourceName: string;
  startsAt: string;
  endsAt: string;
  when: string;
  pricePaise: number;
  customer: { id: string; name: string | null; phone: string } | null;
  notes: string | null;
  checkedInAt: string | null;
  cancelReason: string | null;
  callId: string | null;
  isDemo: boolean;
}

export interface Resource {
  id: string;
  name: string;
  kind: string;
  active: boolean;
}

export interface Service {
  id: string;
  name: string;
  aliases: string[];
  durationMin: number;
  bufferMin: number;
  pricePaise: number;
  resourceKind: string;
  active: boolean;
}

export interface CallListItem {
  id: string;
  channel: "web" | "phone" | "text";
  status: "active" | "ended";
  callerPhone: string | null;
  engine: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  isDemo: boolean;
  customerName: string | null;
  customerPhone: string | null;
  intent: string | null;
  outcome: Outcome | null;
  reason: string | null;
  highIntent: boolean | null;
  estValuePaise: number | null;
  serviceName: string | null;
  turns: number | null;
}

export type Outcome = "booked" | "rescheduled" | "cancelled" | "answered" | "callback" | "waitlist" | "handoff" | "abandoned";

export interface Turn {
  id: string;
  seq: number;
  speaker: "caller" | "agent" | "tool" | "system";
  text: string;
  toolName: string | null;
  toolArgs: unknown;
  toolResult: { ok: boolean; error?: { code: string; message: string } } & Record<string, unknown> | null;
  latencyMs: number | null;
  createdAt: string;
}

export interface CallDetail {
  call: { id: string; channel: string; status: string; callerPhone: string | null; engine: string; language: string | null; startedAt: string; endedAt: string | null; summary: string | null; isDemo: boolean };
  turns: Turn[];
  outcome: { intent: string; outcome: Outcome; reason: string | null; highIntent: boolean; estValuePaise: number; requestedStart: string | null } | null;
  customer: { name: string | null; phone: string } | null;
}

export interface Callback {
  id: string;
  name: string | null;
  phone: string;
  reason: string;
  serviceName: string | null;
  preferredAt: string | null;
  priority: "high" | "normal" | "low";
  status: "open" | "done" | "cancelled";
  dueAt: string;
  escalatedAt: string | null;
  callId: string | null;
  notes: string | null;
  isDemo: boolean;
  createdAt: string;
}

export interface Handoff {
  id: string;
  callId: string | null;
  phone: string | null;
  reason: string;
  summary: string;
  priority: string;
  status: "open" | "done";
  createdAt: string;
  isDemo: boolean;
}

export interface WaitlistEntry {
  id: string;
  serviceName: string;
  customerName: string | null;
  phone: string;
  date: string;
  windowStart: string;
  windowEnd: string;
  status: string;
  createdAt: string;
}

export interface Message {
  id: string;
  phone: string;
  direction: "outbound" | "inbound";
  kind: string;
  body: string;
  status: "queued" | "sent" | "simulated" | "failed" | "received";
  createdAt: string;
  error: string | null;
}

export interface RadarCard {
  kind: string;
  tone: "urgent" | "warn" | "info" | "good";
  title: string;
  detail: string;
  link?: string;
}

export interface Insights {
  days: number;
  demoShare: number;
  totals: {
    calls: number;
    previousCalls: number;
    booked: number;
    bookingIntent: number;
    conversion: number | null;
    answered: number;
    callbacks: number;
    handoffs: number;
    abandoned: number;
    opportunityPaise: number;
    lostLeads: number;
    openCallbacks: number;
    openHandoffs: number;
    latencyP50: number | null;
    latencyP95: number | null;
  };
  intents: { key: string; count: number }[];
  outcomes: { key: string; count: number }[];
  reasons: { key: string; count: number }[];
  heatmap: number[][];
  hourTotals: number[];
  unmet: { label: string; count: number; topService: string | null }[];
  serviceDemand: { service: string; requests: number; booked: number; previous: number; change: number | null }[];
  gaps: { id: string; question: string; count: number }[];
  radar: RadarCard[];
  formula: string;
}

export interface Overview {
  business: { name: string; timezone: string; today: string };
  openStatus: { open: boolean; closesAt?: string; nextOpenDate?: string; nextOpensAt?: string };
  today: { appointments: Appointment[]; callsToday: number; liveCalls: CallListItem[]; pendingRequests: Appointment[] };
  callbacks: Callback[];
  handoffs: Handoff[];
  recentCalls: CallListItem[];
  radar: RadarCard[];
  week: Insights["totals"];
  demoShare: number;
}

export interface SystemInfo {
  version: string;
  database: string;
  llmAvailable: boolean;
  llmModel: string | null;
  whatsappConfigured: boolean;
  demoData: boolean;
}

export interface ToolTrace {
  name: string;
  args: unknown;
  result: { ok: boolean; error?: { code: string; message: string } } & Record<string, unknown>;
  ok: boolean;
  ms: number;
}

export interface TurnResult {
  callId: string;
  reply: string;
  ended: boolean;
  engine: "rules" | "llm";
  latencyMs: number;
  trace: ToolTrace[];
  state: {
    lang: string;
    flow: string | null;
    awaiting: string | null;
    service: string | null;
    date: string | null;
    time: string | null;
    hold: { id: string; when: string; pricePaise: number; serviceName: string; expiresAt: string } | null;
    name: string | null;
    phone: string | null;
    outcome: { kind: string } | null;
  };
}
