import { afterEach, describe, expect, it, vi } from "vitest";

/** A fake speechSynthesis like Chrome on Windows: speaks, but never fires onend. */
function brokenSynthesis(voices: Partial<SpeechSynthesisVoice>[] = []) {
  const spoken: string[] = [];
  const synth = {
    speak: vi.fn((u: { text: string }) => spoken.push(u.text)),
    cancel: vi.fn(),
    resume: vi.fn(),
    getVoices: () => voices as SpeechSynthesisVoice[],
    addEventListener: vi.fn(),
  };
  vi.stubGlobal("speechSynthesis", synth);
  vi.stubGlobal(
    "SpeechSynthesisUtterance",
    class {
      text: string;
      voice: unknown;
      lang = "";
      rate = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(t: string) {
        this.text = t;
      }
    },
  );
  return { synth, spoken };
}

async function freshModule() {
  vi.resetModules();
  return import("./speech");
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("chunkText", () => {
  it("splits on sentences and keeps each piece short", async () => {
    const { chunkText } = await freshModule();
    const text =
      "Namaste! Thanks for calling AutoCare Service Center. I'm the AI assistant, and this call may be recorded. How can I help you today?";
    const chunks = chunkText(text);
    expect(chunks).toEqual([
      "Namaste!",
      "Thanks for calling AutoCare Service Center.",
      "I'm the AI assistant, and this call may be recorded.",
      "How can I help you today?",
    ]);
    const long = chunkText(`${"word ".repeat(80)}end.`, 160);
    expect(long.every((c) => c.length <= 160)).toBe(true);
    expect(long.join(" ").split(" ").length).toBe(81);
  });
});

describe("pickVoice", () => {
  it("prefers an installed Indian English voice over an online one", async () => {
    const { pickVoice } = await freshModule();
    const list = [
      { lang: "en-IN", name: "Google English India", localService: false },
      { lang: "en-IN", name: "Microsoft Heera", localService: true },
      { lang: "hi-IN", name: "Microsoft Kalpana", localService: true },
    ] as SpeechSynthesisVoice[];
    expect(pickVoice("en", list)?.name).toBe("Microsoft Heera");
    expect(pickVoice("hi", list)?.name).toBe("Microsoft Kalpana");
    expect(pickVoice("en", [])).toBeUndefined();
  });
});

describe("speak", () => {
  it("still finishes when the browser never reports the end of speech (the Windows Chrome bug)", async () => {
    vi.useFakeTimers();
    const { spoken } = brokenSynthesis([{ lang: "en-IN", name: "x", localService: true }]);
    const { speak } = await freshModule();
    let finished = false;
    const p = speak("Namaste! Thanks for calling. How can I help you today?", "en", false).then(() => {
      finished = true;
    });
    await vi.advanceTimersByTimeAsync(20000);
    await p;
    expect(finished).toBe(true);
    expect(spoken).toEqual(["Namaste!", "Thanks for calling.", "How can I help you today?"]);
  });

  it("stops immediately when interrupted", async () => {
    vi.useFakeTimers();
    const { spoken } = brokenSynthesis([{ lang: "en-IN", name: "x", localService: true }]);
    const { speak, stopSpeaking } = await freshModule();
    const p = speak("One. Two. Three. Four.", "en", false);
    await vi.advanceTimersByTimeAsync(10);
    stopSpeaking();
    await vi.advanceTimersByTimeAsync(5000);
    await p;
    expect(spoken.length).toBe(1);
  });

  it("does nothing when muted", async () => {
    const { synth } = brokenSynthesis();
    const { speak } = await freshModule();
    await speak("Hello", "en", true);
    expect(synth.speak).not.toHaveBeenCalled();
  });
});
