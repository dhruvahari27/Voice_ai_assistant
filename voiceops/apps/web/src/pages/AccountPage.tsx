import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { fmtPhone } from "../lib/format";
import type { Me } from "../lib/types";
import { Button, Callout, ErrorNote, Field, Input, PageHeader, Panel } from "../components/ui";

export function AccountPage({ me }: { me: Me }) {
  return (
    <div>
      <PageHeader title="Your account" sub={`Signed in as ${me.user.email}, ${me.user.role === "owner" ? "owner" : "staff"} at ${me.business.name}.`} />
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <ProfileForm me={me} />
        <PasswordForm me={me} />
      </div>
    </div>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const qc = useQueryClient();
  const [name, setName] = useState(me.user.name);
  const [phone, setPhone] = useState(me.user.phone ? fmtPhone(me.user.phone) : "");
  const save = useMutation({
    mutationFn: () => api.patch("/api/v1/auth/profile", { name, phone }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["me"] }),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    save.mutate();
  }
  return (
    <Panel title="Profile">
      <form onSubmit={submit} className="space-y-4 px-5 py-5">
        <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} autoComplete="name" />}</Field>
        <Field label="Mobile (optional)">{(id) => <Input id={id} inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98765 43210" />}</Field>
        <Field label="Email" hint="Ask an owner if this needs to change.">{(id) => <Input id={id} value={me.user.email} disabled />}</Field>
        <ErrorNote error={save.error} />
        <div className="flex items-center justify-end gap-3">
          {save.isSuccess && <span className="text-sm text-ok" role="status">Saved</span>}
          <Button variant="primary" busy={save.isPending}>Save profile</Button>
        </div>
      </form>
    </Panel>
  );
}

function PasswordForm({ me }: { me: Me }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const change = useMutation({
    mutationFn: () => api.post("/api/v1/auth/password", { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      setCurrent("");
      setNext("");
      setAgain("");
    },
  });
  const mismatch = again.length > 0 && again !== next;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!mismatch) change.mutate();
  }
  return (
    <Panel title="Password">
      <form onSubmit={submit} className="space-y-4 px-5 py-5">
        {me.isDemoAccount && <Callout tone="attention">This is the shared demo account. Changing its password will lock out anyone else using the demo on this server.</Callout>}
        <Field label="Current password">{(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />}</Field>
        <Field label="New password" hint="At least 8 characters.">{(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={8} autoComplete="new-password" />}</Field>
        <Field label="New password again" error={mismatch ? "The two new passwords don't match." : undefined}>
          {(id) => <Input id={id} type="password" value={again} onChange={(e) => setAgain(e.target.value)} required autoComplete="new-password" />}
        </Field>
        <ErrorNote error={change.error} />
        {change.isSuccess && <Callout tone="ok">Password changed. You've been signed out on your other devices.</Callout>}
        <div className="flex justify-end">
          <Button variant="primary" busy={change.isPending} disabled={mismatch}>Change password</Button>
        </div>
      </form>
    </Panel>
  );
}
