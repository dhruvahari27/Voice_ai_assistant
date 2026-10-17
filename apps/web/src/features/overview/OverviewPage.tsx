import { useQuery } from "@tanstack/react-query";
import { formatPaise, type BusinessHours } from "@voiceops/shared";
import { api } from "../../lib/api";

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Collapse identical consecutive days: "Mon–Sat 09:00–20:00". */
export function summariseHours(hours: BusinessHours[]): string {
  if (hours.length === 0) return "No hours set";
  const sorted = [...hours].sort((a, b) => a.weekday - b.weekday);
  const groups: { from: number; to: number; span: string }[] = [];
  for (const h of sorted) {
    const span = `${h.opensAt}–${h.closesAt}`;
    const last = groups.at(-1);
    if (last && last.span === span && last.to === h.weekday - 1) last.to = h.weekday;
    else groups.push({ from: h.weekday, to: h.weekday, span });
  }
  return groups
    .map((g) => `${DAY[g.from]}${g.from === g.to ? "" : `–${DAY[g.to]}`} ${g.span}`)
    .join(", ");
}

function StatusPill({ label, state }: { label: string; state: "ok" | "down" | "loading" }) {
  const tone = state === "ok" ? "text-ok bg-ok/10" : state === "down" ? "text-bad bg-bad/10" : "text-muted bg-line";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${tone}`}>
      <span className="size-1.5 rounded-full bg-current" aria-hidden />
      {label}: {state}
    </span>
  );
}

export function OverviewPage({ slug }: { slug: string }) {
  const health = useQuery({ queryKey: ["health"], queryFn: api.health, refetchInterval: 15000 });
  const business = useQuery({ queryKey: ["business", slug], queryFn: () => api.business(slug) });
  const services = useQuery({ queryKey: ["services", slug], queryFn: () => api.services(slug) });

  const apiState = health.isLoading ? "loading" : health.isError ? "down" : "ok";

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {business.data?.name ?? (business.isError ? "Business not found" : "Loading…")}
          </h1>
          {business.data && (
            <p className="mt-1 text-sm text-muted">
              {business.data.city} · {summariseHours(business.data.hours)} · {business.data.timezone}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2" aria-label="System status">
          <StatusPill label="API" state={apiState} />
          <StatusPill label="Database" state={health.data?.db ?? (health.isError ? "down" : "loading")} />
          <StatusPill label="Redis" state={health.data?.redis ?? (health.isError ? "down" : "loading")} />
        </div>
      </header>

      <section className="rounded-xl border border-line bg-surface">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">Services</h2>
          <span className="text-xs text-muted">The receptionist can only book what is listed here</span>
        </div>

        {services.isLoading && <p className="px-5 py-6 text-sm text-muted">Loading services…</p>}
        {services.isError && (
          <p role="alert" className="px-5 py-6 text-sm text-bad">
            Couldn't load services: {services.error.message}
          </p>
        )}
        {services.data && services.data.length === 0 && (
          <p className="px-5 py-6 text-sm text-muted">No services yet.</p>
        )}
        {services.data && services.data.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="px-5 py-2 font-medium">Service</th>
                  <th className="px-5 py-2 font-medium">Also called</th>
                  <th className="px-5 py-2 text-right font-medium">Duration</th>
                  <th className="px-5 py-2 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody>
                {services.data.map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="px-5 py-3 font-medium">{s.name}</td>
                    <td className="px-5 py-3 text-muted">{s.aliases.join(", ") || "—"}</td>
                    <td className="px-5 py-3 text-right tabular-nums">
                      {s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin}` : ""}
                    </td>
                    <td className="px-5 py-3 text-right tabular-nums">{formatPaise(s.pricePaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
