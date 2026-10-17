import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtLocalDate, formatPaise } from "../lib/format";
import type { Me, Resource, Service, SystemInfo } from "../lib/types";
import { Badge, Button, Callout, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select, Toggle } from "../components/ui";

interface Setup {
  business: { name: string; city: string | null; address: string | null; phone: string | null; ownerPhone: string | null; slug: string };
  hours: { weekday: number; opensAt: string; closesAt: string }[];
  policy: {
    minLeadMinutes: number;
    maxHorizonDays: number;
    cancelWindowHours: number;
    maxBookingsPerCustomerPerDay: number;
    slotStepMinutes: number;
    holdSeconds: number;
    callbackSlaMinutes: number;
    remindersEnabled: boolean;
  };
  services: Service[];
  resources: Resource[];
  closures: { id: string; date: string; reason: string | null }[];
}

const SECTIONS = [
  ["business", "Business"],
  ["hours", "Opening hours"],
  ["services", "Services and prices"],
  ["rules", "Booking rules"],
  ["closures", "Holidays"],
  ["connections", "Connections and data"],
] as const;

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function SettingsPage({ me }: { me: Me }) {
  const q = useQuery({ queryKey: ["business"], queryFn: () => api.get<Setup>("/api/v1/business") });
  const owner = me.user.role === "owner";
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorNote error={q.error} />;
  const d = q.data!;
  return (
    <div>
      <PageHeader title="Settings" sub={owner ? "What the receptionist knows about your business. Changes apply to the next call." : "What the receptionist knows about your business."} />
      {!owner && (
        <div className="mb-5">
          <Callout title="View only">You're signed in as staff, so you can see the setup but not change it. Ask an owner if something is wrong.</Callout>
        </div>
      )}
      <div className="lg:grid lg:grid-cols-[180px_1fr] lg:gap-8">
        <nav aria-label="Settings sections" className="mb-5 hidden lg:block">
          <ul className="sticky top-8 space-y-0.5 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-lg px-3 py-1.5 text-ink-soft hover:bg-panel hover:text-ink">{label}</a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5 [&>*]:scroll-mt-6">
          <div id="business"><Profile d={d} disabled={!owner} /></div>
          <div id="hours"><Hours d={d} disabled={!owner} /></div>
          <div id="services"><Services d={d} disabled={!owner} /></div>
          <div id="rules"><Rules d={d} disabled={!owner} /></div>
          <div id="closures"><Closures d={d} disabled={!owner} /></div>
          <div id="connections"><Connections owner={owner} /></div>
        </div>
      </div>
    </div>
  );
}

function useSave<T>(fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["business"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });
}

function Saved({ show }: { show: boolean }) {
  return show ? <span className="text-sm text-ok" role="status">Saved</span> : null;
}

function Profile({ d, disabled }: { d: Setup; disabled: boolean }) {
  const [f, setF] = useState({ name: d.business.name, city: d.business.city ?? "", address: d.business.address ?? "", phone: d.business.phone ?? "", ownerPhone: d.business.ownerPhone ?? "" });
  const save = useSave(() => api.patch("/api/v1/business", { ...f, city: f.city || null, address: f.address || null, phone: f.phone || null, ownerPhone: f.ownerPhone || null }));
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(undefined);
  }
  return (
    <Panel title="Business">
      <form onSubmit={submit} className="grid gap-4 px-5 py-4 sm:grid-cols-2">
        <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} disabled={disabled} required />}</Field>
        <Field label="City">{(id) => <Input id={id} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} disabled={disabled} />}</Field>
        <div className="sm:col-span-2">
          <Field label="Address" hint="The receptionist reads this out when callers ask where you are.">
            {(id) => <Input id={id} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} disabled={disabled} />}
          </Field>
        </div>
        <Field label="Shop phone">{(id) => <Input id={id} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} disabled={disabled} />}</Field>
        <Field label="Your WhatsApp number" hint="Complaints, overdue call backs and the evening summary go here.">
          {(id) => <Input id={id} value={f.ownerPhone} onChange={(e) => setF({ ...f, ownerPhone: e.target.value })} disabled={disabled} />}
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button variant="primary" disabled={disabled} busy={save.isPending}>Save business</Button>
          <Saved show={save.isSuccess} />
          <ErrorNote error={save.error} />
        </div>
      </form>
    </Panel>
  );
}

function Hours({ d, disabled }: { d: Setup; disabled: boolean }) {
  const initial = () =>
    [1, 2, 3, 4, 5, 6, 0].map((wd) => {
      const h = d.hours.find((x) => x.weekday === wd);
      return { weekday: wd, open: Boolean(h), opensAt: h?.opensAt ?? "09:00", closesAt: h?.closesAt ?? "18:00" };
    });
  const [rows, setRows] = useState(initial);
  useEffect(() => setRows(initial()), [d.hours]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useSave(() => api.put("/api/v1/hours", { hours: rows.filter((r) => r.open).map(({ weekday, opensAt, closesAt }) => ({ weekday, opensAt, closesAt })) }));
  const set = (i: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <Panel title="Opening hours">
      <div className="divide-y divide-line">
        {rows.map((r, i) => (
          <div key={r.weekday} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
            <span className="w-28 text-sm font-medium">{DAYS[r.weekday]}</span>
            <Toggle checked={r.open} onChange={(v) => !disabled && set(i, { open: v })} label={r.open ? "Open" : "Closed"} />
            {r.open && (
              <div className="flex items-center gap-2 text-sm">
                <Input type="time" value={r.opensAt} onChange={(e) => set(i, { opensAt: e.target.value })} className="w-32" disabled={disabled} aria-label={`${DAYS[r.weekday]} opens`} />
                <span className="text-muted">to</span>
                <Input type="time" value={r.closesAt} onChange={(e) => set(i, { closesAt: e.target.value })} className="w-32" disabled={disabled} aria-label={`${DAYS[r.weekday]} closes`} />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 border-t border-line px-5 py-3">
        <Button variant="primary" onClick={() => save.mutate(undefined)} disabled={disabled} busy={save.isPending}>Save hours</Button>
        <Saved show={save.isSuccess} />
        <ErrorNote error={save.error} />
      </div>
    </Panel>
  );
}

function Services({ d, disabled }: { d: Setup; disabled: boolean }) {
  const [editing, setEditing] = useState<Partial<Service> | null>(null);
  const bays = d.resources.filter((r) => r.active).length;
  return (
    <Panel title="Services and prices" action={!disabled && <Button size="sm" onClick={() => setEditing({ aliases: [], bufferMin: 0, resourceKind: "bay", active: true })}>Add service</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-[13px] text-muted">
            <tr>
              <th className="px-4 py-2 font-medium">Service</th>
              <th className="px-4 py-2 font-medium">Callers also say</th>
              <th className="px-4 py-2 text-right font-medium">Time</th>
              <th className="px-4 py-2 text-right font-medium">Price</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.services.map((s) => (
              <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                <td className="px-4 py-2.5 font-medium">{s.name} {!s.active && <Badge>Off</Badge>}</td>
                <td className="px-4 py-2.5 text-ink-soft">{s.aliases.join(", ") || "—"}</td>
                <td className="px-4 py-2.5 text-right whitespace-nowrap">{s.durationMin} min{s.bufferMin ? ` + ${s.bufferMin} cleanup` : ""}</td>
                <td className="px-4 py-2.5 text-right">{formatPaise(s.pricePaise)}</td>
                <td className="px-4 py-2.5 text-right">{!disabled && <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>Edit</Button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
        {bays} {bays === 1 ? "bay" : "bays"} in use ({d.resources.map((r) => r.name).join(", ")}). Each booking takes one bay for its time plus cleanup.
      </p>
      {editing && <ServiceModal s={editing} onClose={() => setEditing(null)} />}
    </Panel>
  );
}

function ServiceModal({ s, onClose }: { s: Partial<Service>; onClose: () => void }) {
  const [f, setF] = useState({
    name: s.name ?? "",
    aliases: (s.aliases ?? []).join(", "),
    durationMin: String(s.durationMin ?? 60),
    bufferMin: String(s.bufferMin ?? 0),
    price: s.pricePaise != null ? String(s.pricePaise / 100) : "",
    active: s.active ?? true,
  });
  const save = useSave(() => {
    const body = {
      name: f.name,
      aliases: f.aliases.split(",").map((a) => a.trim()).filter(Boolean),
      durationMin: Number(f.durationMin),
      bufferMin: Number(f.bufferMin),
      pricePaise: Math.round(Number(f.price) * 100),
      active: f.active,
      resourceKind: s.resourceKind ?? "bay",
    };
    return s.id ? api.patch(`/api/v1/services/${s.id}`, body) : api.post("/api/v1/services", body);
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate(undefined, { onSuccess: onClose });
  }
  return (
    <Modal open onClose={onClose} title={s.id ? `Edit ${s.name}` : "Add a service"}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}</Field>
        <Field label="Other names callers use" hint="Comma separated. Include Hindi: dhulai, gaadi dhona">
          {(id) => <Input id={id} value={f.aliases} onChange={(e) => setF({ ...f, aliases: e.target.value })} />}
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Minutes">{(id) => <Input id={id} type="number" min={5} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} required />}</Field>
          <Field label="Cleanup min">{(id) => <Input id={id} type="number" min={0} value={f.bufferMin} onChange={(e) => setF({ ...f, bufferMin: e.target.value })} />}</Field>
          <Field label="Price (₹)">{(id) => <Input id={id} type="number" min={0} step="1" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required />}</Field>
        </div>
        <Toggle checked={f.active} onChange={(v) => setF({ ...f, active: v })} label="The receptionist can book this" />
        <ErrorNote error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={save.isPending}>Save service</Button>
        </div>
      </form>
    </Modal>
  );
}

function Rules({ d, disabled }: { d: Setup; disabled: boolean }) {
  const [p, setP] = useState(d.policy);
  const save = useSave(() => api.patch("/api/v1/policy", p));
  const num = (k: keyof Setup["policy"], label: string, hint: string, min = 0) => (
    <Field label={label} hint={hint}>
      {(id) => <Input id={id} type="number" min={min} value={String(p[k])} disabled={disabled} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />}
    </Field>
  );
  return (
    <Panel title="Booking rules">
      <p className="border-b border-line px-5 py-3 text-sm text-muted">
        The receptionist can't break these. They're checked by the server on every booking, whatever the caller says.
      </p>
      <div className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {num("minLeadMinutes", "Minimum notice (minutes)", "No bookings sooner than this.")}
        {num("maxHorizonDays", "Book up to (days ahead)", "How far into the future callers can book.", 1)}
        {num("cancelWindowHours", "Changes allowed until (hours before)", "Later changes go to staff.")}
        {num("maxBookingsPerCustomerPerDay", "Bookings per caller per day", "Stops one number blocking the day.", 1)}
        <Field label="Time between slots" hint="Start times are offered on this grid.">
          {(id) => (
            <Select id={id} value={p.slotStepMinutes} disabled={disabled} onChange={(e) => setP({ ...p, slotStepMinutes: Number(e.target.value) })}>
              {[15, 30, 60].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </Select>
          )}
        </Field>
        {num("callbackSlaMinutes", "Alert me if a call back is late by (minutes)", "You get a WhatsApp.", 10)}
      </div>
      <div className="flex flex-wrap items-center gap-4 border-t border-line px-5 py-3">
        <Toggle checked={p.remindersEnabled} onChange={(v) => !disabled && setP({ ...p, remindersEnabled: v })} label="Send reminders a day and 2 hours before" />
        <div className="ml-auto flex items-center gap-3">
          <Saved show={save.isSuccess} />
          <Button variant="primary" onClick={() => save.mutate(undefined)} disabled={disabled} busy={save.isPending}>Save rules</Button>
        </div>
        <ErrorNote error={save.error} />
      </div>
    </Panel>
  );
}

function Closures({ d, disabled }: { d: Setup; disabled: boolean }) {
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const add = useSave(() => api.post("/api/v1/closures", { date, reason: reason || null }));
  const remove = useSave((id: string) => api.del(`/api/v1/closures/${id}`));
  return (
    <Panel title="Holidays and closed days">
      <ul className="divide-y divide-line">
        {d.closures.length === 0 && <li className="px-5 py-3 text-sm text-muted">No closed days added.</li>}
        {d.closures.map((c) => (
          <li key={c.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span><span className="font-medium">{fmtLocalDate(c.date)}</span>{c.reason && <span className="text-muted">, {c.reason}</span>}</span>
            {!disabled && <Button size="sm" variant="ghost" onClick={() => remove.mutate(c.id)}>Remove</Button>}
          </li>
        ))}
      </ul>
      {!disabled && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(undefined, { onSuccess: () => { setDate(""); setReason(""); } });
          }}
          className="flex flex-wrap items-end gap-3 border-t border-line px-5 py-3"
        >
          <Field label="Date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required className="w-44" />}</Field>
          <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Diwali" className="w-56" />}</Field>
          <Button busy={add.isPending}>Add closed day</Button>
          <ErrorNote error={add.error} />
        </form>
      )}
    </Panel>
  );
}

function Connections({ owner }: { owner: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/v1/system") });
  const clear = useMutation({ mutationFn: () => api.post("/api/v1/demo/clear", {}), onSuccess: () => qc.invalidateQueries() });
  const load = useMutation({ mutationFn: () => api.post("/api/v1/demo/seed", {}), onSuccess: () => qc.invalidateQueries() });
  const [confirm, setConfirm] = useState(false);
  if (!q.data) return null;
  const s = q.data;
  return (
    <Panel title="Connections and data">
      <ul className="divide-y divide-line text-sm">
        <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <div>
            <div className="font-medium">AI model</div>
            <div className="text-muted">{s.llmAvailable ? `Connected (${s.llmModel}). Choose it on the Talk page.` : "Not connected. The built-in engine handles calls. Add LLM_API_KEY to .env to try an AI model."}</div>
          </div>
          <Badge tone={s.llmAvailable ? "ok" : "neutral"}>{s.llmAvailable ? "On" : "Off"}</Badge>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <div>
            <div className="font-medium">WhatsApp</div>
            <div className="text-muted">{s.whatsappConfigured ? "Messages are sent through WhatsApp Cloud API." : "Not connected. Messages are shown on the Messages page instead of being sent."}</div>
          </div>
          <Badge tone={s.whatsappConfigured ? "ok" : "neutral"}>{s.whatsappConfigured ? "On" : "Off"}</Badge>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
          <div>
            <div className="font-medium">Database</div>
            <div className="text-muted">{s.database === "pglite" ? "Built-in database on this computer (apps/api/.data)." : "Postgres server."} Version {s.version}.</div>
          </div>
        </li>
        <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
          <div>
            <div className="font-medium">Demo data</div>
            <div className="text-muted">{s.demoData ? "Four weeks of sample calls, follow-ups and bookings are loaded so the dashboard has something to show." : "No demo data. Everything you see is real."}</div>
          </div>
          {!owner ? null : s.demoData ? (
            <Button variant="danger" onClick={() => setConfirm(true)}>Remove demo data</Button>
          ) : (
            <Button onClick={() => load.mutate()} busy={load.isPending}>Load demo data</Button>
          )}
        </li>
      </ul>
      <ErrorNote error={clear.error ?? load.error} />
      <Modal open={confirm} onClose={() => setConfirm(false)} title="Remove demo data?">
        <p className="text-sm text-ink-soft">This deletes the sample calls, customers, bookings and messages. Your real calls and settings stay.</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
          <Button variant="danger" busy={clear.isPending} onClick={() => clear.mutate(undefined, { onSuccess: () => setConfirm(false) })}>Remove demo data</Button>
        </div>
      </Modal>
    </Panel>
  );
}
