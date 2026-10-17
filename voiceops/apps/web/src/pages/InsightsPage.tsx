import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { formatPaise, INTENT_LABEL, OUTCOME_LABEL, pct, REASON_LABEL } from "../lib/format";
import type { Insights } from "../lib/types";
import { DemoNote, Empty, ErrorNote, Loading, PageHeader, Panel, Tabs } from "../components/ui";
import { Radar } from "./OverviewPage";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function InsightsPage() {
  const [days, setDays] = useState<"7" | "14" | "30">("14");
  const q = useQuery({ queryKey: ["insights", days], queryFn: () => api.get<Insights>(`/api/v1/insights?days=${days}`) });

  return (
    <div>
      <PageHeader
        title="Insights"
        sub="What callers want, where you're losing them, and what to change."
        actions={<Tabs value={days} onChange={setDays} items={[{ value: "7", label: "7 days" }, { value: "14", label: "14 days" }, { value: "30", label: "30 days" }]} />}
      />
      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data && q.data.totals.calls === 0 && <Panel><Empty title="No calls in this period">Insights appear once the receptionist has handled some calls.</Empty></Panel>}
      {q.data && q.data.totals.calls > 0 && <Body d={q.data} />}
    </div>
  );
}

function Body({ d }: { d: Insights }) {
  const t = d.totals;
  return (
    <>
      <DemoNote share={d.demoShare} />
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line lg:grid-cols-4">
        <Num label="Calls answered" value={String(t.calls)} note={t.previousCalls ? `${t.previousCalls} in the period before` : undefined} />
        <Num label="Booked by the AI" value={String(t.booked)} note={`${pct(t.conversion)} of people wanting a slot`} />
        <Num label="Interested but didn't book" value={String(t.lostLeads)} note={`${t.openCallbacks} call backs still open`} />
        <Num label="Estimated opportunity" value={formatPaise(t.opportunityPaise)} note="See how it's worked out below" />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Radar cards={d.radar} />
        <Panel title="Why people call">
          <Bars items={d.intents.map((i) => ({ label: INTENT_LABEL[i.key] ?? i.key, value: i.count }))} />
        </Panel>
        <Panel title="How calls ended">
          <Bars items={d.outcomes.map((i) => ({ label: OUTCOME_LABEL[i.key] ?? i.key, value: i.count }))} tone="ok" />
        </Panel>
        <Panel title="Why interested callers didn't book">
          {d.reasons.length ? <Bars items={d.reasons.map((i) => ({ label: REASON_LABEL[i.key] ?? i.key, value: i.count }))} tone="attention" /> : <Empty title="No lost leads in this period" />}
        </Panel>
      </div>

      <Panel className="mt-5" title="When calls come in">
        <Heatmap heat={d.heatmap} />
      </Panel>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Panel title="Times people wanted but couldn't get">
          {d.unmet.length === 0 ? (
            <Empty title="No full slots turned anyone away" />
          ) : (
            <ul className="divide-y divide-line">
              {d.unmet.slice(0, 6).map((u) => (
                <li key={u.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>
                    <span className="font-medium">{u.label}</span>
                    {u.topService && <span className="text-muted">, mostly {u.topService}</span>}
                  </span>
                  <span className="font-display text-lg font-semibold">{u.count}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Demand by service">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[13px] text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Service</th>
                  <th className="px-4 py-2 text-right font-medium">Asked about</th>
                  <th className="px-4 py-2 text-right font-medium">Booked</th>
                  <th className="px-4 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {d.serviceDemand.map((s) => (
                  <tr key={s.service}>
                    <td className="px-4 py-2">{s.service}</td>
                    <td className="px-4 py-2 text-right">{s.requests}</td>
                    <td className="px-4 py-2 text-right">{s.booked}</td>
                    <td className={`px-4 py-2 text-right ${s.change && s.change > 0 ? "text-ok" : s.change && s.change < 0 ? "text-bad" : "text-muted"}`}>
                      {s.change == null ? "–" : `${s.change > 0 ? "+" : ""}${Math.round(s.change * 100)}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Panel title="Questions it couldn't answer">
          {d.gaps.length === 0 ? <Empty title="None" /> : (
            <ul className="divide-y divide-line">
              {d.gaps.map((g) => (
                <li key={g.id} className="flex justify-between gap-3 px-4 py-2.5 text-sm">
                  <span>"{g.question}"</span>
                  <span className="shrink-0 text-muted">{g.count}×</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="How the estimate is worked out">
          <div className="space-y-2 px-4 py-3 text-sm text-ink-soft">
            <p>{d.formula}</p>
            <p>
              A call counts as high intent when the caller tried to book. It's an upper bound: it assumes each of those callers could have been won back, so treat it as a priority signal, not money in the bank.
            </p>
            {t.latencyP50 != null && (
              <p className="text-xs text-muted">
                Receptionist reply time on live calls: {Math.round(t.latencyP50)} ms typical, {Math.round(t.latencyP95 ?? 0)} ms slowest 5%.
              </p>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}

function Num({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-panel px-4 py-3.5">
      <div className="text-sm text-muted">{label}</div>
      <div className="font-display text-[26px] font-semibold">{value}</div>
      {note && <div className="text-xs text-muted">{note}</div>}
    </div>
  );
}

function Bars({ items, tone = "navy" }: { items: { label: string; value: number }[]; tone?: "navy" | "ok" | "attention" }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0);
  const color = tone === "ok" ? "bg-ok" : tone === "attention" ? "bg-marigold" : "bg-navy";
  return (
    <ul className="space-y-2 px-4 py-3">
      {items.slice(0, 8).map((i) => (
        <li key={i.label} className="grid grid-cols-[140px_1fr_64px] items-center gap-3 text-sm">
          <span className="truncate">{i.label}</span>
          <span className="h-2.5 rounded-full bg-sunken">
            <span className={`block h-full rounded-full ${color}`} style={{ width: `${(i.value / max) * 100}%` }} />
          </span>
          <span className="text-right text-muted">
            {i.value} <span className="text-xs">({Math.round((i.value / total) * 100)}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Heatmap({ heat }: { heat: number[][] }) {
  const hours = Array.from({ length: 15 }, (_, i) => i + 7); // 7 AM – 9 PM
  const max = Math.max(1, ...heat.flat());
  const order = [1, 2, 3, 4, 5, 6, 0];
  return (
    <div className="overflow-x-auto px-4 py-4">
      <table className="border-separate border-spacing-1 text-xs" aria-label="Calls by day and hour">
        <thead>
          <tr>
            <th />
            {hours.map((h) => (
              <th key={h} className="w-9 font-normal text-muted">{h % 12 === 0 ? 12 : h % 12}{h < 12 ? "a" : "p"}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {order.map((wd) => (
            <tr key={wd}>
              <th className="pr-2 text-right font-normal text-muted">{DAYS[wd]}</th>
              {hours.map((h) => {
                const n = heat[wd]?.[h] ?? 0;
                return (
                  <td key={h} title={`${DAYS[wd]} ${h}:00 — ${n} calls`} className="h-7 w-9 rounded" style={{ background: n ? `color-mix(in srgb, var(--color-navy) ${Math.round(12 + (n / max) * 80)}%, transparent)` : "var(--color-sunken)" }}>
                    <span className="sr-only">{n}</span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
