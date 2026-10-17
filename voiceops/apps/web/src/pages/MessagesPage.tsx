import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtDateTime, fmtPhone } from "../lib/format";
import type { Message } from "../lib/types";
import { Badge, Button, Empty, ErrorNote, Input, Loading, PageHeader, Panel } from "../components/ui";

const KIND: Record<string, string> = {
  booking_confirmation: "Booking confirmation",
  reminder_24h: "Reminder, day before",
  reminder_2h: "Reminder, 2 hours before",
  rescheduled: "Moved",
  cancellation: "Cancelled",
  waitlist_joined: "Joined waitlist",
  waitlist_offer: "Slot offer",
  waitlist_lost: "Slot taken",
  callback_ack: "Call back promised",
  owner_handoff: "Alert to owner",
  owner_escalation: "Overdue alert to owner",
  owner_digest: "Daily summary to owner",
  inbound_ack: "Auto-reply",
  inbound: "Customer reply",
};

export function MessagesPage() {
  const q = useQuery({ queryKey: ["messages"], queryFn: () => api.get<{ messages: Message[]; whatsappConfigured: boolean }>("/api/v1/messages") });
  const [selected, setSelected] = useState<string | null>(null);

  const threads = useMemo(() => {
    const map = new Map<string, Message[]>();
    for (const m of q.data?.messages ?? []) map.set(m.phone, [...(map.get(m.phone) ?? []), m]);
    return [...map.entries()].map(([phone, msgs]) => ({ phone, msgs: [...msgs].reverse(), last: msgs[0]! }));
  }, [q.data]);
  const current = threads.find((t) => t.phone === selected) ?? threads[0];

  return (
    <div>
      <PageHeader
        title="Messages"
        sub={
          q.data?.whatsappConfigured
            ? "WhatsApp messages sent to customers and to you."
            : "WhatsApp isn't connected yet, so messages are shown here instead of being sent. Add your WhatsApp keys in .env to send them for real."
        }
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data && threads.length === 0 && <Panel><Empty title="No messages yet">Booking confirmations, reminders and waitlist offers will appear here.</Empty></Panel>}
      {current && (
        <div className="grid gap-5 md:grid-cols-[260px_1fr]">
          <Panel bodyClass="max-h-[640px] overflow-y-auto">
            <ul className="divide-y divide-line">
              {threads.map((t) => (
                <li key={t.phone}>
                  <button onClick={() => setSelected(t.phone)} className={`w-full px-4 py-2.5 text-left ${t.phone === current.phone ? "bg-sunken" : "hover:bg-sunken/60"}`}>
                    <div className="text-sm font-medium">{fmtPhone(t.phone)}</div>
                    <div className="truncate text-xs text-muted">{KIND[t.last.kind] ?? t.last.kind}</div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Thread phone={current.phone} msgs={current.msgs} />
        </div>
      )}
    </div>
  );
}

function Thread({ phone, msgs }: { phone: string; msgs: Message[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const reply = useMutation({
    mutationFn: (body: string) => api.post<{ action: string }>("/api/v1/messages/simulate-reply", { phone, body }),
    onSuccess: () => {
      setText("");
      for (const k of ["messages", "appointments", "waitlist", "overview"]) qc.invalidateQueries({ queryKey: [k] });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) reply.mutate(text.trim());
  }
  return (
    <Panel title={fmtPhone(phone)} bodyClass="flex flex-col">
      <div className="max-h-[520px] space-y-3 overflow-y-auto bg-sunken/60 px-4 py-4">
        {msgs.map((m) => (
          <div key={m.id} className={m.direction === "inbound" ? "flex justify-end" : ""}>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm ${m.direction === "inbound" ? "rounded-br-sm bg-ok-soft" : "rounded-bl-sm border border-line bg-panel"}`}>
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>{KIND[m.kind] ?? m.kind}</span>
                {m.status === "simulated" && <Badge>Not sent</Badge>}
                {m.status === "queued" && <Badge tone="info">Sending</Badge>}
                {m.status === "failed" && <Badge tone="bad">Failed</Badge>}
              </div>
              <p className="whitespace-pre-line">{m.body}</p>
              <div className="mt-1 text-[11px] text-muted">{fmtDateTime(m.createdAt)}</div>
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="space-y-2 border-t border-line px-4 py-3">
        <div className="text-[13px] text-ink-soft">Reply as this customer, to test the flows (YES takes a waitlist slot, CANCEL cancels their next booking)</div>
        <div className="flex gap-2">
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="YES" aria-label="Customer reply" />
          <Button disabled={!text.trim()} busy={reply.isPending}>Send reply</Button>
        </div>
        {reply.data && <p className="text-xs text-muted">Result: {reply.data.action.replace(/_/g, " ")}</p>}
        <ErrorNote error={reply.error} />
      </form>
    </Panel>
  );
}
