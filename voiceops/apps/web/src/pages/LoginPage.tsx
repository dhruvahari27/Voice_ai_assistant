import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../lib/api";
import type { AuthOptions } from "../lib/types";
import { Button, ErrorNote, Field, Input, Logo, Select, VoiceBars } from "../components/ui";

const TRANSCRIPT: { who: "caller" | "agent" | "tool"; text: string }[] = [
  { who: "caller", text: "Hello, kal evening car detailing ka slot hai?" },
  { who: "agent", text: "Haan ji! Kal 4 PM aur 6 PM khaali hain. Kaunsa time chalega?" },
  { who: "caller", text: "6 baje wala. Rahul Sharma, 98765 43210." },
  { who: "tool", text: "Slot held · Bay 2 · Tue 6 PM" },
  { who: "agent", text: "Premium Detailing, kal 6 PM, 3,499 rupees. Book kar doon?" },
  { who: "caller", text: "Haan, kar do." },
  { who: "tool", text: "Booked · WhatsApp confirmation sent" },
];

/** Shared frame for sign-in and sign-up: a live-looking call on the left, the form on the right. */
function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="night-texture relative hidden flex-col justify-between overflow-hidden px-12 py-10 text-night-ink lg:flex">
        <div className="flex items-center gap-2.5">
          <Logo className="size-9" />
          <span className="font-display text-xl font-bold text-white">VoiceOps</span>
        </div>
        <div className="max-w-[34rem]">
          <h1 className="text-[44px] leading-[1.05] font-bold text-white xl:text-[52px]">Every call answered. Every booking safe.</h1>
          <p className="mt-4 max-w-md text-[16px] leading-relaxed text-night-muted">
            An AI receptionist for Indian service businesses. It talks to customers in English, Hindi and Hinglish, and books straight into your calendar.
          </p>
          <div className="mt-9 space-y-2.5" aria-label="Example call">
            {TRANSCRIPT.map((line, i) => (
              <div key={i} className="arrive" style={{ animationDelay: `${0.35 + i * 0.45}s` }}>
                {line.who === "tool" ? (
                  <p className="flex items-center gap-2 pl-1 text-xs text-night-muted">
                    <span className="size-1.5 rounded-full bg-ok" aria-hidden /> {line.text}
                  </p>
                ) : (
                  <p
                    className={`w-fit max-w-[82%] rounded-2xl px-4 py-2 text-[15px] ${
                      line.who === "caller" ? "rounded-bl-sm bg-night-raised text-night-ink" : "ml-auto rounded-br-sm bg-marigold text-[#2a1d02]"
                    }`}
                  >
                    {line.text}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        <p className="flex items-center gap-2 text-sm text-night-muted">
          <VoiceBars className="h-3.5" /> Answering in English, हिंदी and Hinglish
        </p>
      </section>

      <section className="flex min-h-screen flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center gap-2 lg:hidden">
          <Logo className="size-8" />
          <span className="font-display text-lg font-bold">VoiceOps</span>
        </div>
        <div className="m-auto w-full max-w-[400px] py-10">{children}</div>
        <p className="text-center text-xs text-muted">
          <Link to="/about" className="underline-offset-2 hover:underline">What is VoiceOps?</Link>
        </p>
      </section>
    </div>
  );
}

function useAuthOptions() {
  return useQuery({ queryKey: ["auth-options"], queryFn: () => api.get<AuthOptions>("/api/v1/auth/options"), staleTime: Infinity });
}

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<"form" | "demo" | null>(null);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const options = useAuthOptions();

  async function signIn(creds: { email: string; password: string }, which: "form" | "demo") {
    setBusy(which);
    setError(null);
    try {
      await api.post("/api/v1/auth/login", creds);
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void signIn({ email, password }, "form");
  }

  const demo = options.data?.demoLogin;
  return (
    <AuthFrame>
      <h2 className="text-[32px] leading-tight font-bold">Sign in</h2>
      <p className="mt-2 text-[15px] text-muted">Welcome back. Your receptionist kept answering while you were away.</p>

      {demo && (
        <div className="mt-7 rounded-2xl border border-line bg-panel p-4 shadow-[var(--shadow-panel)]">
          <p className="font-medium">Just looking?</p>
          <p className="mt-0.5 text-sm text-muted">Open a sample car service centre with four weeks of calls. Nothing reaches real customers.</p>
          <Button variant="attention" className="mt-3 w-full" busy={busy === "demo"} onClick={() => signIn(demo, "demo")}>
            Try the demo
          </Button>
        </div>
      )}

      <div className="my-6 flex items-center gap-3 text-xs text-muted">
        <span className="h-px flex-1 bg-line" />
        {demo ? "or sign in to your business" : "Sign in to your business"}
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submit} className="space-y-4">
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />}</Field>
        <ErrorNote error={error} />
        <Button variant="primary" size="lg" className="w-full" busy={busy === "form"}>
          Sign in
        </Button>
      </form>
      <p className="mt-3 text-xs text-muted">Forgot your password? Ask your business owner to reset it from Team.</p>

      {options.data?.signupEnabled && (
        <p className="mt-8 text-center text-sm text-ink-soft">
          New to VoiceOps?{" "}
          <Link to="/signup" className="font-semibold text-info underline-offset-2 hover:underline">
            Set up your business
          </Link>
        </p>
      )}
    </AuthFrame>
  );
}

const TIMEZONES = [
  ["Asia/Kolkata", "India (IST)"],
  ["Asia/Dubai", "UAE (GST)"],
  ["Asia/Singapore", "Singapore"],
  ["Asia/Kathmandu", "Nepal"],
  ["Asia/Dhaka", "Bangladesh"],
  ["Europe/London", "UK"],
] as const;

export function SignupPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const options = useAuthOptions();
  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState({
    businessName: "",
    city: "",
    businessPhone: "",
    timezone: "Asia/Kolkata",
    template: "car_service" as "car_service" | "blank",
    ownerName: "",
    email: "",
    ownerPhone: "",
    password: "",
  });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const fieldError = (name: string) => {
    if (!(error instanceof ApiError)) return undefined;
    const issues = Array.isArray(error.details) ? (error.details as { path: string; message: string }[]) : [];
    return issues.find((i) => i.path === name)?.message;
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (step === 1) {
      setStep(2);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/v1/auth/signup", {
        ...form,
        city: form.city || undefined,
        businessPhone: form.businessPhone || undefined,
        ownerPhone: form.ownerPhone || undefined,
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/");
    } catch (err) {
      setError(err);
      const paths = err instanceof ApiError && Array.isArray(err.details) ? (err.details as { path: string }[]).map((d) => d.path) : [];
      if (paths.some((p) => ["businessName", "city", "businessPhone", "timezone"].includes(p))) setStep(1);
    } finally {
      setBusy(false);
    }
  }

  if (options.data && !options.data.signupEnabled) {
    return (
      <AuthFrame>
        <h2 className="text-[28px] font-bold">Sign-up is closed</h2>
        <p className="mt-2 text-muted">This server only lets the owner add people. Ask them to add you from Team.</p>
        <Link to="/login" className="mt-6 inline-block font-semibold text-info hover:underline">Back to sign in</Link>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame>
      <p className="text-sm text-muted">Step {step} of 2</p>
      <h2 className="mt-1 text-[32px] leading-tight font-bold">{step === 1 ? "Your business" : "Your account"}</h2>
      <p className="mt-2 text-[15px] text-muted">
        {step === 1 ? "This is what your receptionist will say when it answers." : "You'll be the owner. You can add your staff afterwards."}
      </p>

      <form onSubmit={submit} className="mt-7 space-y-4">
        {step === 1 ? (
          <>
            <Field label="Business name" error={fieldError("businessName")}>
              {(id) => <Input id={id} value={form.businessName} onChange={set("businessName")} placeholder="Sharma Motors" required minLength={2} autoFocus />}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="City">{(id) => <Input id={id} value={form.city} onChange={set("city")} placeholder="Pune" />}</Field>
              <Field label="Timezone">
                {(id) => (
                  <Select id={id} value={form.timezone} onChange={set("timezone")}>
                    {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </Select>
                )}
              </Field>
            </div>
            <Field label="Business phone (optional)" error={fieldError("businessPhone")} hint="The number customers call.">
              {(id) => <Input id={id} inputMode="tel" value={form.businessPhone} onChange={set("businessPhone")} placeholder="98765 43210" />}
            </Field>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-medium text-ink-soft">Start with</legend>
              {(
                [
                  ["car_service", "Car service centre", "Oil change, car wash, detailing, AC and general service, with two bays and common FAQs. Edit the prices later."],
                  ["blank", "Empty setup", "One example service and one desk. Add your own services in Settings."],
                ] as const
              ).map(([value, title, desc]) => (
                <label
                  key={value}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 ${form.template === value ? "border-navy bg-sunken" : "border-line-strong hover:border-ink/30"}`}
                >
                  <input type="radio" name="template" value={value} checked={form.template === value} onChange={() => setForm((f) => ({ ...f, template: value }))} className="mt-1 accent-[var(--color-navy)]" />
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-sm text-muted">{desc}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            <Button variant="primary" size="lg" className="w-full">Continue</Button>
          </>
        ) : (
          <>
            <Field label="Your name" error={fieldError("ownerName")}>{(id) => <Input id={id} value={form.ownerName} onChange={set("ownerName")} autoComplete="name" required minLength={2} autoFocus />}</Field>
            <Field label="Email" error={fieldError("email")}>{(id) => <Input id={id} type="email" value={form.email} onChange={set("email")} autoComplete="email" required />}</Field>
            <Field label="Password" error={fieldError("password")} hint="At least 8 characters.">
              {(id) => <Input id={id} type="password" value={form.password} onChange={set("password")} autoComplete="new-password" required minLength={8} />}
            </Field>
            <Field label="Your mobile (optional)" error={fieldError("ownerPhone")} hint="For the evening summary on WhatsApp.">
              {(id) => <Input id={id} inputMode="tel" value={form.ownerPhone} onChange={set("ownerPhone")} placeholder="98765 43210" />}
            </Field>
            <ErrorNote error={error instanceof ApiError && Array.isArray(error.details) ? "Check the fields marked above." : error} />
            <div className="flex gap-2">
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep(1)}>Back</Button>
              <Button variant="primary" size="lg" className="flex-1" busy={busy}>Create my business</Button>
            </div>
          </>
        )}
      </form>

      <p className="mt-8 text-center text-sm text-ink-soft">
        Already have an account?{" "}
        <Link to="/login" className="font-semibold text-info underline-offset-2 hover:underline">Sign in</Link>
      </p>
    </AuthFrame>
  );
}
