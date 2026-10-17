import { NavLink, Route, Routes } from "react-router-dom";
import { OverviewPage } from "./features/overview/OverviewPage";

/** Business shown in the dashboard. Phase 4 replaces this with the signed-in user's business. */
export const DEMO_BUSINESS_SLUG = "autocare";

const NAV = [
  { to: "/", label: "Overview", ready: true },
  { to: "/calls", label: "Calls", ready: false },
  { to: "/appointments", label: "Appointments", ready: false },
  { to: "/callbacks", label: "Callbacks", ready: false },
  { to: "/knowledge", label: "Knowledge", ready: false },
  { to: "/settings", label: "Settings", ready: false },
];

export function App() {
  return (
    <div className="min-h-screen md:grid md:grid-cols-[220px_1fr]">
      <aside className="border-b border-line bg-surface md:min-h-screen md:border-r md:border-b-0">
        <div className="px-5 py-5 text-lg font-semibold tracking-tight">
          Voice<span className="text-brand">Ops</span>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:pb-0">
          {NAV.map((item) =>
            item.ready ? (
              <NavLink
                key={item.to}
                to={item.to}
                end
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm whitespace-nowrap ${
                    isActive ? "bg-brand/10 font-medium text-brand" : "text-ink hover:bg-canvas"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ) : (
              <span
                key={item.to}
                title="Arrives in a later phase"
                className="cursor-not-allowed rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted/70"
              >
                {item.label}
              </span>
            ),
          )}
        </nav>
      </aside>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 md:px-8 md:py-8">
        <Routes>
          <Route path="/" element={<OverviewPage slug={DEMO_BUSINESS_SLUG} />} />
          <Route path="*" element={<p className="text-muted">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
