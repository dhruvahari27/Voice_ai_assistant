/**
 * Demo business used for development, tests and the public demo.
 * Prices are in paise. Hours are local Asia/Kolkata time.
 */
export const DEMO_LOGIN = { email: "owner@autocare.example", password: "demo1234" };

export const AUTOCARE = {
  slug: "autocare",
  name: "AutoCare Service Center",
  city: "Bengaluru",
  address: "42, 80 Feet Road, Koramangala 4th Block, Bengaluru 560034",
  phone: "+918000000000",
  ownerPhone: "+919000000001",
  timezone: "Asia/Kolkata",
  // Mon–Sat 09:00–20:00, Sunday closed
  hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "20:00" })),
  resources: [
    { name: "Bay 1", kind: "bay" as const },
    { name: "Bay 2", kind: "bay" as const },
  ],
  services: [
    { name: "Oil Change", aliases: ["oil", "engine oil", "oil badalna", "oil change"], durationMin: 30, bufferMin: 0, pricePaise: 149900 },
    { name: "Car Wash", aliases: ["wash", "dhulai", "car dhona", "washing", "car wash"], durationMin: 45, bufferMin: 15, pricePaise: 49900 },
    { name: "Premium Detailing", aliases: ["detailing", "polish", "car detailing", "detail", "ceramic"], durationMin: 120, bufferMin: 0, pricePaise: 349900 },
    { name: "AC Service", aliases: ["ac", "air conditioning", "ac gas", "ac repair", "a c"], durationMin: 60, bufferMin: 0, pricePaise: 199900 },
    { name: "General Service", aliases: ["service", "full service", "servicing", "general service", "periodic service"], durationMin: 180, bufferMin: 0, pricePaise: 449900 },
  ].map((s) => ({ ...s, resourceKind: "bay" as const })),
  policy: {
    minLeadMinutes: 60,
    maxHorizonDays: 30,
    cancelWindowHours: 2,
    maxBookingsPerCustomerPerDay: 2,
    slotStepMinutes: 30,
    holdSeconds: 300,
    callbackSlaMinutes: 120,
    remindersEnabled: true,
  },
  owner: { name: "Ravi Kumar", role: "owner" as const, ...DEMO_LOGIN, phone: "+919000000001" },
  knowledge: [
    { question: "Do you offer pickup and drop?", answer: "Yes, free pickup and drop within 5 km for General Service and Premium Detailing. For other services it's ₹199 each way.", tags: ["pickup", "drop", "home", "collect", "ghar se", "pick up"] },
    { question: "What payment methods do you accept?", answer: "We accept UPI, all major cards and cash. Payment is taken after the service.", tags: ["payment", "upi", "card", "cash", "pay", "gpay", "paytm"] },
    { question: "How long does a general service take?", answer: "About 3 hours. If you drop the car by 10 AM you'll usually have it back the same evening.", tags: ["how long", "time", "duration", "kitna time", "kitni der"] },
    { question: "Is there a warranty on service?", answer: "Yes, 30 days or 1,000 km warranty on workmanship, whichever comes first.", tags: ["warranty", "guarantee"] },
    { question: "Do you use genuine parts?", answer: "Yes, we use genuine OEM parts or OEM-equivalent parts with a bill. We'll tell you before replacing anything.", tags: ["genuine", "parts", "original", "oem", "spare"] },
    { question: "Can I wait at the center?", answer: "Yes, we have a waiting lounge with Wi-Fi and tea. For services under an hour most customers wait.", tags: ["wait", "lounge", "wifi", "baith"] },
    { question: "Do you service electric vehicles?", answer: "We do washing, detailing and AC service for EVs. For battery and motor work please visit your brand's service center.", tags: ["ev", "electric", "tata nexon ev", "battery"] },
    { question: "Is parking available?", answer: "Yes, there's free customer parking in front of the center.", tags: ["parking", "park"] },
  ],
};
