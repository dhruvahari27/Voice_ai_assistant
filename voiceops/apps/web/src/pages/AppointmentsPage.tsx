import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api, newKey } from "../lib/api";
import { addDays, currentTimezone, fmtLocalDate, fmtLocalTime, fmtPhone, fmtTime, formatPaise, todayLocal } from "../lib/format";
import type { Appointment, Resource, Service } from "../lib/types";
import { Badge, Button, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Textarea } from "../components/ui";

const ROW = 56; // px per hour

function localMinutes(iso: string) {
  const p = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: currentTimezone() }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour")!.value) * 60 + Number(p.find((x) => x.type === "minute")!.value);
}

interface BusinessSetup {
  services: Service[];
  hours: { weekday: number; opensAt: string; closesAt: string }[];
}

export function AppointmentsPage() {
  const [date, setDate] = useState(todayLocal());
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<Appointment | null>(null);
  const setup = useQuery({ queryKey: ["business"], queryFn: () => api.get<BusinessSetup>("/api/v1/business") });
  const q = useQuery({
    queryKey: ["appointments", date],
    queryFn: () => api.get<{ appointments: Appointment[]; resources: Resource[] }>(`/api/v1/appointments?from=${date}&to=${date}`),
  });

  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  const dayHours = setup.data?.hours.filter((h) => h.weekday === weekday) ?? [];
  const startH = Math.min(9, ...dayHours.map((h) => Math.floor(Number(h.opensAt.slice(0, 2)))));
  const endH = Math.max(20, ...dayHours.map((h) => Math.ceil(Number(h.closesAt.slice(0, 2)) + Number(h.closesAt.slice(3)) / 60)));
  const resources = (q.data?.resources ?? []).filter((r) => r.active);
  const isToday = date === todayLocal();
  const nowMin = localMinutes(new Date().toISOString());

  return (
    <div>
      <PageHeader
        title="Appointments"
        sub={dayHours.length ? `Open ${dayHours.map((h) => `${fmtLocalTime(h.opensAt)}–${fmtLocalTime(h.closesAt)}`).join(", ")}` : "Closed this day"}
        actions={<Button variant="primary" onClick={() => setCreating(true)}>New booking</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setDate(addDays(date, -1))} aria-label="Previous day">Previous</Button>
        <Button size="sm" onClick={() => setDate(todayLocal())} disabled={isToday}>Today</Button>
        <Button size="sm" onClick={() => setDate(addDays(date, 1))} aria-label="Next day">Next</Button>
        <span className="ml-2 font-display text-lg font-semibold">{fmtLocalDate(date)}</span>
        <Input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="ml-auto w-auto" aria-label="Pick a date" />
      </div>

      {q.isLoading && <Loading />}
      <ErrorNote error={q.error} />
      {q.data && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-panel">
          <div className="grid min-w-[560px]" style={{ gridTemplateColumns: `56px repeat(${resources.length}, minmax(170px, 1fr))` }}>
            <div className="border-b border-line" />
            {resources.map((r) => (
              <div key={r.id} className="border-b border-l border-line px-3 py-2.5 text-sm font-medium">{r.name}</div>
            ))}
            <div className="relative" style={{ height: (endH - startH) * ROW }}>
              {Array.from({ length: endH - startH }, (_, i) => (
                <div key={i} className="absolute right-2 -translate-y-1/2 text-xs text-muted" style={{ top: i * ROW + (i === 0 ? 8 : 0) }}>
                  {fmtLocalTime(`${String(startH + i).padStart(2, "0")}:00`).replace(":00", "")}
                </div>
              ))}
            </div>
            {resources.map((r) => (
              <div key={r.id} className="relative border-l border-line" style={{ height: (endH - startH) * ROW }}>
                {Array.from({ length: endH - startH }, (_, i) => (
                  <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * ROW }} />
                ))}
                {/* Closed stretches */}
                {closedBands(dayHours, startH, endH).map(([a, b]) => (
                  <div key={a} className="absolute inset-x-0 bg-sunken" style={{ top: (a - startH * 60) * (ROW / 60), height: (b - a) * (ROW / 60) }} aria-hidden />
                ))}
                {isToday && nowMin > startH * 60 && nowMin < endH * 60 && (
                  <div className="absolute inset-x-0 z-10 border-t-2 border-marigold" style={{ top: (nowMin - startH * 60) * (ROW / 60) }} aria-label="Now" />
                )}
                {q.data.appointments
                  .filter((a) => a.resourceId === r.id && a.status !== "cancelled")
                  .map((a) => {
                    const top = (localMinutes(a.startsAt) - startH * 60) * (ROW / 60);
                    const h = Math.max(28, ((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000) * (ROW / 60) - 3);
                    return (
                      <button
                        key={a.id}
                        onClick={() => setOpen(a)}
                        className={`absolute inset-x-1.5 z-[5] overflow-hidden rounded-md border px-2 py-1 text-left text-xs hover:brightness-[0.97] ${
                          a.status === "no_show" ? "border-bad/30 bg-bad-soft" : a.status === "completed" ? "border-ok/30 bg-ok-soft" : a.status === "pending" ? "border-dashed border-marigold bg-marigold-soft" : "border-navy/20 bg-info-soft"
                        }`}
                        style={{ top: top + 1, height: h }}
                      >
                        <div className="truncate font-semibold text-ink">{fmtTime(a.startsAt)} {a.serviceName}{h < 40 && a.customer?.name ? `, ${a.customer.name}` : ""}</div>
                        {h >= 40 && <div className="truncate text-ink-soft">{a.customer?.name ?? fmtPhone(a.customer?.phone)}</div>}
                      </button>
                    );
                  })}
              </div>
            ))}
          </div>
          {q.data.appointments.length === 0 && <Empty title="No bookings this day" />}
        </div>
      )}

      {creating && setup.data && <NewBooking services={setup.data.services.filter((s) => s.active)} initialDate={date} onClose={() => setCreating(false)} onDone={(d) => { setCreating(false); setDate(d); }} />}
      {open && <AppointmentModal appt={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function closedBands(hours: { opensAt: string; closesAt: string }[], startH: number, endH: number): [number, number][] {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  const spans = hours.map((h) => [toMin(h.opensAt), toMin(h.closesAt)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let cursor = startH * 60;
  for (const [a, b] of spans) {
    if (a > cursor) out.push([cursor, a]);
    cursor = Math.max(cursor, b);
  }
  if (cursor < endH * 60) out.push([cursor, endH * 60]);
  return out;
}

function SlotPicker({ serviceId, date, value, onChange }: { serviceId: string; date: string; value: string; onChange: (t: string) => void }) {
  const slots = useQuery({
    queryKey: ["availability", serviceId, date],
    queryFn: () => api.get<{ slots: { time: string }[]; closed: string | null }>(`/api/v1/availability?serviceId=${serviceId}&date=${date}`),
    enabled: Boolean(serviceId && date),
  });
  if (!serviceId) return <p className="text-sm text-muted">Pick a service first.</p>;
  if (slots.isLoading) return <Loading label="Checking free times" />;
  if (slots.data?.closed) return <p className="text-sm text-muted">Closed that day.</p>;
  if (!slots.data?.slots.length) return <p className="text-sm text-muted">No free times that day.</p>;
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Free times">
      {slots.data.slots.map((s) => (
        <button
          type="button"
          key={s.time}
          role="radio"
          aria-checked={value === s.time}
          onClick={() => onChange(s.time)}
          className={`rounded-md border px-2.5 py-1 text-sm ${value === s.time ? "border-navy bg-navy text-panel" : "border-line-strong hover:border-navy"}`}
        >
          {fmtLocalTime(s.time)}
        </button>
      ))}
    </div>
  );
}

function NewBooking({ services, initialDate, onClose, onDone }: { services: Service[]; initialDate: string; onClose: () => void; onDone: (date: string) => void }) {
  const qc = useQueryClient();
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [date, setDate] = useState(initialDate < todayLocal() ? todayLocal() : initialDate);
  const [time, setTime] = useState("");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const key = useMemo(newKey, []);
  const create = useMutation({
    mutationFn: () => api.post("/api/v1/appointments", { serviceId, date, time, phone, name: name || undefined, notes: notes || undefined, idempotencyKey: key }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["appointments"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
      onDone(date);
    },
  });
  const svc = services.find((s) => s.id === serviceId);
  function submit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }
  return (
    <Modal open onClose={onClose} title="New booking">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Service" hint={svc ? `${svc.durationMin} min, ${formatPaise(svc.pricePaise)}` : undefined}>
          {(id) => (
            <Select id={id} value={serviceId} onChange={(e) => { setServiceId(e.target.value); setTime(""); }}>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Day">{(id) => <Input id={id} type="date" value={date} min={todayLocal()} onChange={(e) => { setDate(e.target.value); setTime(""); }} required />}</Field>
        <div className="space-y-1">
          <div className="text-[13px] font-medium text-ink-soft">Time</div>
          <SlotPicker serviceId={serviceId} date={date} value={time} onChange={setTime} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Mobile number">{(id) => <Input id={id} inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} required />}</Field>
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Car model, special requests" />}</Field>
        <ErrorNote error={create.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!time || !phone} busy={create.isPending}>Book and send WhatsApp</Button>
        </div>
      </form>
    </Modal>
  );
}

function AppointmentModal({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [date, setDate] = useState(todayLocal());
  const [time, setTime] = useState("");
  const [reason, setReason] = useState("");
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["appointments"] });
    qc.invalidateQueries({ queryKey: ["overview"] });
  };
  const act = useMutation({
    mutationFn: async (kind: "move" | "cancel" | "completed" | "no_show" | "approve") => {
      if (kind === "approve") return api.post(`/api/v1/appointments/${appt.id}/approve`, {});
      if (kind === "move") return api.post(`/api/v1/appointments/${appt.id}/reschedule`, { date, time });
      if (kind === "cancel") return api.post(`/api/v1/appointments/${appt.id}/cancel`, { reason: reason || "Cancelled by staff" });
      return api.post(`/api/v1/appointments/${appt.id}/attendance`, { status: kind });
    },
    onSuccess: () => {
      refresh();
      onClose();
    },
  });
  const past = new Date(appt.startsAt).getTime() < Date.now();
  const live = appt.status === "confirmed" || appt.status === "pending";

  return (
    <Modal open onClose={onClose} title={`${appt.serviceName}, ${appt.when}`}>
      <dl className="grid grid-cols-[110px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Customer</dt>
        <dd>{appt.customer?.name ?? "Unknown"}, {fmtPhone(appt.customer?.phone)}</dd>
        <dt className="text-muted">Where</dt>
        <dd>{appt.resourceName}</dd>
        <dt className="text-muted">Price</dt>
        <dd>{formatPaise(appt.pricePaise)}</dd>
        <dt className="text-muted">Reference</dt>
        <dd className="font-medium">{appt.bookingRef}</dd>
        <dt className="text-muted">Booked by</dt>
        <dd>
          {appt.source === "staff" ? "Staff" : appt.source === "whatsapp" ? "Waitlist on WhatsApp" : "AI receptionist"}
          {appt.callId && <> (<Link to={`/calls/${appt.callId}`} className="text-info underline-offset-2 hover:underline">see the call</Link>)</>}
        </dd>
        {appt.notes && (<><dt className="text-muted">Notes</dt><dd>{appt.notes}</dd></>)}
        <dt className="text-muted">Status</dt>
        <dd>
          {appt.status === "completed" ? (
            <Badge tone="ok">Arrived</Badge>
          ) : appt.status === "no_show" ? (
            <Badge tone="bad">No-show</Badge>
          ) : appt.status === "pending" ? (
            <Badge tone="attention">Request: waiting for you to confirm</Badge>
          ) : (
            <Badge tone="info">Confirmed</Badge>
          )}
        </dd>
      </dl>

      {appt.status === "pending" && mode === "view" && (
        <p className="mt-4 rounded-md bg-marigold-soft px-3 py-2 text-sm text-marigold-ink">
          This came from the website, where anyone can type any number. Call or WhatsApp the customer if you're unsure, then confirm it. Confirming sends them the booking on WhatsApp.
        </p>
      )}

      {mode === "move" && (
        <div className="mt-5 space-y-3 border-t border-line pt-4">
          <Field label="New day">{(id) => <Input id={id} type="date" min={todayLocal()} value={date} onChange={(e) => { setDate(e.target.value); setTime(""); }} />}</Field>
          <SlotPicker serviceId={appt.serviceId} date={date} value={time} onChange={setTime} />
        </div>
      )}
      {mode === "cancel" && (
        <div className="mt-5 border-t border-line pt-4">
          <Field label="Reason (optional)" hint="The customer gets a WhatsApp, and the slot is offered to the waitlist.">
            {(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}
          </Field>
        </div>
      )}

      <ErrorNote error={act.error} />
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        {mode === "view" && live && past && (
          <>
            <Button onClick={() => act.mutate("completed")} busy={act.isPending}>Arrived</Button>
            <Button variant="ghost" onClick={() => act.mutate("no_show")}>No-show</Button>
          </>
        )}
        {mode === "view" && live && !past && (
          <>
            <Button variant="danger" onClick={() => setMode("cancel")}>{appt.status === "pending" ? "Decline" : "Cancel booking"}</Button>
            <Button onClick={() => setMode("move")}>Move</Button>
            {appt.status === "pending" && (
              <Button variant="primary" onClick={() => act.mutate("approve")} busy={act.isPending}>Confirm booking</Button>
            )}
          </>
        )}
        {mode === "move" && (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>Back</Button>
            <Button variant="primary" disabled={!time} onClick={() => act.mutate("move")} busy={act.isPending}>Move booking</Button>
          </>
        )}
        {mode === "cancel" && (
          <>
            <Button variant="ghost" onClick={() => setMode("view")}>Keep it</Button>
            <Button variant="danger" onClick={() => act.mutate("cancel")} busy={act.isPending}>Cancel booking</Button>
          </>
        )}
      </div>
    </Modal>
  );
}
