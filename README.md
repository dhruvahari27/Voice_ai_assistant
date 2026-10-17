<h1 align="center">
  <br/>
  🎙️ VoiceOps AI
  <br/>
</h1>

<h4 align="center">An AI-powered voice receptionist for small businesses in India.<br/>Books appointments, speaks Hinglish, never double-books.</h4>

<br/>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-22+-339933?style=for-the-badge&logo=node.js&logoColor=white" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" />
  <img src="https://img.shields.io/badge/Python-3.12-3776AB?style=for-the-badge&logo=python&logoColor=white" />
  <img src="https://img.shields.io/badge/Tests-173%20passing-brightgreen?style=for-the-badge" />
</p>

<p align="center">
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-what-it-does">Features</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-api">API</a> •
  <a href="#%EF%B8%8F-tech-stack">Tech Stack</a>
</p>

---

## ✨ What it does

| | |
|---|---|
| **Speaks your language** | Handles English, Hindi, and Hinglish. Understands *"kal shaam saade chhe baje"*, *"parso"*, *"doosra wala"*. |
| **Books safely** | Checks real availability, holds the slot while the caller confirms, reads it back, and only books on a clear "yes". Database constraints make double-bookings impossible. |
| **Changes & cancels** | Finds the caller's booking by phone number, applies your notice rules, moves or cancels it. |
| **Answers questions honestly** | Only from your FAQ list. If it doesn't know, it says so and logs the gap so you can fill it. |
| **Recovers lost customers** | Full slot? Offers alternatives, then a waitlist. When a cancellation comes in, the first "YES" reply on WhatsApp gets it. |
| **Hands off to people** | Complaints and *"let me talk to someone"* land in your inbox with a summary + WhatsApp alert. |
| **Sends reminders** | WhatsApp confirmation, 24h reminder, 2h reminder, evening summary for the owner. |
| **Shows what's happening** | Why people call, which times you're turning them away, questions you can't answer, and an estimate of business you could still win back. |

---

## 🚀 Quick Start

**Runs on your laptop in two commands. No Docker. No database to install. No API keys required.**

### Prerequisites
- [Node.js 22+](https://nodejs.org)
- pnpm: `npm install -g pnpm`

### Run

```bash
cd voiceops
pnpm install
pnpm dev
```

Open **http://localhost:5173** → click **Try the demo** (`owner@autocare.example` / `demo1234`)

> The first start creates a local embedded database, seeds a demo business (AutoCare Service Center) and generates 4 weeks of sample call history so the dashboard isn't empty.

### Optional: Enable the AI model

Without an API key, the built-in rules engine handles every call. To switch to LLM mode, create `voiceops/.env`:

```env
# Groq (free tier)
LLM_API_KEY=your_key_here
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=llama-3.3-70b-versatile

# or Gemini
# LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
# LLM_MODEL=gemini-2.0-flash
```

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | API (port 4000) + dashboard (port 5173) with live reload |
| `pnpm test` | All 173 tests: NLU, booking engine, receptionist conversations, API |
| `pnpm eval` | 33 scripted caller scenarios scored against database state |
| `pnpm build` + `pnpm start` | Production build; single process on port 4000 |
| `pnpm db:reset` | Wipe local DB; next start creates a fresh one |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    voiceops/                             │
│                                                         │
│   apps/web       React + Vite + Tailwind dashboard      │
│                  Talk page (voice/text in browser)      │
│                                                         │
│   apps/api       Node.js + Express + Drizzle            │
│                  Receptionist · Booking · Jobs · API    │
│                                                         │
│   apps/agent     Python + LiveKit                       │
│                  Real phone calls (optional, Phase 2)   │
│                                                         │
│   packages/shared  Zod schemas shared by web + API      │
└─────────────────────────────────────────────────────────┘
```

**One rule the entire design follows:** the AI talks; the backend decides.

The receptionist (rules engine or LLM) can only act through 12 tools. Every booking goes through the same pipeline: validation → idempotency → business rules → confirmation gate → database constraint that rejects overlaps.

---

## 📡 API

### Public (no auth)
| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | `{ ok, db, version, time }` |
| `GET` | `/api/v1/public/:slug` | Business info, hours, services |
| `POST` | `/api/v1/public/:slug/calls` | Start a receptionist conversation |
| `POST` | `/api/v1/public/:slug/calls/:id/turns` | Send a message, get a reply |
| `POST` | `/api/v1/public/:slug/calls/:id/end` | End the call |

### Dashboard (session cookie)
| Method | Path | Description |
|---|---|---|
| `POST` | `/api/v1/auth/login` | Sign in |
| `GET` | `/api/v1/overview` | Today's appointments, calls, insights |
| `GET` | `/api/v1/calls` | Call history |
| `GET` | `/api/v1/appointments` | Appointment list |
| `GET` | `/api/v1/insights` | Analytics (intent breakdown, peak hours, gaps) |
| `GET` | `/api/v1/knowledge` | FAQ items + unanswered gaps |
| `GET` | `/api/v1/messages` | WhatsApp message log |

All errors: `{ "error": { "code", "message" }, "requestId" }`.

---

## 🛠️ Tech Stack

| Layer | Tech |
|---|---|
| **Frontend** | React 18, Vite, Tailwind CSS |
| **Backend** | Node.js 22, Express, TypeScript |
| **Database** | PGlite (embedded Postgres, no install) or external Postgres |
| **ORM** | Drizzle ORM |
| **NLU** | Custom rules engine (Hinglish date/time, intent, entities) |
| **LLM** | Any OpenAI-compatible API (Groq, Gemini, OpenAI — optional) |
| **Voice agent** | Python + LiveKit (real phone calls, optional) |
| **WhatsApp** | Meta Cloud API (optional) |
| **Testing** | Vitest — 173 tests |

---

## 🧪 Quality

- **173 tests** run against an in-memory Postgres: Hinglish date parsing, availability, 20 simultaneous callers racing for one slot, idempotent retries, full scripted calls, WhatsApp waitlist loop, tenant isolation.
- **33 evaluation scenarios** (`pnpm eval`) covering bookings, Hinglish, full slots, changes, FAQs, handoffs and garbled input.

---

## 📁 Project Structure

```
.
├── voiceops/               ← Self-contained working app (start here)
│   ├── apps/
│   │   ├── api/            ← Express API + receptionist + booking engine
│   │   ├── web/            ← React dashboard + talk page
│   │   └── agent/          ← Python LiveKit phone agent
│   ├── packages/shared/    ← Shared Zod schemas
│   └── docs/               ← Architecture decisions, going-live guide
├── apps/                   ← Phase 0 foundation (reference)
└── infra/                  ← Docker compose (Postgres + Redis)
```

---

## 🔧 Troubleshooting

| Problem | Fix |
|---|---|
| `pnpm` not found | `npm install -g pnpm`, then reopen terminal |
| Port 4000 or 5173 in use | Set `API_PORT` in `.env` |
| Microphone not working | Use Chrome/Edge at `http://localhost:5173`, allow mic when prompted |
| Receptionist voice cuts off | Install Windows "English (India)" speech pack in Settings |
| Start completely fresh | `pnpm db:reset` then `pnpm dev` |

---

<p align="center">Built with ❤️ for small businesses in India</p>
