import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtDate } from "../lib/format";
import type { Me, TeamMember } from "../lib/types";
import { Badge, Button, Callout, ErrorNote, Field, Input, Loading, Modal, PageHeader, Panel, Select } from "../components/ui";

const ROLE_TEXT = {
  owner: "Everything, including settings, the team and demo data.",
  staff: "Calls, bookings, follow-ups, knowledge and messages. Can't change settings or the team.",
};

export function TeamPage({ me }: { me: Me }) {
  const owner = me.user.role === "owner";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["team"], queryFn: () => api.get<{ members: TeamMember[] }>("/api/v1/team") });
  const [adding, setAdding] = useState(false);
  const [secret, setSecret] = useState<{ name: string; email: string; password: string } | null>(null);
  const [removing, setRemoving] = useState<TeamMember | null>(null);

  const role = useMutation({
    mutationFn: ({ id, role }: { id: string; role: "owner" | "staff" }) => api.patch(`/api/v1/team/${id}`, { role }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team"] }),
  });
  const reset = useMutation({
    mutationFn: (m: TeamMember) => api.post<{ temporaryPassword: string }>(`/api/v1/team/${m.id}/reset-password`, {}),
    onSuccess: (r, m) => setSecret({ name: m.name, email: m.email, password: r.temporaryPassword }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/v1/team/${id}`),
    onSuccess: () => {
      setRemoving(null);
      qc.invalidateQueries({ queryKey: ["team"] });
    },
  });

  return (
    <div>
      <PageHeader
        title="Team"
        sub="Everyone who can sign in to this dashboard. Each person gets their own account, so the activity log shows who did what."
        actions={owner && <Button variant="primary" onClick={() => setAdding(true)}>Add person</Button>}
      />
      {!owner && (
        <div className="mb-5">
          <Callout title="Only owners can change the team">Ask an owner to add someone, change a role or reset a password.</Callout>
        </div>
      )}
      <ErrorNote error={role.error ?? reset.error} />

      <Panel>
        {q.isLoading ? (
          <Loading />
        ) : (
          <ul className="divide-y divide-line">
            {q.data?.members.map((m) => {
              const self = m.id === me.user.id;
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-full bg-sunken font-display font-semibold text-ink-soft" aria-hidden>
                    {m.name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("")}
                  </span>
                  <div className="min-w-[12rem] flex-1">
                    <div className="font-medium">
                      {m.name} {self && <span className="text-sm font-normal text-muted">(you)</span>}
                    </div>
                    <div className="text-sm text-muted">{m.email} · added {fmtDate(m.createdAt)}</div>
                  </div>
                  {owner && !self ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        aria-label={`Role for ${m.name}`}
                        value={m.role}
                        onChange={(e) => role.mutate({ id: m.id, role: e.target.value as "owner" | "staff" })}
                        className="w-auto"
                        disabled={role.isPending}
                      >
                        <option value="staff">Staff</option>
                        <option value="owner">Owner</option>
                      </Select>
                      <Button size="sm" onClick={() => reset.mutate(m)} busy={reset.isPending && reset.variables?.id === m.id}>Reset password</Button>
                      <Button size="sm" variant="danger" onClick={() => setRemoving(m)}>Remove</Button>
                    </div>
                  ) : (
                    <Badge tone={m.role === "owner" ? "info" : "neutral"}>{m.role === "owner" ? "Owner" : "Staff"}</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {(["owner", "staff"] as const).map((r) => (
          <div key={r} className="rounded-2xl border border-line bg-panel p-5 shadow-[var(--shadow-panel)]">
            <h2 className="font-semibold">{r === "owner" ? "Owner" : "Staff"}</h2>
            <p className="mt-1 text-sm text-ink-soft">{ROLE_TEXT[r]}</p>
          </div>
        ))}
      </div>

      {adding && <AddPerson onClose={() => setAdding(false)} onAdded={(s) => { setAdding(false); if (s.password) setSecret(s); }} />}

      <Modal open={Boolean(secret)} onClose={() => setSecret(null)} title="Share these sign-in details">
        {secret && (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              Give {secret.name} this temporary password in person or on WhatsApp. It's shown only once. They can change it in Your account after signing in.
            </p>
            <dl className="grid grid-cols-[90px_1fr] gap-y-2 rounded-xl bg-sunken p-4 text-sm">
              <dt className="text-muted">Email</dt>
              <dd className="font-medium break-all">{secret.email}</dd>
              <dt className="text-muted">Password</dt>
              <dd className="font-display text-lg font-semibold tracking-wide">{secret.password}</dd>
            </dl>
            <div className="flex justify-end gap-2">
              <CopyButton text={`VoiceOps sign-in\nEmail: ${secret.email}\nTemporary password: ${secret.password}\n${window.location.origin}`} />
              <Button variant="primary" onClick={() => setSecret(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(removing)} onClose={() => setRemoving(null)} title={`Remove ${removing?.name ?? ""}?`}>
        <p className="text-sm text-ink-soft">They're signed out straight away and can't sign in again. Their past actions stay in the activity log.</p>
        <ErrorNote error={remove.error} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>Keep</Button>
          <Button variant="danger" busy={remove.isPending} onClick={() => removing && remove.mutate(removing.id)}>Remove</Button>
        </div>
      </Modal>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          /* clipboard blocked; the details are on screen */
        }
      }}
    >
      {copied ? "Copied" : "Copy details"}
    </Button>
  );
}

function AddPerson({ onClose, onAdded }: { onClose: () => void; onAdded: (s: { name: string; email: string; password: string }) => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", email: "", role: "staff" as "owner" | "staff" });
  const add = useMutation({
    mutationFn: () => api.post<{ member: TeamMember; temporaryPassword: string }>("/api/v1/team", f),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["team"] });
      onAdded({ name: r.member.name, email: r.member.email, password: r.temporaryPassword });
    },
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    add.mutate();
  }
  return (
    <Modal open onClose={onClose} title="Add a person">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Name">{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required minLength={2} autoFocus />}</Field>
        <Field label="Email" hint="They sign in with this. It must be their own.">
          {(id) => <Input id={id} type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />}
        </Field>
        <Field label="Role" hint={ROLE_TEXT[f.role]}>
          {(id) => (
            <Select id={id} value={f.role} onChange={(e) => setF({ ...f, role: e.target.value as "owner" | "staff" })}>
              <option value="staff">Staff</option>
              <option value="owner">Owner</option>
            </Select>
          )}
        </Field>
        <ErrorNote error={add.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={add.isPending}>Add and create password</Button>
        </div>
      </form>
    </Modal>
  );
}
