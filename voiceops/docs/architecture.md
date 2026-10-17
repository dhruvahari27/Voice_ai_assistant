# Architecture

## One sentence

The Python agent (phone) or the browser (web) handles audio; the Node API is the receptionist and the only thing that can change business data; Postgres is the only source of truth.

```
 Phone caller ──► Indian SIP provider ──► LiveKit ──► Python agent (STT/TTS) ─┐
                                                                               ├──► Node API ──► Postgres
 Web caller ───► Browser speech (Talk page) ──────────────────────────────────┘      │   ▲
                                                                                      │   │ jobs (same DB)
 Owner / staff ─► React dashboard ◄── live events (SSE) ──────────────────────────────┘   │
                                                                                           │
                                       WhatsApp / outbox ◄── job worker ───────────────────┘
```

## The receptionist

`apps/api/src/receptionist/`

| File | Job |
| --- | --- |
| `index.ts` | Start / turn / end a call. Stores every turn and its latency. Falls back from the LLM to the rules engine if the model fails. |
| `rules.ts` | Deterministic dialogue manager. Works with no keys. One question at a time, handles side questions mid-booking, repeats on request. |
| `llm.ts` | Optional OpenAI-compatible model with tool calling. Same tools, same checks. |
| `tools.ts` | The 12 actions: business info, FAQ search, availability, hold, book, find, reschedule, cancel, callback, waitlist, handoff, end call. |
| `replies.ts` | Everything it says, in English and Hinglish. |

`apps/api/src/nlu/` turns speech text into intent and entities: dates ("kal", "parso", "shanivar", "18 oct"), times ("saade chhe", "sava 4", "6 baje", "evening"), services (by name, alias or a near-miss spelling), names, Indian mobile numbers (including spoken digits) and yes/no. Devanagari from Hindi speech recognition is mapped to Latin first.

## Booking safety

Every write goes through the same steps (`services/booking.ts`):

1. **Validate** arguments (Zod).
2. **Idempotency**: an action key is claimed in `action_ledger` inside the transaction. A retried request returns the stored result; the same key with different arguments is rejected.
3. **Business rules** (`services/policy.ts`): notice period, how far ahead, opening hours and closures (via availability), per-caller daily limit, change/cancel window.
4. **Confirmation gate**: for the agent, the server reads the caller's latest words from the transcript and requires a clear yes. The model can't confirm on the caller's behalf.
5. **Database constraint**: holds and bookings live in one table with an exclusion constraint, so two live bookings can never overlap on one bay, whatever the code does:

   ```sql
   EXCLUDE USING gist (resource_id WITH =, tstzrange(starts_at, blocked_until, '[)') WITH &&)
   WHERE (status IN ('held', 'pending', 'confirmed'))
   ```

6. **Audit and notify**: audit log row, WhatsApp message and reminder jobs are written in the same transaction (outbox pattern), so a booking can't exist without its confirmation being queued.

Holds are appointment rows with status `held` and an expiry. The constraint therefore protects a slot from the moment the receptionist offers it, not only once it's booked.

## Jobs

No Redis: jobs are rows in Postgres, claimed with `FOR UPDATE SKIP LOCKED` (`services/jobs.ts`), so several API processes can share the work safely. Kinds: deliver message, appointment reminder, waitlist offer, offer expiry, callback SLA escalation, owner daily digest, and a once-a-minute maintenance tick (expire holds, close abandoned calls).

## Waitlist recovery loop

Cancellation → `waitlist_offer` job → find waiting customers whose day and time window cover the freed slot → hold it for 30 minutes → WhatsApp up to three of them → the first "YES" books it through the normal booking pipeline → the others are told it's gone and stay in the queue → if nobody answers, the hold expires and the slot is free again.

## Insights

Computed on request from call outcomes (`services/insights.ts`): intents, outcomes, reasons for lost leads, a weekday × hour heatmap, unmet demand (wanted times that were full), demand by service with period-over-period change, unanswered questions, and the "opportunity radar". The estimated opportunity is the sum of service prices for high-intent calls that didn't book; the formula is shown in the UI because it's an upper bound, not revenue.

## Data

22 tables. Every tenant table has `business_id`, and every dashboard query is scoped to the signed-in user's business. Money is integer paise. Instants are `timestamptz`; opening hours are local "HH:MM" strings interpreted in the business time zone.

Embedded Postgres (PGlite) by default, so it runs anywhere with no install; set `DATABASE_URL` for a real server. The same migrations and tests run on both.

## Tests

- `test/nlu.test.ts`: 100 parsing cases (dates, times, services, intents, phones, names).
- `test/booking.test.ts`: availability, holds, idempotency, the 20-caller race, policies, the confirmation gate, reschedule and cancel.
- `test/receptionist.test.ts`: full scripted calls in English, Hinglish and LLM mode (with a scripted fake model that tries to book without asking).
- `test/api.test.ts`: auth, tenant isolation, public and agent endpoints, the end-to-end waitlist loop, knowledge gaps, settings, insights and the digest.
- `eval/`: 33 scenario callers scored on the database outcome.
