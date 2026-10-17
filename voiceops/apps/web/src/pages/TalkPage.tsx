import { useEffect, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { formatPaise, TOOL_LABEL } from "../lib/format";
import { listen, speak, speechSupported, stopSpeaking, ttsSupported } from "../lib/speech";
import type { Me, SystemInfo, ToolTrace, TurnResult } from "../lib/types";
import { Badge, Button, ErrorNote, Input, PageHeader, Select, Toggle, VoiceBars } from "../components/ui";

type Phase = "idle" | "starting" | "ready" | "listening" | "thinking" | "speaking" | "ended";
interface Line {
  role: "agent" | "caller";
  text: string;
  trace?: ToolTrace[];
  latencyMs?: number;
}

const TRY = [
  "Kal shaam car detailing ke liye slot hai?",
  "How much is a car wash?",
  "I want to book an oil change on Saturday at 11",
  "Do you offer pickup and drop?",
  "Do you do ceramic coating for SUVs?",
  "I need to reschedule my booking",
  "Mujhe manager se baat karni hai",
];

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Not on a call",
  starting: "Connecting",
  ready: "Your turn: tap the mic or type",
  listening: "Listening… speak now",
  thinking: "Thinking",
  speaking: "Receptionist is speaking (tap the mic to interrupt)",
  ended: "Call ended",
};

export function TalkPage({ me }: { me: Me }) {
  const qc = useQueryClient();
  const system = useQuery({ queryKey: ["system"], queryFn: () => api.get<SystemInfo>("/api/v1/system") });
  const [phase, setPhase] = useState<Phase>("idle");
  const [lines, setLines] = useState<Line[]>([]);
  const [interim, setInterim] = useState("");
  const [callId, setCallId] = useState<string | null>(null);
  const [state, setState] = useState<TurnResult["state"] | null>(null);
  const [engine, setEngine] = useState<"rules" | "llm">("rules");
  const [lang, setLang] = useState<"en-IN" | "hi-IN">("en-IN");
  const [muted, setMuted] = useState(false);
  const [handsFree, setHandsFree] = useState(true);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const callRef = useRef<string | null>(null);
  callRef.current = callId;
  // Bumped whenever the caller acts (speaks, types, hangs up). A reply only opens the mic
  // automatically if nothing happened while it was being spoken.
  const turnRef = useRef(0);
  const prefs = useRef({ handsFree, muted, lang });
  prefs.current = { handsFree, muted, lang };
  const [hint, setHint] = useState<string | null>(null);
  const slug = me.business.slug;

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [lines, interim]);

  // Leaving the page hangs up.
  useEffect(
    () => () => {
      stopRef.current?.();
      stopSpeaking();
      if (callRef.current) navigator.sendBeacon?.(`/api/v1/public/${slug}/calls/${callRef.current}/end`);
    },
    [slug],
  );

  async function afterReply(res: TurnResult) {
    const turn = ++turnRef.current;
    setLines((l) => [...l, { role: "agent", text: res.reply, trace: res.trace, latencyMs: res.latencyMs }]);
    setState(res.state);
    if (res.engine !== engine && callRef.current) setEngine(res.engine);
    if (res.ended) {
      setCallId(null);
      callRef.current = null;
      qc.invalidateQueries({ queryKey: ["calls"] });
    }
    setPhase(res.ended ? "ended" : "speaking");
    // speak() always finishes (it has its own time limits), so the call can't get stuck here.
    await speak(res.reply, res.state.lang === "hi" ? "hi" : "en", prefs.current.muted);
    if (res.ended || turn !== turnRef.current) return; // caller already moved on
    setPhase("ready");
    const p = prefs.current;
    if (p.handsFree && speechSupported && !p.muted) startListening();
  }

  async function startCall() {
    setError(null);
    setLines([]);
    setState(null);
    setPhase("starting");
    try {
      const res = await api.post<TurnResult>(`/api/v1/public/${slug}/calls`, { engine, lang: lang === "hi-IN" ? "hi" : "en" });
      setCallId(res.callId);
      callRef.current = res.callId;
      await afterReply(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    }
  }

  async function send(text: string) {
    const id = callRef.current;
    if (!id || !text.trim()) return;
    turnRef.current++;
    stopRef.current?.();
    stopSpeaking();
    setHint(null);
    setInterim("");
    setLines((l) => [...l, { role: "caller", text }]);
    setPhase("thinking");
    try {
      const res = await api.post<TurnResult>(`/api/v1/public/${slug}/calls/${id}/turns`, { text });
      await afterReply(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("ready");
    }
  }

  function startListening() {
    turnRef.current++;
    setError(null);
    setHint(null);
    stopSpeaking();
    setPhase("listening");
    stopRef.current = listen(prefs.current.lang, {
      onInterim: setInterim,
      onFinal: (t) => void send(t),
      onError: (m) => setError(m),
      onEnd: (heardNothing) => {
        stopRef.current = null;
        setInterim("");
        if (heardNothing) setHint("I didn't hear anything. Tap the mic and speak, or type below.");
        setPhase((p) => (p === "listening" ? "ready" : p));
      },
    });
  }

  async function endCall() {
    turnRef.current++;
    stopRef.current?.();
    stopSpeaking();
    setHint(null);
    if (callId) await api.post(`/api/v1/public/${slug}/calls/${callId}/end`).catch(() => undefined);
    setCallId(null);
    setPhase("ended");
    qc.invalidateQueries({ queryKey: ["calls"] });
  }

  function submitTyped(e: FormEvent) {
    e.preventDefault();
    const t = typed.trim();
    setTyped("");
    if (t) void send(t);
  }

  const onCall = Boolean(callId) && phase !== "ended";
  const busy = phase === "thinking" || phase === "starting";

  return (
    <div>
      <PageHeader
        title="Talk to your receptionist"
        sub={`Call ${me.business.name} the way a customer would. It books real slots in your calendar (as requests you confirm), and the call appears in Calls.`}
      />
      <div className="-mt-2 mb-5 flex flex-wrap items-center gap-3">
          <Select aria-label="Recognition language" value={lang} onChange={(e) => setLang(e.target.value as typeof lang)} disabled={onCall} className="w-auto">
            <option value="en-IN">English / Hinglish</option>
            <option value="hi-IN">Hindi (Devanagari)</option>
          </Select>
          <Select aria-label="Engine" value={engine} onChange={(e) => setEngine(e.target.value as typeof engine)} disabled={onCall} className="w-auto">
            <option value="rules">Built-in engine</option>
            <option value="llm" disabled={!system.data?.llmAvailable}>
              AI model{system.data?.llmAvailable ? ` (${system.data.llmModel})` : " (add LLM_API_KEY)"}
            </option>
          </Select>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_300px]">
        {/* The call */}
        <section className="flex min-h-[560px] flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-panel)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
            <div className="flex items-center gap-2.5">
              <span className={`size-2.5 shrink-0 rounded-full ${phase === "listening" ? "listening bg-marigold" : onCall ? "bg-marigold" : "bg-line-strong"}`} aria-hidden />
              <span className="text-sm font-medium" role="status" aria-live="polite">{PHASE_LABEL[phase]}</span>
              {engine === "llm" && onCall && <Badge tone="info">AI model</Badge>}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {ttsSupported && <Toggle checked={!muted} onChange={(v) => setMuted(!v)} label="Voice" />}
              {speechSupported && <Toggle checked={handsFree} onChange={setHandsFree} label="Hands-free" />}
              {onCall && (
                <Button size="sm" variant="danger" onClick={endCall}>
                  Hang up
                </Button>
              )}
            </div>
          </header>

          <div ref={scroller} className="max-h-[62vh] min-h-[340px] flex-1 space-y-4 overflow-y-auto bg-sunken/60 px-4 py-5 sm:px-6" aria-live="polite">
            {lines.length === 0 && phase === "idle" && (
              <div className="mx-auto max-w-md py-10 text-center">
                <p className="font-display text-xl font-semibold">Ready when you are</p>
                <p className="mt-2 text-sm text-muted">
                  {speechSupported
                    ? "Start a call, then talk through your microphone or type. Try Hinglish: it understands kal, parso, shaam and saade chhe."
                    : "Your browser doesn't support voice input, so type your side of the call. For voice, open this page in Chrome or Edge."}
                </p>
              </div>
            )}
            {lines.map((l, i) => (
              <Bubble key={i} line={l} />
            ))}
            {interim && <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-navy/80 px-4 py-2.5 text-panel italic">{interim}</div>}
            {phase === "thinking" && <div className="text-sm text-muted">Receptionist is checking…</div>}
          </div>

          <footer className="border-t border-line px-4 py-4 sm:px-6">
            {error && <div className="mb-3"><ErrorNote error={error} /></div>}
            {hint && !error && onCall && <p className="mb-3 text-sm text-muted" role="status">{hint}</p>}
            {!onCall ? (
              <div className="flex justify-center">
                <Button variant="attention" onClick={startCall} busy={phase === "starting"} className="h-12 rounded-full px-7 text-base">
                  {phase === "ended" ? "Start another call" : "Start a call"}
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                {speechSupported && (
                  <button
                    type="button"
                    onClick={() => (phase === "listening" ? stopRef.current?.() : startListening())}
                    disabled={busy}
                    aria-label={phase === "listening" ? "Stop listening" : "Speak"}
                    className={`grid size-14 shrink-0 place-items-center rounded-full transition-colors disabled:opacity-50 ${
                      phase === "listening" ? "listening bg-marigold text-[#2a1d02]" : "bg-navy text-panel hover:bg-navy-hover"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
                    </svg>
                  </button>
                )}
                <form onSubmit={submitTyped} className="flex min-w-0 flex-1 gap-2">
                  <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={speechSupported ? "Or type what the caller says…" : "Type what the caller says…"} aria-label="Type a message" disabled={busy} className="min-w-0" />
                  <Button variant="primary" disabled={busy || !typed.trim()}>
                    Send
                  </Button>
                </form>
              </div>
            )}
          </footer>
        </section>

        {/* What the receptionist has understood so far */}
        <aside className="space-y-5">
          <div className="overflow-hidden rounded-2xl border border-line bg-panel shadow-[var(--shadow-panel)]">
            <h2 className="border-b border-line px-4 py-3 font-display text-base font-semibold">What it has understood</h2>
            <dl className="divide-y divide-line text-sm">
              <Row k="Language" v={state ? (state.lang === "hi" ? "Hinglish" : "English") : null} />
              <Row k="Working on" v={state?.flow ? FLOW[state.flow] ?? state.flow : null} />
              <Row k="Service" v={state?.service} />
              <Row k="Day" v={state?.date} />
              <Row k="Time" v={state?.time} />
              <Row k="Name" v={state?.name} />
              <Row k="Phone" v={state?.phone} />
            </dl>
            {state?.hold && <HoldCard hold={state.hold} />}
            {state?.outcome && (
              <div className="border-t border-line px-4 py-3 text-sm">
                <Badge tone="ok">{OUTCOME[state.outcome.kind] ?? state.outcome.kind}</Badge>{" "}
                <Link to={state.outcome.kind === "booked" ? "/" : "/appointments"} className="ml-1 text-info underline-offset-2 hover:underline">
                  {state.outcome.kind === "booked" ? "Confirm it on Today" : "See it in the calendar"}
                </Link>
              </div>
            )}
          </div>

          <div>
            <h2 className="mb-2 font-display text-[15px] font-semibold">Try saying</h2>
            <div className="flex flex-wrap gap-1.5">
              {TRY.map((t) => (
                <button
                  key={t}
                  disabled={!onCall || busy}
                  onClick={() => void send(t)}
                  className="rounded-full border border-line-strong bg-panel px-3 py-1.5 text-left text-[13px] text-ink-soft hover:border-navy hover:text-ink disabled:opacity-50"
                >
                  {t}
                </button>
              ))}
            </div>
            {!onCall && <p className="mt-2 text-xs text-muted">Start a call to use these.</p>}
          </div>
          <p className="text-xs leading-relaxed text-muted">
            Voice here uses your browser's speech features. Real phone calls go through the phone agent in <code>apps/agent</code>, which uses the same receptionist.
          </p>
        </aside>
      </div>
    </div>
  );
}

const FLOW: Record<string, string> = { book: "New booking", reschedule: "Moving a booking", cancel: "Cancelling", callback: "Arranging a call back", waitlist: "Waitlist", handoff: "Passing to staff", lookup: "Looking up bookings" };
const OUTCOME: Record<string, string> = { booked: "Booking request saved", rescheduled: "Moved", cancelled: "Cancelled", callback: "Callback created", waitlist: "On the waitlist", handoff: "Staff alerted" };

function Row({ k, v }: { k: string; v: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-2">
      <dt className="text-muted">{k}</dt>
      <dd className={`text-right ${v ? "font-medium" : "text-line-strong"}`}>{v || "—"}</dd>
    </div>
  );
}

function HoldCard({ hold }: { hold: NonNullable<TurnResult["state"]["hold"]> }) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    const tick = () => setLeft(Math.max(0, Math.round((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [hold.expiresAt]);
  return (
    <div className="border-t border-line bg-marigold-soft px-4 py-3 text-sm text-marigold-ink">
      <div className="font-medium">Slot on hold</div>
      <div>
        {hold.serviceName}, {hold.when}, {formatPaise(hold.pricePaise)}
      </div>
      <div className="mt-1 text-xs">
        {left > 0 ? `Reserved for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")} while the caller confirms` : "Hold expired"}
      </div>
    </div>
  );
}

function Bubble({ line }: { line: Line }) {
  if (line.role === "caller") {
    return <div className="ml-auto max-w-[80%] rounded-2xl rounded-br-sm bg-navy px-4 py-2.5 text-panel">{line.text}</div>;
  }
  return (
    <div className="max-w-[85%]">
      <div className="mb-1 flex items-center gap-1.5 pl-1 text-xs text-muted"><VoiceBars still className="h-2.5" /> Receptionist</div>
      <div className="rounded-2xl rounded-tl-sm border border-marigold/35 bg-panel px-4 py-2.5 shadow-[var(--shadow-panel)]">{line.text}</div>
      {(line.trace?.length || line.latencyMs !== undefined) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-1 text-xs text-muted">
          {line.trace?.map((t, i) => (
            <span key={i} title={JSON.stringify(t.args)} className={`rounded px-1.5 py-0.5 ring-1 ring-inset ${t.ok ? "bg-panel ring-line" : "bg-bad-soft text-bad ring-bad/20"}`}>
              {TOOL_LABEL[t.name] ?? t.name}
              {!t.ok && t.result.error ? `: ${t.result.error.code.replace(/_/g, " ")}` : ""}
            </span>
          ))}
          {line.latencyMs !== undefined && <span>{line.latencyMs} ms</span>}
        </div>
      )}
    </div>
  );
}
