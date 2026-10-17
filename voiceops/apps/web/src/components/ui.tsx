import { useEffect, useId, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { OUTCOME_LABEL } from "../lib/format";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "attention";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-navy text-panel hover:bg-navy-hover border border-transparent shadow-sm",
  secondary: "bg-panel text-ink border border-line-strong hover:bg-sunken hover:border-ink/25",
  ghost: "bg-transparent text-ink-soft border border-transparent hover:bg-sunken hover:text-ink",
  danger: "bg-panel text-bad border border-line-strong hover:bg-bad-soft",
  attention: "bg-marigold text-[#2a1d02] border border-transparent hover:brightness-95",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={rest.disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        size === "sm" ? "h-8 px-2.5 text-[13px]" : size === "lg" ? "h-11 px-5 text-[15px]" : "h-9.5 px-4 text-sm"
      } ${VARIANTS[variant]} ${className}`}
    >
      {busy && <Spinner small />}
      {children}
    </button>
  );
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block animate-spin rounded-full border-2 border-current border-r-transparent ${small ? "size-3.5" : "size-5"}`}
    />
  );
}

type Tone = "neutral" | "ok" | "bad" | "attention" | "info";
const TONES: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-soft ring-line",
  ok: "bg-ok-soft text-ok ring-ok/20",
  bad: "bg-bad-soft text-bad ring-bad/20",
  attention: "bg-marigold-soft text-marigold-ink ring-marigold/30",
  info: "bg-info-soft text-info ring-info/20",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]} ${className}`}>{children}</span>;
}

const OUTCOME_TONE: Record<string, Tone> = {
  booked: "ok",
  rescheduled: "ok",
  answered: "info",
  cancelled: "neutral",
  callback: "attention",
  waitlist: "attention",
  handoff: "bad",
  abandoned: "neutral",
};

export function OutcomeBadge({ outcome }: { outcome: string | null | undefined }) {
  if (!outcome) return <Badge tone="info">In progress</Badge>;
  return <Badge tone={OUTCOME_TONE[outcome] ?? "neutral"}>{OUTCOME_LABEL[outcome] ?? outcome}</Badge>;
}

export function Panel({ title, action, children, className = "", bodyClass = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-panel shadow-[var(--shadow-panel)] ${className}`}>
      {(title || action) && (
        <header className="flex min-h-13 items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="font-display text-base font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className={bodyClass}>{children}</div>
    </section>
  );
}

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-2xl">
        <h1 className="text-[30px] leading-[1.1] font-bold sm:text-[34px]">{title}</h1>
        {sub && <p className="mt-2 text-[15px] text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-5 py-12 text-center">
      <p className="font-display text-base font-semibold">{title}</p>
      {children && <div className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
      {msg}
    </p>
  );
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-8 text-sm text-muted" role="status">
      <Spinner small /> {label}…
    </div>
  );
}

// ---------- form fields ----------
const fieldBase =
  "rounded-lg border border-line-strong bg-panel px-3 text-sm text-ink placeholder:text-muted/80 transition-shadow focus:border-navy focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-navy)_12%,transparent)] focus:outline-none";

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-[13px] font-medium text-ink-soft">
        {label}
      </label>
      {children(id)}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${fieldBase} h-10 ${/(^|\s)w-/.test(props.className ?? "") ? "" : "w-full"} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${fieldBase} h-10 pr-8 ${/(^|\s)w-/.test(props.className ?? "") ? "" : "w-full"} ${props.className ?? ""}`} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${fieldBase} w-full min-h-20 py-2 ${props.className ?? ""}`} />;
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2 text-sm text-ink-soft"
    >
      <span className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-navy" : "bg-line-strong"}`}>
        <span className={`absolute top-0.5 size-4 rounded-full bg-panel shadow transition-all ${checked ? "left-4.5" : "left-0.5"}`} />
      </span>
      {label}
    </button>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div role="tablist" className="inline-flex max-w-full overflow-x-auto rounded-lg border border-line bg-sunken p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          role="tab"
          aria-selected={value === it.value}
          onClick={() => onChange(it.value)}
          className={`rounded-md px-3 py-1.5 text-sm whitespace-nowrap ${value === it.value ? "bg-panel font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Native <dialog>: focus trap, Esc to close and backdrop come for free. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-auto w-[calc(100%-2rem)] ${wide ? "max-w-2xl" : "max-w-lg"} rounded-2xl border border-line bg-panel p-0 text-ink shadow-2xl backdrop:bg-[#0d1626]/55 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <div>
          <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <h2 className="font-display text-lg font-semibold">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
              <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 5l10 10M15 5L5 15" /></svg>
            </button>
          </header>
          <div className="max-h-[75vh] overflow-y-auto px-5 py-4">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function DemoNote({ share }: { share: number }) {
  if (share <= 0) return null;
  return (
    <p className="mb-5 rounded-lg border border-dashed border-line-strong px-3 py-2 text-sm text-muted">
      {share >= 0.99 ? "These numbers come from demo data" : `About ${Math.round(share * 100)}% of these calls are demo data`}, so the dashboard isn't empty on first run. Remove it in Settings when you go live.
    </p>
  );
}

/** The VoiceOps mark: a speech bubble holding a waveform. */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M6 4h20a4 4 0 0 1 4 4v12a4 4 0 0 1-4 4H14l-6 5v-5H6a4 4 0 0 1-4-4V8a4 4 0 0 1 4-4z" fill="#f2a20f" />
      <g stroke="#0d1626" strokeWidth="2.2" strokeLinecap="round">
        <path d="M10 12v4M14 9.5v9M18 11v6M22 13v2" />
      </g>
    </svg>
  );
}

/** Animated marigold bars: the receptionist is on duty / speaking. */
export function VoiceBars({ still, className = "h-4" }: { still?: boolean; className?: string }) {
  return (
    <span className={`voice-bars inline-flex items-center gap-[3px] ${still ? "still" : ""} ${className}`} aria-hidden>
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
      <span className="h-full" />
    </span>
  );
}

/** A short note inside a page: tips, warnings, explanations. */
export function Callout({ tone = "info", title, children, action }: { tone?: "info" | "attention" | "ok"; title?: ReactNode; children: ReactNode; action?: ReactNode }) {
  const styles = {
    info: "border-info/25 bg-info-soft text-ink",
    attention: "border-marigold/40 bg-marigold-soft text-ink",
    ok: "border-ok/25 bg-ok-soft text-ink",
  }[tone];
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-4 py-3 text-sm ${styles}`}>
      <div className="min-w-[14rem] flex-1">
        {title && <p className="font-semibold">{title}</p>}
        <div className="text-ink-soft">{children}</div>
      </div>
      {action}
    </div>
  );
}
