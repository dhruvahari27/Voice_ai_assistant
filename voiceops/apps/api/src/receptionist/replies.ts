/**
 * Everything the receptionist says. Short spoken sentences, one question at a time.
 * Every function returns English or Hinglish depending on the caller's language.
 */
import { formatPaise } from "@voiceops/shared";
import type { Lang } from "./state.js";

type Pick2 = { en: string; hi: string };
const say = (lang: Lang, p: Pick2) => (lang === "hi" ? p.hi : p.en);

/** "₹1,499" reads badly in TTS; "1,499 rupees" is how people say it. */
export function spokenPrice(paise: number): string {
  return `${formatPaise(paise).replace("₹", "")} rupees`;
}

/** "AS-7K3PQ" → "A S 7 K 3 P Q" so TTS reads it letter by letter. */
export function spellRef(ref: string): string {
  return ref.replace("-", "").split("").join(" ");
}

export function listOr(items: string[], lang: Lang): string {
  if (items.length <= 1) return items[0] ?? "";
  const or = lang === "hi" ? "ya" : "or";
  return `${items.slice(0, -1).join(", ")} ${or} ${items.at(-1)}`;
}

function duration(min: number, lang: Lang): string {
  if (min < 60) return lang === "hi" ? `${min} minute` : `${min} minutes`;
  const h = min / 60;
  const hs = Number.isInteger(h) ? String(h) : h.toFixed(1);
  return lang === "hi" ? `${hs} ghante` : `${hs} hour${h === 1 ? "" : "s"}`;
}

export const R = {
  greeting: (lang: Lang, business: string, returning?: { name: string | null; next?: string }) => {
    if (returning?.name) {
      const next = returning.next;
      return say(lang, {
        en: `Namaste ${returning.name}, welcome back to ${business}! I'm the AI assistant, and this call may be recorded.${next ? ` I can see your ${next}.` : ""} How can I help you today?`,
        hi: `Namaste ${returning.name} ji, ${business} mein phir se swagat hai! Main AI assistant hoon, yeh call record ho sakti hai.${next ? ` Aapki ${next} booking dikh rahi hai.` : ""} Bataiye, kaise madad karun?`,
      });
    }
    return say(lang, {
      en: `Namaste! Thanks for calling ${business}. I'm the AI assistant, and this call may be recorded. How can I help you today?`,
      hi: `Namaste! ${business} mein aapka swagat hai. Main AI assistant hoon, yeh call record ho sakti hai. Bataiye, kaise madad karun?`,
    });
  },

  askService: (lang: Lang, names: string[]) =>
    say(lang, {
      en: `Sure. Which service do you need — ${listOr(names, "en")}?`,
      hi: `Zaroor. Kaunsi service chahiye — ${listOr(names, "hi")}?`,
    }),

  askDate: (lang: Lang, service: string) =>
    say(lang, { en: `Which day would you like for the ${service}?`, hi: `${service} ke liye kaunsa din chahiye?` }),

  askTime: (lang: Lang, dateText: string) =>
    say(lang, {
      en: `What time ${dateText}? Morning, afternoon or evening — or tell me a specific time.`,
      hi: `${dateText} kis time? Subah, dopahar ya shaam — ya koi exact time bataiye.`,
    }),

  offerSlots: (lang: Lang, dateText: string, times: string[], unavailable?: string) =>
    unavailable
      ? say(lang, {
          en: `${unavailable} isn't available ${dateText}, but I have ${listOr(times, "en")}. Which works for you?`,
          hi: `${capital(dateText)} ${unavailable} available nahi hai, lekin ${listOr(times, "hi")} khaali hai. Kaunsa time chalega?`,
        })
      : say(lang, {
          en: `${capital(dateText)} I have ${listOr(times, "en")}. Which would you like?`,
          hi: `${capital(dateText)} ${listOr(times, "hi")} available hai. Kaunsa chahiye?`,
        }),

  dayUnavailable: (lang: Lang, dateText: string, closed: boolean, nextText: string, times: string[]) =>
    say(lang, {
      en: `${closed ? `We're closed ${dateText}` : `We're fully booked ${dateText}`}. The next opening is ${nextText}: ${listOr(times, "en")}. Would any of those work?`,
      hi: `${closed ? `${capital(dateText)} hum band hain` : `${capital(dateText)} sab slots full hain`}. Agla available din ${nextText} hai: ${listOr(times, "hi")}. Inmein se koi chalega?`,
    }),

  nothingSoon: (lang: Lang) =>
    say(lang, {
      en: "I'm sorry, I couldn't find any free slot in the next week. Shall I ask our team to call you to fit you in?",
      hi: "Maaf kijiye, agle hafte koi slot khaali nahi hai. Kya team aapko call karke time fix kare?",
    }),

  askName: (lang: Lang, held: boolean) =>
    say(lang, {
      en: `${held ? "Great, I've reserved that slot for you. " : ""}May I have your name?`,
      hi: `${held ? "Theek hai, maine slot hold kar liya hai. " : ""}Aapka naam bataiye?`,
    }),

  askPhone: (lang: Lang, purpose: "confirmation" | "lookup" | "callback") =>
    purpose === "lookup"
      ? say(lang, { en: "Sure. What's the mobile number the booking is under?", hi: "Zaroor. Booking kis mobile number pe hai?" })
      : purpose === "callback"
        ? say(lang, { en: "What's the best mobile number to reach you on?", hi: "Aapko kis mobile number pe call karein?" })
        : say(lang, { en: "And your 10-digit mobile number, for the WhatsApp confirmation?", hi: "Aur WhatsApp confirmation ke liye aapka 10-digit mobile number?" }),

  badPhone: (lang: Lang) =>
    say(lang, {
      en: "Sorry, I didn't get a valid mobile number. Could you say the 10 digits again?",
      hi: "Maaf kijiye, number sahi nahi mila. 10 digit number phir se bataiye?",
    }),

  readBackBooking: (lang: Lang, b: { service: string; when: string; pricePaise: number; name?: string; phone?: string }) =>
    say(lang, {
      en: `Just to confirm: ${b.service} on ${b.when}, ${spokenPrice(b.pricePaise)}${b.name ? `, for ${b.name}` : ""}${b.phone ? ` on ${b.phone}` : ""}. Shall I book it?`,
      hi: `Confirm kar doon: ${b.service}, ${b.when}, ${spokenPrice(b.pricePaise)}${b.name ? `, ${b.name} ji ke naam pe` : ""}. Book kar doon?`,
    }),

  booked: (lang: Lang, b: { when: string; ref: string }) =>
    say(lang, {
      en: `Done! You're booked for ${b.when}. Your reference is ${spellRef(b.ref)}. You'll get a WhatsApp confirmation shortly. Is there anything else I can help with?`,
      hi: `Ho gaya! Aapki booking ${b.when} ke liye confirm hai. Reference number ${spellRef(b.ref)} hai. WhatsApp pe confirmation aa jayega. Aur kuch madad chahiye?`,
    }),

  requested: (lang: Lang, b: { when: string; ref: string }) =>
    say(lang, {
      en: `Done! I've reserved ${b.when} for you and sent it to the team to confirm. Your reference is ${spellRef(b.ref)}. You'll get a WhatsApp message as soon as they confirm. Is there anything else I can help with?`,
      hi: `Ho gaya! ${b.when} ka slot aapke liye reserve kar diya hai aur team ko confirm karne ke liye bhej diya hai. Reference number ${spellRef(b.ref)} hai. Confirm hote hi WhatsApp pe message aa jayega. Aur kuch madad chahiye?`,
    }),

  sayYesOrNo: (lang: Lang) =>
    say(lang, { en: "Sorry — should I go ahead? Please say yes or no.", hi: "Maaf kijiye — aage badhun? Haan ya na bataiye." }),

  whatToChange: (lang: Lang) =>
    say(lang, {
      en: "No problem. Which day and time would you prefer instead?",
      hi: "Koi baat nahi. Kaunsa din aur time better rahega?",
    }),

  slotJustTaken: (lang: Lang, times: string[]) =>
    times.length
      ? say(lang, {
          en: `Sorry, that slot was just taken by someone else. I can still offer ${listOr(times, "en")}. Which works?`,
          hi: `Maaf kijiye, woh slot abhi kisi aur ne le liya. ${listOr(times, "hi")} abhi bhi khaali hai. Kaunsa chalega?`,
        })
      : say(lang, {
          en: "Sorry, that slot was just taken. Which other day would suit you?",
          hi: "Maaf kijiye, woh slot abhi le liya gaya. Koi aur din chalega?",
        }),

  offerWaitlist: (lang: Lang, when: string) =>
    say(lang, {
      en: `I can put you on the waitlist for ${when} — if someone cancels, we'll WhatsApp you first. Should I add you?`,
      hi: `Main aapko ${when} ke waitlist pe daal sakti hoon — agar koi cancel karta hai to aapko WhatsApp pe sabse pehle bataenge. Daal doon?`,
    }),

  waitlisted: (lang: Lang) =>
    say(lang, {
      en: "You're on the waitlist. We'll message you on WhatsApp the moment that slot opens. Anything else?",
      hi: "Aap waitlist pe hain. Slot khaali hote hi WhatsApp pe message aa jayega. Aur kuch?",
    }),

  askOtherDay: (lang: Lang) =>
    say(lang, { en: "Okay. Would another day work for you?", hi: "Theek hai. Koi aur din chalega?" }),

  price: (lang: Lang, s: { name: string; pricePaise: number; durationMin: number }, offerBook: boolean) =>
    say(lang, {
      en: `${s.name} is ${spokenPrice(s.pricePaise)} and takes about ${duration(s.durationMin, "en")}.${offerBook ? " Would you like to book it?" : ""}`,
      hi: `${s.name} ${spokenPrice(s.pricePaise)} ka hai, lagbhag ${duration(s.durationMin, "hi")} lagta hai.${offerBook ? " Book karna chahenge?" : ""}`,
    }),

  priceList: (lang: Lang, items: { name: string; pricePaise: number }[]) => {
    const list = items.map((i) => `${i.name} ${spokenPrice(i.pricePaise)}`).join(", ");
    return say(lang, {
      en: `Our prices: ${list}. Which one are you interested in?`,
      hi: `Hamare rates: ${list}. Aapko kaunsi service chahiye?`,
    });
  },

  services: (lang: Lang, names: string[]) =>
    say(lang, {
      en: `We offer ${listOr(names, "en")}. Would you like to book one?`,
      hi: `Hum ${listOr(names, "hi")} karte hain. Kuch book karna chahenge?`,
    }),

  hours: (lang: Lang, summary: string, now: { open: boolean; closesAt?: string; next?: string }) => {
    const nowText = now.open
      ? say(lang, { en: ` We're open right now until ${now.closesAt}.`, hi: ` Abhi khula hai, ${now.closesAt} tak.` })
      : now.next
        ? say(lang, { en: ` We're closed right now and open again ${now.next}.`, hi: ` Abhi band hai, ${now.next} phir khulega.` })
        : "";
    return say(lang, { en: `Our hours are ${summary}.${nowText}`, hi: `Hamare timings: ${summary}.${nowText}` }) +
      say(lang, { en: " Anything else?", hi: " Aur kuch?" });
  },

  location: (lang: Lang, address: string | null, business: string) =>
    address
      ? say(lang, { en: `We're at ${address}. Anything else?`, hi: `Hamara address hai: ${address}. Aur kuch?` })
      : say(lang, { en: `I don't have the exact address for ${business} right now. Shall our team call you with directions?`, hi: `Mere paas abhi exact address nahi hai. Team aapko call karke bata de?` }),

  answer: (lang: Lang, text: string) => `${text} ${say(lang, { en: "Anything else I can help with?", hi: "Aur kuch madad chahiye?" })}`,

  dontKnow: (lang: Lang) =>
    say(lang, {
      en: "I'm not sure about that, and I don't want to give you wrong information. Shall I ask our team to call you back about it?",
      hi: "Iske baare mein mujhe pakka pata nahi hai, aur main galat jaankari nahi dena chahti. Kya hamari team aapko iske liye call back kare?",
    }),

  askCallbackTime: (lang: Lang) =>
    say(lang, {
      en: "Sure. When is a good time for our team to call you? You can also say 'anytime'.",
      hi: "Zaroor. Team aapko kab call kare? 'Kabhi bhi' bhi bol sakte hain.",
    }),

  callbackCreated: (lang: Lang, when: string) =>
    say(lang, {
      en: `Done — our team will call you back ${when}. You'll get a WhatsApp note too. Anything else?`,
      hi: `Ho gaya — team aapko ${when} call karegi. WhatsApp pe bhi message aa jayega. Aur kuch?`,
    }),

  handoff: (lang: Lang, kind: "complaint" | "human_request" | "low_confidence", phone?: string) => {
    const on = phone ? say(lang, { en: ` on ${phone}`, hi: ` ${phone} pe` }) : "";
    if (kind === "complaint") {
      return say(lang, {
        en: `I'm really sorry to hear that. I've flagged this to our manager as urgent with all the details, and they'll call you back${on} shortly. Is there anything you'd like me to add for them?`,
        hi: `Yeh sunkar bahut afsos hua. Maine manager ko urgent mark karke saari details bhej di hain, woh aapko${on} jaldi call karenge. Kuch aur batana chahenge unke liye?`,
      });
    }
    return say(lang, {
      en: `Of course. I've asked a team member to call you back${on} as soon as possible, with a summary of what we discussed. Anything else meanwhile?`,
      hi: `Bilkul. Maine team ko bol diya hai, woh aapko${on} jaldi call karenge, poori details ke saath. Tab tak kuch aur?`,
    });
  },

  noUpcoming: (lang: Lang, phone: string) =>
    say(lang, {
      en: `I couldn't find an upcoming booking for ${phone}. Would you like to make a new one?`,
      hi: `${phone} pe koi upcoming booking nahi mili. Nayi booking karni hai?`,
    }),

  pickAppointment: (lang: Lang, items: string[]) =>
    say(lang, {
      en: `I see ${items.length} bookings: ${items.map((s, i) => `${i + 1}, ${s}`).join("; ")}. Which one?`,
      hi: `${items.length} bookings dikh rahi hain: ${items.map((s, i) => `${i + 1}, ${s}`).join("; ")}. Kaunsi wali?`,
    }),

  myAppointments: (lang: Lang, items: string[]) =>
    say(lang, {
      en: `You have ${items.length === 1 ? "one booking" : `${items.length} bookings`}: ${items.join("; ")}. Would you like to change anything?`,
      hi: `Aapki ${items.length} booking hai: ${items.join("; ")}. Kuch badalna hai?`,
    }),

  confirmCancel: (lang: Lang, service: string, when: string) =>
    say(lang, {
      en: `You'd like to cancel your ${service} on ${when}, is that right?`,
      hi: `Aapki ${service}, ${when} wali booking cancel kar doon?`,
    }),

  cancelled: (lang: Lang) =>
    say(lang, {
      en: "Your booking is cancelled, and you'll get a WhatsApp confirmation. Anything else I can help with?",
      hi: "Aapki booking cancel ho gayi hai, WhatsApp pe confirmation aa jayega. Aur kuch?",
    }),

  keptBooking: (lang: Lang) =>
    say(lang, { en: "Okay, I've left your booking as it is. Anything else?", hi: "Theek hai, booking waise hi rehne di. Aur kuch?" }),

  askNewTime: (lang: Lang, service: string, when: string) =>
    say(lang, {
      en: `Your ${service} is on ${when}. Which day and time would you like instead?`,
      hi: `Aapki ${service} ${when} ko hai. Naya din aur time kya rakhein?`,
    }),

  confirmReschedule: (lang: Lang, service: string, from: string, to: string) =>
    say(lang, {
      en: `So I'll move your ${service} from ${from} to ${to}. Shall I go ahead?`,
      hi: `Toh aapki ${service} ${from} se ${to} pe shift kar doon?`,
    }),

  rescheduled: (lang: Lang, when: string, ref: string) =>
    say(lang, {
      en: `Done — your booking is now ${when}. Same reference, ${spellRef(ref)}. Anything else?`,
      hi: `Ho gaya — booking ab ${when} ki hai. Reference wahi hai, ${spellRef(ref)}. Aur kuch?`,
    }),

  policyBlocked: (lang: Lang, message: string) =>
    `${message} ${say(lang, { en: "Shall I ask our team to call you?", hi: "Kya team aapko call kare?" })}`,

  notUnderstood: (lang: Lang) =>
    say(lang, {
      en: "Sorry, I didn't catch that. I can book, change or cancel an appointment, or answer questions about our services and prices.",
      hi: "Maaf kijiye, samajh nahi aaya. Main booking kar sakti hoon, badal ya cancel kar sakti hoon, ya services aur rates bata sakti hoon.",
    }),

  stillNotUnderstood: (lang: Lang) =>
    say(lang, {
      en: "I'm having trouble understanding. Would you like someone from our team to call you back?",
      hi: "Mujhe theek se samajh nahi aa raha. Kya hamari team aapko call back kare?",
    }),

  howCanIHelp: (lang: Lang) => say(lang, { en: "Sure — what can I help you with?", hi: "Zaroor — bataiye kya madad karun?" }),

  anythingElse: (lang: Lang) => say(lang, { en: "Is there anything else I can help with?", hi: "Aur kuch madad chahiye?" }),

  goodbye: (lang: Lang, business: string) =>
    say(lang, {
      en: `Thank you for calling ${business}. Have a great day!`,
      hi: `${business} ko call karne ke liye dhanyavaad. Aapka din shubh rahe!`,
    }),

  systemError: (lang: Lang) =>
    say(lang, {
      en: "Sorry, I'm having a technical problem. Shall I ask our team to call you back?",
      hi: "Maaf kijiye, abhi technical problem aa rahi hai. Kya team aapko call back kare?",
    }),

  thereYet: (lang: Lang) => say(lang, { en: "Are you still there?", hi: "Kya aap line pe hain?" }),
};

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
