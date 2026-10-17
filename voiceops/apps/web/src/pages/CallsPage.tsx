import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { fmtDateTime, fmtPhone, formatPaise, INTENT_LABEL, REASON_LABEL, TOOL_LABEL } from "../lib/format";
import type { CallDetail, CallListItem, Turn } from "../lib/types";
import { Badge, Empty, ErrorNote, Loading, OutcomeBadge, PageHeader, Panel } from "../components/ui";

function duration(a: string, b: string | null) {
  if (!b) return "";
  const s = Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

export function CallsPage() {
  const q = useQuery({ queryKey: ["calls"], queryFn: () => api.get<{ calls: CallListItem[] }>("/api/v1/calls?limit=100") });
  return (
    <div>
      <PageHeader title="Calls" sub="Every conversation the receptionist had, with what it did and how it ended." />
      <Panel>
        {q.isLoading && <Loading />}
        <ErrorNote error={q.error} />
        {q.data && q.data.calls.length === 0 && <Empty title="No calls yet">Make one on the Talk to receptionist page.</Empty>}
        {q.data && q.data.calls.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-line text-left text-[13px] text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">When</th>
                  <th className="px-4 py-2.5 font-medium">Caller</th>
                  <th className="px-4 py-2.5 font-medium">Wanted</th>
                  <th className="px-4 py-2.5 font-medium">Result</th>
                  <th className="hidden px-4 py-2.5 font-medium md:table-cell">Summary</th>
                  <th className="px-4 py-2.5 text-right font-medium">Length</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {q.data.calls.map((c) => (
                  <tr key={c.id} className="hover:bg-sunken">
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <Link to={`/calls/${c.id}`} className="hover:underline">{fmtDateTime(c.startedAt)}</Link>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <div className="font-medium">{c.customerName ?? fmtPhone(c.callerPhone ?? c.customerPhone)}</div>
                      <div className="text-xs text-muted">{c.channel === "phone" ? "Phone" : "Web"}{c.isDemo ? ", demo" : ""}</div>
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap">{c.intent ? INTENT_LABEL[c.intent] ?? c.intent : "—"}</td>
                    <td className="px-4 py-2.5"><OutcomeBadge outcome={c.status === "active" ? null : c.outcome} /></td>
                    <td className="hidden max-w-[360px] truncate px-4 py-2.5 text-ink-soft md:table-cell">{c.summary}</td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap text-muted">{duration(c.startedAt, c.endedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

export function CallDetailPage() {
  const { id } = useParams();
  const q = useQuery({ queryKey: ["call", id], queryFn: () => api.get<CallDetail>(`/api/v1/calls/${id}`) });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const { call, turns, outcome, customer } = q.data!;
  const agentLatencies = turns.filter((t) => t.speaker === "agent" && t.latencyMs != null).map((t) => t.latencyMs!);
  const avg = agentLatencies.length ? Math.round(agentLatencies.reduce((a, b) => a + b, 0) / agentLatencies.length) : null;

  return (
    <div>
      <Link to="/calls" className="text-sm text-muted hover:text-ink">All calls</Link>
      <PageHeader
        title={customer?.name ?? fmtPhone(call.callerPhone)}
        sub={`${fmtDateTime(call.startedAt)}, ${call.channel === "phone" ? "phone call" : "web call"}${call.endedAt ? `, ${duration(call.startedAt, call.endedAt)}` : ", still on the line"}`}
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <Panel title="Transcript" bodyClass="space-y-3 px-4 py-4">
          {turns.map((t) => <TurnRow key={t.id} t={t} />)}
        </Panel>
        <aside className="space-y-5">
          <Panel title="How it ended">
            <dl className="divide-y divide-line text-sm">
              <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Result</dt><dd><OutcomeBadge outcome={outcome?.outcome} /></dd></div>
              <div className="flex justify-between px-4 py-2.5"><dt className="text-muted">Wanted</dt><dd>{outcome ? INTENT_LABEL[outcome.intent] ?? outcome.intent : "—"}</dd></div>
              {outcome?.reason && <div className="flex justify-between gap-3 px-4 py-2.5"><dt className="text-muted">Why</dt><dd className="text-right">{REASON_LABEL[outcome.reason] ?? outcome.reason}</dd></div>}
              {outcome?.highIntent && (
                <div className="px-4 py-2.5">
                  <Badge tone="attention">Lost lead</Badge>
                  <p className="mt-1 text-xs text-muted">Wanted to book but didn't. Worth about {formatPaise(outcome.estValuePaise)}.</p>
                </div>
              )}
              {call.summary && <div className="px-4 py-2.5 text-ink-soft">{call.summary}</div>}
            </dl>
          </Panel>
          <Panel title="Caller">
            <div className="px-4 py-3 text-sm">
              <div className="font-medium">{customer?.name ?? "Unknown name"}</div>
              <div className="text-muted">{fmtPhone(customer?.phone ?? call.callerPhone)}</div>
              {(customer?.phone ?? call.callerPhone) && (
                <a href={`tel:${customer?.phone ?? call.callerPhone}`} className="mt-2 inline-block text-info underline-offset-2 hover:underline">Call them</a>
              )}
            </div>
          </Panel>
          <Panel title="Speed">
            <div className="px-4 py-3 text-sm text-ink-soft">
              {avg != null ? <>Replied in {avg} ms on average (time to write the reply, not including speech).</> : "No timing recorded."}
              <div className="mt-1 text-xs text-muted">Engine: {call.engine === "llm" ? "AI model" : "built-in"}</div>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function TurnRow({ t }: { t: Turn }) {
  if (t.speaker === "tool") {
    const ok = t.toolResult?.ok;
    return (
      <div className="flex items-center gap-2 pl-2 text-xs text-muted">
        <span className={`size-1.5 rounded-full ${ok ? "bg-ok" : "bg-bad"}`} aria-hidden />
        <span className="font-medium text-ink-soft">{TOOL_LABEL[t.toolName ?? ""] ?? t.toolName}</span>
        {!ok && t.toolResult?.error && <span className="text-bad">{t.toolResult.error.message}</span>}
        <details className="ml-1">
          <summary className="cursor-pointer select-none">details</summary>
          <pre className="mt-1 max-w-[560px] overflow-x-auto rounded bg-sunken p-2 text-[11px] leading-snug">{JSON.stringify({ args: t.toolArgs, result: t.toolResult }, null, 2)}</pre>
        </details>
      </div>
    );
  }
  const caller = t.speaker === "caller";
  return (
    <div className={caller ? "flex justify-end" : ""}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${caller ? "rounded-br-sm bg-navy text-panel" : "rounded-bl-sm border border-line bg-sunken"}`}>
        {t.text}
        {!caller && t.latencyMs != null && <span className="ml-2 text-[11px] text-muted">{t.latencyMs} ms</span>}
      </div>
    </div>
  );
}
