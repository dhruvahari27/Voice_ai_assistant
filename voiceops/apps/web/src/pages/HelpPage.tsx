import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import type { Me } from "../lib/types";
import { Button, PageHeader } from "../components/ui";
import { Icon } from "../components/Layout";

const PAGES: { to: string; icon: string; title: string; what: string; doThis: string }[] = [
  { to: "/", icon: "overview", title: "Today", what: "The day at a glance: bookings, calls in progress, booking requests to confirm, and anything that needs a person.", doThis: "Start your day here. Mark customers as Arrived or No-show as they come in." },
  { to: "/talk", icon: "talk", title: "Talk to receptionist", what: "A test line to the receptionist in your browser, using your microphone or the keyboard.", doThis: "Try it like a customer would: \"Kal 11 baje oil change ho sakta hai?\" Watch the steps it takes on the right." },
  { to: "/calls", icon: "calls", title: "Calls", what: "Every conversation with its transcript, outcome and each tool the receptionist used.", doThis: "Open a call to see exactly why it booked, offered alternatives or handed over." },
  { to: "/appointments", icon: "appointments", title: "Appointments", what: "A calendar per bay. Dashed marigold blocks are website requests waiting for you.", doThis: "Click a booking to confirm, move or cancel it. Use New booking for walk-ins and phone bookings you take yourself." },
  { to: "/inbox", icon: "inbox", title: "Follow-ups", what: "Callbacks, complaints and requests for a person, plus the waitlist. Overdue items are flagged.", doThis: "Call the customer, then mark it done. The receptionist promised them a call back." },
  { to: "/knowledge", icon: "knowledge", title: "Knowledge", what: "The answers the receptionist gives, and the questions callers asked that it couldn't answer.", doThis: "Turn each unanswered question into an answer. It's used on the very next call." },
  { to: "/insights", icon: "insights", title: "Insights", what: "Calls, conversion, busy times, unmet demand and an estimate of the value of callers who didn't book.", doThis: "Check it weekly. If Saturdays keep filling up, add a bay or extend hours." },
  { to: "/messages", icon: "messages", title: "Messages", what: "Every WhatsApp sent: confirmations, reminders, waitlist offers and your evening summary.", doThis: "Until WhatsApp is connected, messages are simulated and shown here instead of being sent." },
  { to: "/settings", icon: "settings", title: "Settings", what: "Hours, closures, services and prices, bays, and booking rules. Only owners can change them.", doThis: "Set these before going live. The receptionist quotes exactly what's here." },
  { to: "/team", icon: "team", title: "Team", what: "Everyone who can sign in. Owners can add staff, change roles and reset passwords.", doThis: "Give each person their own account so the activity log shows who did what." },
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "The microphone doesn't work on Talk to receptionist",
    a: "Use Chrome or Edge. Click the lock icon in the address bar, allow the microphone and reload. Speech recognition needs internet because Chrome sends audio to Google to turn it into text. You can always type instead.",
  },
  {
    q: "I can't hear the receptionist",
    a: "Check the speaker toggle on the Talk page and your system volume. On Windows, voices like \"Microsoft Heera\" sound best for Indian English. Add them in Windows Settings › Time & language › Speech.",
  },
  {
    q: "Why is a booking marked as a request?",
    a: "Bookings made from a website can't prove the phone number belongs to the caller, so they reserve the slot and wait for you. Open it and choose Confirm booking or Decline. Bookings on real phone calls are confirmed straight away because caller ID is trusted.",
  },
  {
    q: "What is the demo data?",
    a: "Four weeks of sample calls and bookings so the dashboard isn't empty on day one. It's labelled, and an owner can remove it in Settings › Connections and data with one click.",
  },
  {
    q: "How do I add my staff?",
    a: "Owners open Team and choose Add person. VoiceOps creates a temporary password to pass on; they can change it in Your account after signing in. Staff can handle bookings and follow-ups but can't change settings or the team.",
  },
  {
    q: "I forgot my password",
    a: "Ask an owner to reset it from Team. They'll get a new temporary password to give you. If you're the only owner, the person running the server can reset the database or add an owner.",
  },
  {
    q: "How do real phone calls reach it?",
    a: "The Python voice agent connects a phone number (through LiveKit and an Indian telephony provider) to the same receptionist. See docs/going-live.md in the project for the steps and keys you need.",
  },
  {
    q: "Does it use AI models? What does that cost?",
    a: "By default it runs on a built-in rules engine that costs nothing and works offline. Add an API key for any OpenAI-compatible model (OpenAI, Groq, Gemini, a local Ollama) and you can switch to it on the Talk page. The same safety checks apply either way.",
  },
];

export function HelpPage({ me }: { me: Me }) {
  const { openGuide } = useOutletContext<{ openGuide: () => void }>();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div>
      <PageHeader title="Help" sub="How VoiceOps works, what each page is for, and answers to common problems." />

      <section className="night-texture flex flex-wrap items-center gap-5 rounded-2xl px-6 py-6 text-night-ink">
        <div className="min-w-[16rem] flex-1">
          <h2 className="text-xl font-bold text-white">New here? Take the two-minute tour</h2>
          <p className="mt-1 text-night-muted">Five short steps: what the receptionist does, how to try it, and where to step in.</p>
        </div>
        <Button variant="attention" size="lg" onClick={openGuide}>Start the tour</Button>
      </section>

      <section className="mt-10">
        <h2 className="text-[22px] font-bold">Your first ten minutes</h2>
        <ol className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            ["Make a test call", "Open Talk to receptionist and book a car wash for tomorrow, by voice or by typing.", "/talk", "Open Talk"],
            ["Find it everywhere", "See the booking on Appointments, the conversation in Calls and the WhatsApp in Messages.", "/appointments", "Open Appointments"],
            me.user.role === "owner"
              ? ["Set up your shop", "Put in your real hours, services and prices in Settings, then add your team.", "/settings", "Open Settings"]
              : ["Check follow-ups", "Open Follow-ups and call back anyone who's waiting.", "/inbox", "Open Follow-ups"],
          ].map(([title, text, to, cta], i) => (
            <li key={title} className="rounded-2xl border border-line bg-panel p-5 shadow-[var(--shadow-panel)]">
              <span className="font-display text-sm font-bold text-marigold-ink">Step {i + 1}</span>
              <h3 className="mt-1 text-lg font-semibold">{title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">{text}</p>
              <Link to={to!} className="mt-3 inline-block text-sm font-semibold text-info underline-offset-2 hover:underline">{cta}</Link>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-[22px] font-bold">What each page does</h2>
        <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-panel)]">
          {PAGES.map((p) => (
            <Link key={p.to} to={p.to} className="group grid gap-x-6 gap-y-1 border-b border-line px-5 py-4 last:border-b-0 hover:bg-sunken md:grid-cols-[220px_1fr_1fr]">
              <span className="flex items-center gap-2.5 font-semibold">
                <span className="grid size-8 place-items-center rounded-lg bg-sunken text-ink-soft group-hover:bg-panel">
                  <Icon name={p.icon} className="size-4" />
                </span>
                {p.title}
              </span>
              <span className="text-sm text-ink-soft">{p.what}</span>
              <span className="text-sm text-muted">{p.doThis}</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="text-[22px] font-bold">Common questions</h2>
        <div className="mt-4 divide-y divide-line rounded-2xl border border-line bg-panel shadow-[var(--shadow-panel)]">
          {FAQ.map((f, i) => (
            <div key={f.q}>
              <button
                className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium hover:bg-sunken"
                aria-expanded={open === i}
                onClick={() => setOpen(open === i ? null : i)}
              >
                {f.q}
                <svg viewBox="0 0 20 20" className={`size-4 shrink-0 text-muted transition-transform ${open === i ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
                  <path d="M5 8l5 5 5-5" />
                </svg>
              </button>
              {open === i && <p className="max-w-3xl px-5 pb-5 text-[15px] leading-relaxed text-ink-soft">{f.a}</p>}
            </div>
          ))}
        </div>
      </section>

      <p className="mt-10 text-sm text-muted">
        Want the bigger picture? Read <Link to="/about" className="text-info underline-offset-2 hover:underline">About VoiceOps</Link>.
      </p>
    </div>
  );
}
