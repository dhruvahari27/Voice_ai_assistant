import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import type { Callback, Handoff, Me, Overview } from "../lib/types";
import { Logo, VoiceBars } from "./ui";
import { WelcomeGuide, useWelcomeGuide } from "./WelcomeGuide";

const icons: Record<string, ReactNode> = {
  overview: <path d="M3 10.5 10 4l7 6.5V17a1 1 0 0 1-1 1h-4v-5H8v5H4a1 1 0 0 1-1-1z" />,
  talk: <path d="M10 3a2.5 2.5 0 0 1 2.5 2.5v4a2.5 2.5 0 0 1-5 0v-4A2.5 2.5 0 0 1 10 3zM5 9.5a5 5 0 0 0 10 0M10 14.5V17" />,
  calls: <path d="M5.5 3h2l1.2 3.4-1.6 1.2a8 8 0 0 0 5.3 5.3l1.2-1.6L17 12.5v2a1.5 1.5 0 0 1-1.6 1.5A13 13 0 0 1 4 4.6 1.5 1.5 0 0 1 5.5 3z" />,
  appointments: <path d="M4 5.5h12v11H4zM4 8.5h12M7 3.5v3M13 3.5v3" />,
  inbox: <path d="M3.5 11h4l1 2h3l1-2h4M3.5 11 5.5 4.5h9l2 6.5V16h-13z" />,
  messages: <path d="M4 4.5h12v8.5H9l-3.5 3v-3H4z" />,
  knowledge: <path d="M5 3.5h8.5L15 5v11.5H5zM8 7.5h4.5M8 10.5h4.5M8 13.5h3" />,
  insights: <path d="M4 16V9M8.5 16V5M13 16v-5M17 16H3" />,
  settings: <path d="M10 7.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6zM10 2.5v2M10 15.5v2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M2.5 10h2M15.5 10h2M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" />,
  team: <path d="M7.5 9a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM2.5 16a5 5 0 0 1 10 0M13 4.3a2.5 2.5 0 0 1 0 4.4M14.5 11.3A5 5 0 0 1 17.5 16" />,
  account: <path d="M10 9.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 17a6 6 0 0 1 12 0" />,
  help: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM7.8 7.8a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 1.9-2.2 3.3M10 14.2v.1" />,
  about: <path d="M10 17.5a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15zM10 9v5M10 6.2v.1" />,
  logout: <path d="M8 4H4.5v12H8M12.5 6.5 16 10l-3.5 3.5M16 10H8" />,
};

export function Icon({ name, className = "size-[18px]" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" aria-hidden>
      {icons[name]}
    </svg>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: string;
  count?: number;
  hint: string;
}

export function Layout({ me }: { me: Me }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const guide = useWelcomeGuide(me);
  useEffect(() => setMenuOpen(false), [location.pathname]);

  // Things that need a person: callbacks and handoffs (Follow-ups), web booking requests (Today).
  const counts = useQuery({
    queryKey: ["counts"],
    queryFn: async () => {
      const [cb, ho] = await Promise.all([api.get<{ callbacks: Callback[] }>("/api/v1/callbacks"), api.get<{ handoffs: Handoff[] }>("/api/v1/handoffs")]);
      return { inbox: cb.callbacks.length + ho.handoffs.length };
    },
    refetchInterval: 60000,
  });
  const overview = useQuery({ queryKey: ["overview"], queryFn: () => api.get<Overview>("/api/v1/overview"), refetchInterval: 60000 });

  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: "Front desk",
      items: [
        { to: "/", label: "Today", icon: "overview", hint: "What's happening now", count: overview.data?.today.pendingRequests.length },
        { to: "/talk", label: "Talk to receptionist", icon: "talk", hint: "Try a call yourself" },
        { to: "/calls", label: "Calls", icon: "calls", hint: "Every conversation" },
        { to: "/appointments", label: "Appointments", icon: "appointments", hint: "The day's calendar" },
        { to: "/inbox", label: "Follow-ups", icon: "inbox", count: counts.data?.inbox, hint: "Callbacks and handoffs" },
      ],
    },
    {
      label: "Improve",
      items: [
        { to: "/knowledge", label: "Knowledge", icon: "knowledge", hint: "Answers it gives" },
        { to: "/insights", label: "Insights", icon: "insights", hint: "Trends and lost leads" },
        { to: "/messages", label: "Messages", icon: "messages", hint: "WhatsApp sent" },
      ],
    },
    {
      label: "Business",
      items: [
        { to: "/settings", label: "Settings", icon: "settings", hint: me.user.role === "owner" ? "Hours, services, rules" : "View setup" },
        { to: "/team", label: "Team", icon: "team", hint: "Who can sign in" },
        { to: "/account", label: "Your account", icon: "account", hint: "Password and profile" },
      ],
    },
  ];

  async function signOut() {
    await api.post("/api/v1/auth/logout");
    qc.clear();
    navigate("/login");
  }

  const nav = (
    <nav className="flex flex-col gap-5 px-3" aria-label="Main">
      {groups.map((g) => (
        <div key={g.label}>
          <p className="px-3 pb-1.5 text-xs font-medium text-night-muted/80">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  title={item.hint}
                  className={({ isActive }) =>
                    `group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] transition-colors ${
                      isActive ? "bg-night-raised font-medium text-white" : "text-night-muted hover:bg-night-raised/60 hover:text-night-ink"
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-marigold" aria-hidden />}
                      <Icon name={item.icon} />
                      <span className="flex-1">{item.label}</span>
                      {!!item.count && (
                        <span className="min-w-5 rounded-full bg-marigold px-1.5 text-center text-xs leading-5 font-semibold text-[#2a1d02]" aria-label={`${item.count} need you`}>
                          {item.count}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="mt-auto space-y-3 px-3 pt-6 pb-4">
      <div className="flex gap-1">
        <NavLink to="/help" className={({ isActive }) => `flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${isActive ? "bg-night-raised text-white" : "text-night-muted hover:bg-night-raised/60 hover:text-night-ink"}`}>
          <Icon name="help" className="size-4" /> Help
        </NavLink>
        <NavLink to="/about" className={({ isActive }) => `flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-[13px] ${isActive ? "bg-night-raised text-white" : "text-night-muted hover:bg-night-raised/60 hover:text-night-ink"}`}>
          <Icon name="about" className="size-4" /> About
        </NavLink>
      </div>
      <div className="flex items-center gap-3 rounded-xl border border-night-line px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-night-raised font-display text-sm font-semibold text-night-ink" aria-hidden>
          {initials(me.user.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-night-ink">{me.user.name}</div>
          <div className="text-xs text-night-muted">{me.user.role === "owner" ? "Owner" : "Staff"}</div>
        </div>
        <button onClick={signOut} className="rounded-md p-1.5 text-night-muted hover:bg-night-raised hover:text-white" aria-label="Sign out" title="Sign out">
          <Icon name="logout" className="size-4" />
        </button>
      </div>
    </div>
  );

  const brand = (
    <div className="px-6 pt-6 pb-5">
      <div className="flex items-center gap-2.5">
        <Logo className="size-8" />
        <span className="font-display text-[19px] font-bold tracking-tight text-white">VoiceOps</span>
      </div>
      <div className="mt-5 rounded-xl bg-night-raised px-3.5 py-3">
        <div className="truncate text-[13px] font-medium text-night-ink">{me.business.name}</div>
        <div className="mt-1 flex items-center gap-2 text-xs text-night-muted">
          <VoiceBars className="h-3" />
          Receptionist on duty
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      <aside className="night-texture sticky top-0 hidden h-screen flex-col overflow-y-auto lg:flex">
        {brand}
        {nav}
        {footer}
      </aside>

      <header className="night-texture sticky top-0 z-30 flex items-center justify-between px-4 py-3 lg:hidden">
        <div className="flex items-center gap-2">
          <Logo className="size-7" />
          <span className="font-display text-lg font-bold text-white">VoiceOps</span>
        </div>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          className="rounded-lg border border-night-line px-3 py-1.5 text-sm text-night-ink"
        >
          {menuOpen ? "Close" : `Menu${counts.data?.inbox ? ` (${counts.data.inbox})` : ""}`}
        </button>
      </header>
      {menuOpen && (
        <div id="mobile-menu" className="night-texture fixed inset-x-0 top-[56px] bottom-0 z-30 flex flex-col overflow-y-auto pt-3 lg:hidden">
          {nav}
          {footer}
        </div>
      )}

      <main className="mx-auto w-full max-w-[1200px] px-4 py-7 sm:px-6 lg:px-10 lg:py-10">
        {me.isDemoAccount && <DemoBanner onTour={guide.show} />}
        <Outlet context={{ openGuide: guide.show }} />
      </main>
      <WelcomeGuide me={me} open={guide.open} onClose={guide.close} />
    </div>
  );
}

function DemoBanner({ onTour }: { onTour: () => void }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-panel px-4 py-2.5 text-sm shadow-[var(--shadow-panel)]">
      <span className="rounded-full bg-marigold-soft px-2 py-0.5 text-xs font-semibold text-marigold-ink">Demo</span>
      <span className="min-w-[12rem] flex-1 text-ink-soft">You're exploring AutoCare, a sample car service centre. Nothing here reaches real customers.</span>
      <button onClick={onTour} className="font-medium text-info underline-offset-2 hover:underline">
        Show me around
      </button>
    </div>
  );
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}
