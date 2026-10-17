import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { fmtLocalDate, fmtLocalTime, fmtPhone, fmtTime, formatPaise, pct, relative } from "../lib/format";
import type { Appointment, Me, Overview, RadarCard } from "../lib/types";
import { Badge, Button, DemoNote, Empty, ErrorNote, Loading, OutcomeBadge, Panel, VoiceBars } from "../components/ui";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

export function OverviewPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ["overview"], queryFn: () => api.get<Overview>("/api/v1/overview"), refetchInterval: 60000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  const status = d.openStatus.open
    ? `Open until ${fmtLocalTime(d.openStatus.closesAt!)}. The receptionist is answering overflow calls.`
    : `Closed now${d.openStatus.nextOpensAt ? `, opens ${fmtLocalDate(d.openStatus.nextOpenDate!)} at ${fmtLocalTime(d.openStatus.nextOpensAt)}` : ""}. The receptionist is taking every call.`;
  const needsYou = d.handoffs.length + d.callbacks.length;
  const booked = d.today.appointments.filter((a) => a.status !== "cancelled").length;

  return (
    <div>
      <section className="night-texture mb-7 overflow-hidden rounded-3xl px-6 py-7 text-night-ink sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <div className="max-w-xl">
            <p className="text-sm text-night-muted">{fmtLocalDate(d.business.today)}</p>
            <h1 className="mt-1 text-[32px] leading-[1.1] font-bold text-white sm:text-[38px]">
              {greeting()}, {me.user.name.split(" ")[0]}
            </h1>
            <p className="mt-3 flex items-start gap-2.5 text-[15px] text-night-muted">
              <span className={`mt-1.5 size-2 shrink-0 rounded-full ${d.openStatus.open ? "bg-ok" : "bg-marigold"}`} aria-hidden />
              {status}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-night-line text-center">
            {[
              ["Calls today", String(d.today.callsToday)],
              ["Booked today", String(booked)],
              ["Need you", String(needsYou + d.today.pendingRequests.length)],
            ].map(([label, value]) => (
              <div key={label} className="bg-night-raised px-4 py-3 sm:px-6">
                <dd className={`font-display text-[28px] leading-none font-bold ${label === "Need you" && value !== "0" ? "text-marigold" : "text-white"}`}>{value}</dd>
                <dt className="mt-1.5 text-xs whitespace-nowrap text-night-muted">{label}</dt>
              </div>
            ))}
          </dl>
        </div>
        {d.today.liveCalls.length > 0 && (
          <Link to={`/calls/${d.today.liveCalls[0]!.id}`} className="mt-5 inline-flex items-center gap-2.5 rounded-full bg-night-raised px-3.5 py-1.5 text-sm text-night-ink hover:text-white">
            <VoiceBars className="h-3.5" />
            {d.today.liveCalls.length === 1 ? "On a call right now" : `${d.today.liveCalls.length} calls in progress`}
          </Link>
        )}
      </section>
      <DemoNote share={d.demoShare} />

      {d.today.pendingRequests.length > 0 && <PendingRequests list={d.today.pendingRequests} />}

      {needsYou > 0 ? <NeedsYou d={d} /> : (
        <p className="mb-6 flex items-center gap-2.5 rounded-2xl border border-line bg-panel px-5 py-3.5 text-sm shadow-[var(--shadow-panel)]">
          <span className="size-2 rounded-full bg-ok" aria-hidden /> Nothing needs you right now. Every call has been handled.
        </p>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[1.35fr_1fr]">
        <Panel
          title={`Today, ${fmtLocalDate(d.business.today)}`}
          action={<Link to="/appointments" className="text-sm text-info underline-offset-2 hover:underline">Open calendar</Link>}
        >
          <TodayList appointments={d.today.appointments} />
        </Panel>

        <div className="space-y-5">
          <WeekNumbers d={d} />
          <Radar cards={d.radar} />
        </div>
      </div>

      <Panel className="mt-5" title="Latest calls" action={<Link to="/calls" className="text-sm text-info underline-offset-2 hover:underline">All calls</Link>}>
        {d.recentCalls.length === 0 ? (
          <Empty title="No calls yet">Try one on the <Link to="/talk" className="underline">Talk to receptionist</Link> page.</Empty>
        ) : (
          <ul className="divide-y divide-line">
            {d.recentCalls.map((c) => (
              <li key={c.id}>
                <Link to={`/calls/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 hover:bg-sunken">
                  <span className="w-28 shrink-0 text-sm text-muted">{relative(c.startedAt)}</span>
                  <span className="w-36 shrink-0 text-sm font-medium">{c.customerName ?? fmtPhone(c.callerPhone)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">{c.summary ?? (c.status === "active" ? "On the call now" : "")}</span>
                  <OutcomeBadge outcome={c.status === "active" ? null : c.outcome} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Website booking requests: the slot is held, a person confirms or declines. */
function PendingRequests({ list }: { list: Appointment[] }) {
  const qc = useQueryClient();
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["overview"] });
    qc.invalidateQueries({ queryKey: ["appointments"] });
  };
  const approve = useMutation({ mutationFn: (id: string) => api.post(`/api/v1/appointments/${id}/approve`, {}), onSuccess: refresh });
  const decline = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/appointments/${id}/cancel`, { reason: "Request declined by staff" }),
    onSuccess: refresh,
  });
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-marigold/50 bg-panel shadow-[var(--shadow-panel)]" aria-labelledby="pending-requests">
      <header className="flex flex-wrap items-center justify-between gap-2 bg-marigold-soft px-5 py-3">
        <h2 id="pending-requests" className="font-display text-base font-semibold text-marigold-ink">
          Booking requests to confirm: {list.length}
        </h2>
        <span className="text-sm text-marigold-ink/80">From the website, so the number isn't verified yet</span>
      </header>
      <ul className="divide-y divide-line">
        {list.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-[14rem] flex-1 text-sm">
              <div className="font-medium">
                {a.serviceName}, {a.when}
              </div>
              <div className="text-ink-soft">
                {a.customer?.name ?? "Customer"}, {fmtPhone(a.customer?.phone)} · {formatPaise(a.pricePaise)}
              </div>
            </div>
            <div className="flex gap-2">
              {a.customer?.phone && <a href={`tel:${a.customer.phone}`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-2.5 text-[13px] hover:bg-sunken">Call</a>}
              <Button size="sm" variant="ghost" onClick={() => decline.mutate(a.id)} busy={decline.isPending && decline.variables === a.id}>Decline</Button>
              <Button size="sm" variant="primary" onClick={() => approve.mutate(a.id)} busy={approve.isPending && approve.variables === a.id}>Confirm</Button>
            </div>
          </li>
        ))}
      </ul>
      <ErrorNote error={approve.error ?? decline.error} />
    </section>
  );
}

function NeedsYou({ d }: { d: Overview }) {
  const qc = useQueryClient();
  const done = useMutation({
    mutationFn: (id: string) => api.patch(`/api/v1/callbacks/${id}`, { status: "done" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overview"] }),
  });
  const resolve = useMutation({
    mutationFn: (id: string) => api.post(`/api/v1/handoffs/${id}/resolve`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overview"] }),
  });
  return (
    <section className="mb-6 overflow-hidden rounded-2xl border border-marigold/50 bg-panel shadow-[var(--shadow-panel)]" aria-labelledby="needs-you">
      <header className="flex items-center justify-between bg-marigold-soft px-5 py-3">
        <h2 id="needs-you" className="font-display text-base font-semibold text-marigold-ink">
          Needs you: {d.handoffs.length + d.callbacks.length}
        </h2>
        <Link to="/inbox" className="text-sm text-marigold-ink underline-offset-2 hover:underline">
          All follow-ups
        </Link>
      </header>
      <ul className="divide-y divide-line">
        {d.handoffs.map((h) => (
          <li key={h.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
            <Badge tone="bad">{h.reason === "complaint" ? "Complaint" : "Wants a person"}</Badge>
            <div className="min-w-[13rem] flex-1 text-sm">
              <div className="font-medium">{fmtPhone(h.phone)}</div>
              <p className="text-ink-soft">{h.summary}</p>
            </div>
            <div className="ml-auto flex gap-2">
              {h.phone && <a href={`tel:${h.phone}`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-2.5 text-[13px] hover:bg-sunken">Call</a>}
              <Button size="sm" onClick={() => resolve.mutate(h.id)} busy={resolve.isPending && resolve.variables === h.id}>Resolved</Button>
            </div>
          </li>
        ))}
        {d.callbacks.map((c) => {
          const overdue = new Date(c.dueAt).getTime() < Date.now();
          return (
            <li key={c.id} className="flex flex-wrap items-start gap-3 px-5 py-3.5">
              <Badge tone={c.priority === "high" ? "attention" : "neutral"}>{c.priority === "high" ? "Wants to book" : "Call back"}</Badge>
              <div className="min-w-[13rem] flex-1 text-sm">
                <div className="font-medium">
                  {c.name ?? "Customer"} <span className="font-normal text-muted">{fmtPhone(c.phone)}</span>
                </div>
                <p className="text-ink-soft">{c.reason}</p>
                <p className={`text-xs ${overdue ? "text-bad" : "text-muted"}`}>{overdue ? `Due ${relative(c.dueAt)}` : `Due ${fmtTime(c.dueAt)}`}</p>
              </div>
              <div className="ml-auto flex gap-2">
                <a href={`tel:${c.phone}`} className="inline-flex h-8 items-center rounded-lg border border-line-strong px-2.5 text-[13px] hover:bg-sunken">Call</a>
                <Button size="sm" onClick={() => done.mutate(c.id)} busy={done.isPending && done.variables === c.id}>Called</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function TodayList({ appointments }: { appointments: Appointment[] }) {
  const qc = useQueryClient();
  const mark = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "completed" | "no_show" }) => api.post(`/api/v1/appointments/${id}/attendance`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overview"] }),
  });
  if (!appointments.length) return <Empty title="No bookings today">New bookings from calls and staff show up here.</Empty>;
  const now = Date.now();
  return (
    <ol className="divide-y divide-line">
      {appointments.map((a) => {
        const past = new Date(a.startsAt).getTime() < now;
        return (
          <li key={a.id} className={`flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 ${a.status === "no_show" ? "opacity-60" : ""}`}>
            <div className="w-[4.75rem] shrink-0 font-display text-[17px] font-semibold whitespace-nowrap">{fmtTime(a.startsAt)}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">
                {a.serviceName} <span className="font-normal text-muted">in {a.resourceName}</span>
              </div>
              <div className="text-sm text-ink-soft">
                {a.customer?.name ?? "Customer"}, {fmtPhone(a.customer?.phone)}
                {a.source !== "staff" && <span className="text-muted">, booked by the AI</span>}
              </div>
            </div>
            {a.status === "pending" && <Badge tone="attention">To confirm</Badge>}
            {a.status === "completed" && <Badge tone="ok">Arrived</Badge>}
            {a.status === "no_show" && <Badge tone="bad">No-show</Badge>}
            {a.status === "confirmed" && past && (
              <div className="flex gap-1.5">
                <Button size="sm" onClick={() => mark.mutate({ id: a.id, status: "completed" })}>Arrived</Button>
                <Button size="sm" variant="ghost" onClick={() => mark.mutate({ id: a.id, status: "no_show" })}>No-show</Button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function WeekNumbers({ d }: { d: Overview }) {
  const w = d.week;
  const items = [
    { label: "Calls answered", value: String(w.calls), note: w.previousCalls ? `${w.previousCalls} the week before` : undefined },
    { label: "Booked by the AI", value: String(w.booked), note: `${pct(w.conversion)} of people who wanted a slot` },
    { label: "Could still be won back", value: formatPaise(w.opportunityPaise), note: `${w.lostLeads} interested callers didn't book. An estimate, not revenue.` },
  ];
  return (
    <Panel title="Last 7 days" action={<Link to="/insights" className="text-sm text-info underline-offset-2 hover:underline">Insights</Link>}>
      <dl className="divide-y divide-line">
        {items.map((i) => (
          <div key={i.label} className="px-5 py-3.5">
            <dt className="text-sm text-muted">{i.label}</dt>
            <dd className="font-display text-2xl font-semibold">{i.value}</dd>
            {i.note && <dd className="text-xs text-muted">{i.note}</dd>}
          </div>
        ))}
      </dl>
    </Panel>
  );
}

const TONE_BAR: Record<RadarCard["tone"], string> = {
  urgent: "bg-marigold",
  warn: "bg-marigold/60",
  info: "bg-info",
  good: "bg-ok",
};

export function Radar({ cards }: { cards: RadarCard[] }) {
  return (
    <Panel title="Opportunity radar">
      {cards.length === 0 ? (
        <Empty title="Nothing to flag yet">Patterns show up here after a few days of calls.</Empty>
      ) : (
        <ul className="divide-y divide-line">
          {cards.map((c) => (
            <li key={c.kind + c.title} className="flex gap-3 px-5 py-3.5">
              <span className={`mt-1 w-1 shrink-0 self-stretch rounded-full ${TONE_BAR[c.tone]}`} aria-hidden />
              <div className="text-sm">
                <div className="font-medium">{c.link ? <Link to={c.link} className="hover:underline">{c.title}</Link> : c.title}</div>
                <p className="text-ink-soft">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

