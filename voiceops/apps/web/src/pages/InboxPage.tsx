import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDateTime, fmtLocalDate, fmtLocalTime, fmtPhone, relative } from "../lib/format";
import type { Callback, Handoff, WaitlistEntry } from "../lib/types";
import { Badge, Button, Empty, ErrorNote, Loading, PageHeader, Panel, Tabs } from "../components/ui";

type Tab = "callbacks" | "handoffs" | "waitlist";

export function InboxPage() {
  const [tab, setTab] = useState<Tab>("callbacks");
  const [showDone, setShowDone] = useState(false);
  const cbs = useQuery({ queryKey: ["callbacks", showDone], queryFn: () => api.get<{ callbacks: Callback[] }>(`/api/v1/callbacks?status=${showDone ? "all" : "open"}`) });
  const hos = useQuery({ queryKey: ["handoffs", showDone], queryFn: () => api.get<{ handoffs: Handoff[] }>(`/api/v1/handoffs?status=${showDone ? "all" : "open"}`) });
  const wl = useQuery({ queryKey: ["waitlist"], queryFn: () => api.get<{ waitlist: WaitlistEntry[] }>("/api/v1/waitlist") });
  const openCb = cbs.data?.callbacks.filter((c) => c.status === "open").length ?? 0;
  const openHo = hos.data?.handoffs.filter((h) => h.status === "open").length ?? 0;

  return (
    <div>
      <PageHeader title="Follow-ups" sub="People the receptionist couldn't fully help. Call them back, then mark them done." />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          items={[
            { value: "callbacks", label: `Call backs${openCb ? ` (${openCb})` : ""}` },
            { value: "handoffs", label: `Passed to staff${openHo ? ` (${openHo})` : ""}` },
            { value: "waitlist", label: `Waitlist${wl.data?.waitlist.length ? ` (${wl.data.waitlist.length})` : ""}` },
          ]}
        />
        {tab !== "waitlist" && (
          <label className="flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show finished
          </label>
        )}
      </div>
      {tab === "callbacks" && <Callbacks q={cbs} />}
      {tab === "handoffs" && <Handoffs q={hos} />}
      {tab === "waitlist" && <Waitlist q={wl} />}
    </div>
  );
}

function Callbacks({ q }: { q: ReturnType<typeof useQuery<{ callbacks: Callback[] }>> }) {
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "done" | "cancelled" | "open" }) => api.patch(`/api/v1/callbacks/${id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["callbacks"] });
      qc.invalidateQueries({ queryKey: ["counts"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const list = q.data!.callbacks;
  return (
    <Panel>
      {list.length === 0 ? (
        <Empty title="No one is waiting for a call">When the receptionist promises a call back, it shows up here with the reason.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((c) => {
            const overdue = c.status === "open" && new Date(c.dueAt).getTime() < Date.now();
            return (
              <li key={c.id} className={`flex flex-wrap items-start gap-4 px-4 py-3.5 ${c.status !== "open" ? "opacity-60" : ""}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{c.name ?? "Customer"}</span>
                    <a href={`tel:${c.phone}`} className="text-sm text-info underline-offset-2 hover:underline">{fmtPhone(c.phone)}</a>
                    {c.priority === "high" && <Badge tone="attention">Wants to book</Badge>}
                    {c.serviceName && <Badge>{c.serviceName}</Badge>}
                    {c.escalatedAt && <Badge tone="bad">Owner alerted</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-soft">{c.reason}</p>
                  <p className={`mt-0.5 text-xs ${overdue ? "font-medium text-bad" : "text-muted"}`}>
                    {c.status === "open" ? (overdue ? `Overdue, was due ${relative(c.dueAt)}` : `Call ${fmtDateTime(c.dueAt)}`) : c.status === "done" ? "Called" : "Cancelled"}
                    {c.callId && <Link to={`/calls/${c.callId}`} className="ml-2 underline-offset-2 hover:underline">Read the call</Link>}
                  </p>
                </div>
                <div className="flex gap-2">
                  {c.status === "open" ? (
                    <>
                      <Button size="sm" variant="primary" onClick={() => update.mutate({ id: c.id, status: "done" })}>Called</Button>
                      <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, status: "cancelled" })}>Not needed</Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: c.id, status: "open" })}>Reopen</Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function Handoffs({ q }: { q: ReturnType<typeof useQuery<{ handoffs: Handoff[] }>> }) {
  const qc = useQueryClient();
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/handoffs/${id}/resolve`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["handoffs"] });
      qc.invalidateQueries({ queryKey: ["counts"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const list = q.data!.handoffs;
  return (
    <Panel>
      {list.length === 0 ? (
        <Empty title="Nothing passed to staff">Complaints and callers who ask for a person land here with a summary, so nobody starts from zero.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((h) => (
            <li key={h.id} className={`flex flex-wrap items-start gap-4 px-4 py-3.5 ${h.status !== "open" ? "opacity-60" : ""}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={h.reason === "complaint" ? "bad" : "attention"}>{h.reason === "complaint" ? "Complaint" : h.reason === "human_request" ? "Asked for a person" : "AI was unsure"}</Badge>
                  {h.phone && <a href={`tel:${h.phone}`} className="text-sm text-info underline-offset-2 hover:underline">{fmtPhone(h.phone)}</a>}
                  <span className="text-xs text-muted">{relative(h.createdAt)}</span>
                </div>
                <p className="mt-1 text-sm">{h.summary}</p>
                {h.callId && <Link to={`/calls/${h.callId}`} className="text-xs text-muted underline-offset-2 hover:underline">Read the call</Link>}
              </div>
              {h.status === "open" && <Button size="sm" variant="primary" onClick={() => resolve.mutate(h.id)}>Resolved</Button>}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function Waitlist({ q }: { q: ReturnType<typeof useQuery<{ waitlist: WaitlistEntry[] }>> }) {
  const qc = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/waitlist/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["waitlist"] }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const list = q.data!.waitlist;
  return (
    <Panel>
      <p className="border-b border-line px-4 py-3 text-sm text-muted">
        When a booking is cancelled, the freed slot is offered on WhatsApp to up to three people below whose time window fits. The first to reply YES gets it.
      </p>
      {list.length === 0 ? (
        <Empty title="Nobody is waiting" />
      ) : (
        <ul className="divide-y divide-line">
          {list.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium">{w.customerName ?? "Customer"} <span className="font-normal text-muted">{fmtPhone(w.phone)}</span></div>
                <div className="text-ink-soft">{w.serviceName}, {fmtLocalDate(w.date)}, {fmtLocalTime(w.windowStart)}–{fmtLocalTime(w.windowEnd)}</div>
              </div>
              {w.status === "offered" ? <Badge tone="attention">Offer sent</Badge> : <Badge>Waiting</Badge>}
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(w.id)}>Remove</Button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
