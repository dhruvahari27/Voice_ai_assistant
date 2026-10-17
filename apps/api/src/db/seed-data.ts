/**
 * Demo business used for development, tests and the public demo.
 * Prices are in paise. Hours are local Asia/Kolkata time.
 */
export const AUTOCARE = {
  slug: "autocare",
  name: "AutoCare Service Center",
  city: "Bengaluru",
  phone: "+918000000000",
  timezone: "Asia/Kolkata",
  // Mon–Sat 09:00–20:00, Sunday closed
  hours: [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, opensAt: "09:00", closesAt: "20:00" })),
  resources: [
    { name: "Bay 1", kind: "bay" as const },
    { name: "Bay 2", kind: "bay" as const },
  ],
  services: [
    { name: "Oil Change", aliases: ["oil", "engine oil", "oil badalna"], durationMin: 30, bufferMin: 10, pricePaise: 149900 },
    { name: "Car Wash", aliases: ["wash", "dhulai", "car dhona"], durationMin: 45, bufferMin: 15, pricePaise: 49900 },
    { name: "Premium Detailing", aliases: ["detailing", "polish", "car detailing"], durationMin: 120, bufferMin: 15, pricePaise: 349900 },
    { name: "AC Service", aliases: ["ac", "air conditioning", "ac gas"], durationMin: 60, bufferMin: 10, pricePaise: 199900 },
    { name: "General Service", aliases: ["service", "full service", "servicing"], durationMin: 180, bufferMin: 15, pricePaise: 449900 },
  ].map((s) => ({ ...s, resourceKind: "bay" as const })),
  policy: {
    minLeadMinutes: 60,
    maxHorizonDays: 30,
    cancelWindowHours: 2,
    maxBookingsPerCustomerPerDay: 2,
    requireConfirmation: true,
  },
  owner: { name: "Demo Owner", role: "owner" as const, email: "owner@autocare.example" },
};
