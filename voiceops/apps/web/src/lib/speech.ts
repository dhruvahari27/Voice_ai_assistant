/**
 * Browser speech: recognition (Chrome/Edge Web Speech API) and synthesis (speechSynthesis).
 * No API keys. Chrome's recognition sends audio to Google's service; production phone calls
 * use the Python LiveKit agent with Deepgram/Sarvam instead.
 *
 * Chrome on Windows has well-known synthesis bugs this file works around:
 *  - long utterances with online voices stop after ~15 s and never fire `onend`;
 *  - an utterance object that gets garbage-collected never fires `onend`;
 *  - `getVoices()` is empty until `voiceschanged` fires.
 * So we speak sentence by sentence, keep references, prefer installed (local) voices,
 * and never wait on `onend` alone: every chunk has a time limit.
 */

type RecognitionResult = ArrayLike<{ transcript: string }> & { isFinal: boolean };
type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<RecognitionResult> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

function ctor(): (new () => Recognition) | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechSupported = Boolean(ctor());
export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

export interface ListenHandlers {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  /** heardNothing = the mic closed without any words (silence, or no permission). */
  onEnd: (heardNothing: boolean) => void;
}

const RECOGNITION_ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked. Click the lock or camera icon in the address bar, allow the microphone, then try again. You can also type.",
  "service-not-allowed": "This browser won't let the page use speech recognition. Use Chrome or Edge, or type instead.",
  "audio-capture": "No microphone found. Plug one in, or type instead.",
  network: "Speech recognition needs an internet connection (Chrome sends audio to Google to turn it into text). You can type instead.",
  "language-not-supported": "Speech recognition doesn't support that language here. Switch to English / Hinglish.",
  "no-speech": "",
  aborted: "",
};

let active: Recognition | null = null;

/** Listen for one utterance. Returns a stop function. Only one listener runs at a time. */
export function listen(lang: string, h: ListenHandlers): () => void {
  const C = ctor();
  if (!C) {
    h.onError("Voice input needs Chrome or Edge. You can type instead.");
    h.onEnd(true);
    return () => undefined;
  }
  if (active) {
    try {
      active.abort();
    } catch {
      /* already stopped */
    }
    active = null;
  }
  const rec = new C();
  rec.lang = lang;
  rec.interimResults = true;
  rec.continuous = false;
  rec.maxAlternatives = 1;
  let finalText = "";
  let latest = "";
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (active === rec) active = null;
    // Some Chrome builds end without marking the last result final; use what we heard.
    const text = (finalText || latest).trim();
    if (text) h.onFinal(text);
    h.onEnd(!text);
  };
  rec.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i]!;
      if (r.isFinal) finalText += r[0]!.transcript;
      else interim += r[0]!.transcript;
    }
    latest = (finalText + interim).trim();
    h.onInterim(latest);
  };
  rec.onerror = (e) => {
    const msg = RECOGNITION_ERRORS[e.error] ?? `Speech recognition stopped (${e.error}). You can type instead.`;
    if (msg) h.onError(msg);
  };
  rec.onend = finish;
  try {
    rec.start();
    active = rec;
  } catch {
    h.onError("Couldn't start the microphone. Try again, or type instead.");
    finish();
  }
  return () => {
    try {
      rec.stop();
    } catch {
      finish();
    }
  };
}

// ---------------------------------------------------------------- synthesis

let voices: SpeechSynthesisVoice[] = [];
function loadVoices() {
  try {
    voices = window.speechSynthesis.getVoices();
  } catch {
    voices = [];
  }
}
if (ttsSupported) {
  loadVoices();
  window.speechSynthesis.addEventListener?.("voiceschanged", loadVoices);
}

async function voicesReady(): Promise<void> {
  if (!ttsSupported || voices.length) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 800);
    window.speechSynthesis.addEventListener?.(
      "voiceschanged",
      () => {
        clearTimeout(t);
        loadVoices();
        resolve();
      },
      { once: true },
    );
  });
}

/** Installed voices (e.g. "Microsoft Heera - English (India)") don't have Chrome's 15-second cut-off. */
export function pickVoice(lang: "en" | "hi", list: SpeechSynthesisVoice[] = voices): SpeechSynthesisVoice | undefined {
  const prefs = lang === "hi" ? ["hi-IN", "en-IN"] : ["en-IN", "en-GB", "en-US"];
  for (const p of prefs) {
    const matching = list.filter((v) => v.lang.replace("_", "-").toLowerCase() === p.toLowerCase());
    const pick = matching.find((v) => v.localService) ?? matching[0];
    if (pick) return pick;
  }
  return list.find((v) => v.lang.toLowerCase().startsWith("en") && v.localService) ?? list.find((v) => v.lang.toLowerCase().startsWith("en"));
}

/** Split into sentence-sized pieces, short enough that no browser cuts them off. */
export function chunkText(text: string, max = 160): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const out: string[] = [];
  for (const s of sentences) {
    const piece = s.trim();
    if (!piece) continue;
    if (piece.length <= max) {
      out.push(piece);
      continue;
    }
    // Very long sentence: break on commas, then on spaces.
    let buf = "";
    for (const part of piece.split(/(?<=,)\s+|\s+/)) {
      if ((buf + " " + part).trim().length > max && buf) {
        out.push(buf.trim());
        buf = part;
      } else buf = `${buf} ${part}`;
    }
    if (buf.trim()) out.push(buf.trim());
  }
  return out;
}

/** Longest a chunk could reasonably take to speak (~13 characters a second plus slack). */
export function chunkTimeoutMs(chunk: string): number {
  return 1500 + chunk.length * 80;
}

// Utterances must stay referenced until they finish, or Chrome drops their events.
const live = new Set<SpeechSynthesisUtterance>();
let generation = 0;

function speakChunk(text: string, voice: SpeechSynthesisVoice | undefined, gen: number): Promise<void> {
  return new Promise((resolve) => {
    if (gen !== generation) return resolve();
    const u = new SpeechSynthesisUtterance(text);
    if (voice) {
      u.voice = voice;
      u.lang = voice.lang;
    }
    u.rate = 1.02;
    live.add(u);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      live.delete(u);
      resolve();
    };
    const timer = setTimeout(done, chunkTimeoutMs(text));
    // Don't rely on onend alone: also watch the engine. Once it has started and then goes
    // quiet, the chunk is over. If it never starts within 1.5 s, the voice isn't working.
    const startedAt = Date.now();
    let seenBusy = false;
    const poll = setInterval(() => {
      const synth = window.speechSynthesis;
      const busy = Boolean(synth.speaking || synth.pending);
      if (busy) seenBusy = true;
      if ((seenBusy && !busy) || (!seenBusy && Date.now() - startedAt > 1500)) done();
    }, 200);
    const finish = done;
    u.onend = finish;
    u.onerror = finish;
    try {
      window.speechSynthesis.resume(); // Chrome sometimes leaves the queue paused
      window.speechSynthesis.speak(u);
    } catch {
      done();
    }
  });
}

/**
 * Speak text. Always resolves: when it's finished, when it's interrupted by stopSpeaking(),
 * or after a time limit if the browser never reports the end.
 */
export async function speak(text: string, lang: "en" | "hi", muted: boolean): Promise<void> {
  if (!ttsSupported || muted || !text.trim()) return;
  const gen = ++generation;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
  await voicesReady();
  const voice = pickVoice(lang);
  for (const chunk of chunkText(text)) {
    if (gen !== generation) return;
    await speakChunk(chunk, voice, gen);
  }
}

export function stopSpeaking() {
  generation++;
  if (!ttsSupported) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
