import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Me } from "../lib/types";
import { Button, Modal } from "./ui";

const KEY = (userId: string) => `vo:guide-seen:${userId}`;

function seen(userId: string) {
  try {
    return window.localStorage.getItem(KEY(userId)) === "1";
  } catch {
    return true; // storage blocked: don't nag on every page load
  }
}
function markSeen(userId: string) {
  try {
    window.localStorage.setItem(KEY(userId), "1");
  } catch {
    /* ignore */
  }
}

/** Opens automatically the first time someone signs in on this browser; Help reopens it. */
export function useWelcomeGuide(me: Me) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!seen(me.user.id)) setOpen(true);
  }, [me.user.id]);
  const show = useCallback(() => setOpen(true), []);
  const close = useCallback(() => {
    markSeen(me.user.id);
    setOpen(false);
  }, [me.user.id]);
  return { open, show, close };
}

interface Step {
  title: string;
  body: string;
  example?: { caller: string; agent: string };
  points?: string[];
  go?: { label: string; to: string };
}

function steps(me: Me): Step[] {
  const owner = me.user.role === "owner";
  return [
    {
      title: "Meet your AI receptionist",
      body: `VoiceOps answers ${me.business.name}'s calls when nobody can pick up. It speaks English, Hindi and Hinglish, books, moves and cancels appointments, answers common questions, and passes anything tricky to your team.`,
      example: { caller: "Kal shaam car wash ka slot milega?", agent: "Haan ji, kal 4 PM aur 6 PM khaali hain. Kaunsa time chalega?" },
    },
    {
      title: "Try a call yourself",
      body: "The quickest way to understand it is to talk to it. Open Talk to receptionist, tap the microphone (or type), and ask for a booking the way a customer would.",
      points: ["Ask for a service, a day and a time.", "Give a name and a 10-digit mobile number.", "Say yes when it reads the booking back."],
      go: { label: "Open Talk to receptionist", to: "/talk" },
    },
    {
      title: "See what happened on every call",
      body: "Every call is saved with its transcript and each step the receptionist took: which slots it checked, what it held, what it booked. Today shows the day at a glance.",
      points: ["Today: bookings, live calls and anything waiting for you.", "Calls: the full conversation, step by step.", "Appointments: the calendar for each bay."],
      go: { label: "Go to Today", to: "/" },
    },
    {
      title: "Step in when it needs you",
      body: "The receptionist never guesses. When it can't help, it hands over with a summary so you can call the customer back.",
      points: [
        "Follow-ups: callbacks and complaints, with how long they've waited.",
        "Booking requests from your website wait for you to confirm, because anyone can type any number there.",
        "Customers get WhatsApp confirmations and reminders automatically.",
      ],
      go: { label: "Open Follow-ups", to: "/inbox" },
    },
    {
      title: owner ? "Make it yours" : "Help it learn",
      body: owner
        ? "Set your opening hours, services and prices, and booking rules in Settings. Add answers in Knowledge whenever it couldn't answer a question. Add your staff in Team so everyone signs in with their own account."
        : "When the receptionist couldn't answer a question, it shows up in Knowledge. Add the answer once and it will use it on every call after that.",
      points: ["Help, in the sidebar, explains every page and has this guide.", "About explains how VoiceOps keeps bookings safe."],
      go: owner ? { label: "Open Settings", to: "/settings" } : { label: "Open Knowledge", to: "/knowledge" },
    },
  ];
}

export function WelcomeGuide({ me, open, onClose }: { me: Me; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);
  const navigate = useNavigate();
  const all = steps(me);
  const step = all[i]!;
  useEffect(() => {
    if (open) setI(0);
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={i === 0 ? `Welcome, ${me.user.name.split(" ")[0]}` : "Getting started"} wide>
      <div className="flex items-center gap-1.5" aria-label={`Step ${i + 1} of ${all.length}`}>
        {all.map((_, n) => (
          <button
            key={n}
            onClick={() => setI(n)}
            aria-label={`Step ${n + 1}`}
            aria-current={n === i ? "step" : undefined}
            className={`h-1.5 flex-1 rounded-full transition-colors ${n <= i ? "bg-marigold" : "bg-line"}`}
          />
        ))}
      </div>
      <p className="mt-4 text-sm text-muted">
        Step {i + 1} of {all.length}
      </p>
      <h3 className="mt-1 text-2xl font-bold">{step.title}</h3>
      <p className="mt-2 max-w-prose text-[15px] leading-relaxed text-ink-soft">{step.body}</p>

      {step.example && (
        <div className="night-texture mt-5 space-y-3 rounded-xl p-4 text-[15px]">
          <p className="max-w-[85%] rounded-2xl rounded-bl-sm bg-night-raised px-3.5 py-2 text-night-ink">{step.example.caller}</p>
          <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-marigold px-3.5 py-2 text-[#2a1d02]">{step.example.agent}</p>
        </div>
      )}
      {step.points && (
        <ul className="mt-4 space-y-2">
          {step.points.map((p) => (
            <li key={p} className="flex gap-2.5 text-[15px] text-ink-soft">
              <span className="mt-2 size-1.5 shrink-0 rounded-full bg-marigold" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-7 flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <button onClick={onClose} className="text-sm text-muted underline-offset-2 hover:text-ink hover:underline">
          Skip the guide
        </button>
        <div className="ml-auto flex flex-wrap gap-2">
          {step.go && (
            <Button
              onClick={() => {
                onClose();
                navigate(step.go!.to);
              }}
            >
              {step.go.label}
            </Button>
          )}
          {i > 0 && <Button variant="ghost" onClick={() => setI(i - 1)}>Back</Button>}
          {i < all.length - 1 ? (
            <Button variant="primary" onClick={() => setI(i + 1)}>Next</Button>
          ) : (
            <Button variant="primary" onClick={onClose}>Start using VoiceOps</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
