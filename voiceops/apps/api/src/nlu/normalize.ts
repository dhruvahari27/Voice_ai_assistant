/**
 * Text normalisation for English, Hinglish (Latin script) and Hindi (Devanagari).
 * Browser speech recognition in hi-IN returns Devanagari, so common words are mapped to
 * their Latin spellings and everything downstream only deals with one script.
 */

const DEVANAGARI_DIGITS: Record<string, string> = {
  "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9",
};

/** Longest phrases first so multi-word entries win. */
const DEVANAGARI_WORDS: [string, string][] = (
  [
    ["परसों", "parso"], ["आज", "aaj"], ["कल", "kal"], ["अभी", "abhi"],
    ["सुबह", "subah"], ["दोपहर", "dopahar"], ["शाम", "shaam"], ["रात", "raat"],
    ["बजे", "baje"], ["बज", "baj"], ["साढ़े", "saade"], ["साढे", "saade"], ["सवा", "sava"], ["पौने", "paune"],
    ["डेढ़", "dedh"], ["डेढ", "dedh"], ["ढाई", "dhai"],
    ["एक", "ek"], ["दो", "do"], ["तीन", "teen"], ["चार", "char"], ["पांच", "paanch"], ["पाँच", "paanch"],
    ["छह", "chhe"], ["छः", "chhe"], ["छे", "chhe"], ["सात", "saat"], ["आठ", "aath"], ["नौ", "nau"], ["दस", "das"],
    ["ग्यारह", "gyarah"], ["बारह", "barah"],
    ["हाँ", "haan"], ["हां", "haan"], ["हा", "haan"], ["जी", "ji"], ["ठीक", "theek"], ["बिल्कुल", "bilkul"],
    ["नहीं", "nahi"], ["नही", "nahi"], ["मत", "mat"],
    ["है", "hai"], ["हैं", "hai"], ["हूँ", "hoon"], ["हूं", "hoon"], ["मेरा", "mera"], ["मेरी", "meri"], ["नाम", "naam"],
    ["चाहिए", "chahiye"], ["करना", "karna"], ["करनी", "karni"], ["करो", "karo"], ["कर", "kar"], ["दीजिए", "dijiye"],
    ["बुकिंग", "booking"], ["बुक", "book"], ["कैंसल", "cancel"], ["रद्द", "radd"], ["बदलना", "badalna"], ["बदल", "badal"],
    ["अपॉइंटमेंट", "appointment"], ["स्लॉट", "slot"], ["सर्विस", "service"], ["गाड़ी", "gaadi"], ["गाडी", "gaadi"],
    ["धुलाई", "dhulai"], ["कितना", "kitna"], ["कितने", "kitne"], ["पैसे", "paise"], ["रेट", "rate"], ["कीमत", "keemat"],
    ["सोमवार", "somvar"], ["मंगलवार", "mangalvar"], ["बुधवार", "budhvar"], ["गुरुवार", "guruvar"],
    ["शुक्रवार", "shukravar"], ["शनिवार", "shanivar"], ["रविवार", "ravivar"], ["इतवार", "itvaar"], ["अगले", "agle"],
    ["शिकायत", "shikayat"], ["धन्यवाद", "dhanyavaad"], ["शुक्रिया", "shukriya"], ["बात", "baat"], ["इंसान", "insaan"],
    ["किसी", "kisi"], ["से", "se"], ["कॉल", "call"], ["वापस", "vapas"], ["समय", "samay"], ["टाइम", "time"],
    ["खुला", "khula"], ["बंद", "band"], ["पता", "pata"], ["कहाँ", "kahan"], ["कहां", "kahan"], ["क्या", "kya"],
    ["वाला", "wala"], ["वाली", "wali"], ["पहला", "pehla"], ["दूसरा", "doosra"], ["तीसरा", "teesra"],
  ] as [string, string][]
).sort((a, b) => b[0].length - a[0].length);

const DEVANAGARI_RE = /[ऀ-ॿ]/;

/** Hindi/Hinglish marker words used to mirror the caller's language. */
export const HINDI_MARKERS = new Set([
  "hai", "hain", "haan", "han", "nahi", "nahin", "kal", "aaj", "parso", "parson", "shaam", "sham", "subah",
  "dopahar", "raat", "baje", "saade", "sade", "sava", "paune", "chahiye", "karna", "karni", "karo", "kar",
  "dijiye", "mera", "meri", "mujhe", "naam", "kitna", "kitne", "kya", "kab", "kahan", "gaadi", "gadi", "dhulai",
  "bhai", "bhaiya", "theek", "thik", "chalega", "bilkul", "ji", "hoon", "hu", "aap", "aapka", "aapke", "wala",
  "wali", "agle", "badalna", "badal", "radd", "shikayat", "baat", "vapas", "wapas", "samay", "khula", "band",
  "pata", "matlab", "accha", "acha", "achha", "dhanyavaad", "shukriya", "pehla", "doosra", "teesra", "tarikh",
  "tareekh", "abhi", "batao", "bataiye", "sakte", "sakta", "hoga", "rahega", "milega", "keemat", "paise",
]);

export interface Normalized {
  /** Lower-case, Latin script, single spaces. */
  text: string;
  tokens: string[];
  hasDevanagari: boolean;
  hindiScore: number;
}

export function normalize(input: string): Normalized {
  let s = input.normalize("NFC");
  const hasDevanagari = DEVANAGARI_RE.test(s);
  if (hasDevanagari) {
    s = s.replace(/[०-९]/g, (d) => DEVANAGARI_DIGITS[d] ?? d);
    for (const [dev, lat] of DEVANAGARI_WORDS) s = s.split(dev).join(` ${lat} `);
    s = s.replace(/[ऀ-ॿ]+/g, " ");
  }
  s = s
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/₹\s*/g, "rs ")
    .replace(/[^a-z0-9:.'/+\-\s]/g, " ")
    .replace(/(\d)\.(\d{2})\b/g, "$1:$2") // 6.30 → 6:30
    .replace(/\.(?!\d)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = s.split(" ").filter(Boolean);
  const hindiScore = tokens.filter((t) => HINDI_MARKERS.has(t)).length + (hasDevanagari ? 2 : 0);
  return { text: s, tokens, hasDevanagari, hindiScore };
}

/** Classic edit distance, used for typo-tolerant service matching. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]!;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j]!;
      prev[j] = Math.min(prev[j]! + 1, prev[j - 1]! + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length]!;
}

/** True if `phrase` occurs in `text` on word boundaries. */
export function hasPhrase(text: string, phrase: string): boolean {
  return new RegExp(`(^|\\s)${escapeRe(phrase)}(?=$|\\s|[.,!?])`).test(text);
}

export function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
