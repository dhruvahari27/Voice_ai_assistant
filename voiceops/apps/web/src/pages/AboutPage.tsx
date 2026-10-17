import { Link } from "react-router-dom";
import { Logo, Panel, VoiceBars } from "../components/ui";

const PIPELINE = [
  ["Answer", "Picks up every call, day or night, in English, Hindi or Hinglish. Greets returning customers by name."],
  ["Understand", "Works out what the caller wants (a booking, a change, a price, a question) and the day, time and service, including phrases like \"kal shaam\" or \"parso 11 baje\"."],
  ["Act", "Checks real availability, holds the slot for five minutes while it collects a name and number, and reads the booking back before confirming."],
  ["Verify", "The server only books after the caller's own words say yes. A database rule makes double-booking a bay impossible, even if two calls ask for the same slot at the same moment."],
  ["Recover", "If the time is full it offers the nearest free times, then a waitlist. When a slot opens, the waitlist hears about it on WhatsApp and the first to reply gets it."],
  ["Escalate", "Complaints, requests for a person and anything it isn't sure about go to Follow-ups with a short summary, so your team calls back knowing the story."],
  ["Learn", "Questions it couldn't answer are collected in Knowledge. Add the answer once and it uses it on every call after."],
] as const;

const SAFETY = [
  ["No double bookings", "Each bay can hold only one booking at a time. The database enforces it, not just the app."],
  ["Nothing booked without a yes", "Before booking, the server reads the caller's last words and refuses unless they clearly agreed."],
  ["Safe to retry", "Every booking action has a key. If a network glitch repeats it, the customer still gets one booking and one message."],
  ["Website requests are checked", "Anyone can type any phone number on a website, so web bookings wait for your team to confirm them. Phone calls use caller ID."],
  ["A record of every change", "Who booked, moved or cancelled what, and when: the AI, a staff member or the customer."],
  ["Your data stays separate", "Every query is scoped to your business. Staff sign in with their own accounts, and only owners can change settings."],
] as const;

export function AboutPage({ standalone }: { standalone?: boolean }) {
  return (
    <div className={standalone ? "mx-auto max-w-[1000px] px-5 py-10 sm:px-8" : ""}>
      {standalone && (
        <div className="mb-10 flex items-center justify-between">
          <Link to="/login" className="flex items-center gap-2">
            <Logo className="size-8" />
            <span className="font-display text-lg font-bold">VoiceOps</span>
          </Link>
          <Link to="/login" className="text-sm font-semibold text-info hover:underline">Sign in</Link>
        </div>
      )}

      <section className="night-texture overflow-hidden rounded-3xl px-6 py-10 text-night-ink sm:px-10 sm:py-12">
        <p className="flex items-center gap-2 text-sm text-night-muted">
          <VoiceBars className="h-3.5" /> About VoiceOps
        </p>
        <h1 className="mt-4 max-w-2xl text-[36px] leading-[1.05] font-bold text-white sm:text-[46px]">A missed call is a missed booking.</h1>
        <p className="mt-5 max-w-2xl text-[16px] leading-relaxed text-night-muted">
          Small service businesses in India run on the phone. When the owner is under a car or the front desk is busy, calls go unanswered and customers ring the next garage.
          VoiceOps is an AI receptionist that answers those calls, books real appointments safely, and tells you exactly what happened.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-[26px] font-bold">How a call is handled</h2>
        <p className="mt-2 max-w-2xl text-muted">Seven steps, the same on every call. You can see each one in the call's transcript.</p>
        <ol className="mt-6 grid gap-x-8 gap-y-6 md:grid-cols-2">
          {PIPELINE.map(([title, text], i) => (
            <li key={title} className="flex gap-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-line-strong bg-panel font-display text-sm font-bold">{i + 1}</span>
              <div>
                <h3 className="text-lg font-semibold">{title}</h3>
                <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14">
        <h2 className="text-[26px] font-bold">Why you can trust it with your calendar</h2>
        <div className="mt-6 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {SAFETY.map(([title, text]) => (
            <div key={title} className="bg-panel p-5">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-14 grid gap-5 lg:grid-cols-2">
        <Panel title="Who it's for" bodyClass="px-5 py-4 text-[15px] leading-relaxed text-ink-soft">
          Car service centres, salons, clinics and repair shops: any business where customers call to book a time with a bay, chair, room or person. The demo is AutoCare, a car service
          centre in Bengaluru with two bays and five services.
        </Panel>
        <Panel title="What it's built with" bodyClass="px-5 py-4 text-[15px] leading-relaxed text-ink-soft">
          A Node.js and TypeScript API on Postgres, a React dashboard, and a Python voice agent for real phone lines (LiveKit, with Deepgram or Sarvam for Indian speech). The
          receptionist runs on a built-in rules engine, or on any OpenAI-compatible model when you add a key. Both use the same booking tools and the same safety checks.
        </Panel>
      </section>

      <p className="mt-12 text-sm text-muted">
        Questions about using it? See <Link to={standalone ? "/login" : "/help"} className="text-info underline-offset-2 hover:underline">{standalone ? "sign in" : "Help"}</Link>.
      </p>
    </div>
  );
}
