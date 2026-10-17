# Going live with a real business

The app works end to end on a laptop. Real calls and real WhatsApp messages need accounts that only you can open (KYC and business verification). Do them in this order; each step is useful on its own.

## 1. Pick the pilot business

A clinic, salon or car service centre with appointments, 15+ calls a day and a busy or absent receptionist. Ask the owner: how many calls do you miss a week, and how do you know? Agree in writing: what the AI may book, what always goes to a person, who checks the follow-up inbox, how long data is kept, and that either side can stop the pilot the same day.

Then set them up in **Settings**: business details, your WhatsApp number for alerts, opening hours, services with the words customers actually use (Hindi too), booking rules and holidays. Add their common questions in **Knowledge**. Remove the demo data.

## 2. Deploy

One process serves the API and dashboard:

```bash
pnpm install && pnpm build
NODE_ENV=production SESSION_SECRET=<random> AGENT_SERVICE_TOKEN=<random> DATABASE_URL=<postgres url> pnpm start
```

Host it in an Indian region (Mumbai/Hyderabad) on any container host, with managed Postgres in the same region and HTTPS in front. Indian phone calls must keep signalling and media inside India, so the API and the agent should run there too.

## 3. WhatsApp

1. Create a Meta Business account and a WhatsApp Business app; complete business verification.
2. Add a phone number and get the Phone Number ID and a permanent access token.
3. Put them in `.env` as `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`.
4. Messages outside a 24-hour customer window need **approved templates**. Submit templates for: booking confirmation, reminder, waitlist offer, call-back note. The current code sends plain text, which works for testing with your own number; switch `deliverMessage` in `apps/api/src/services/messages.ts` to template sends once they're approved.
5. Point your WhatsApp webhook at a small handler that forwards customer replies to `POST /api/v1/agent/messages/inbound` (with the agent token), so "YES" and "CANCEL" work.

SMS into India additionally needs DLT registration of your business, sender ID and templates.

## 4. Phone calls

1. **Number**: rent an Indian number from a provider that can originate Indian calls and supports SIP trunking to LiveKit (Plivo and Exotel both publish LiveKit guides). Expect KYC.
2. **LiveKit Cloud**: create a project with the India region, then create an inbound SIP trunk for the number and a dispatch rule that sends calls to the agent.
3. **Speech**: create a Sarvam account (Indian languages, code-mixed speech) or Deepgram + ElevenLabs. Benchmark both on 30 recordings of real Hinglish callers saying dates, times, names and numbers before choosing.
4. **Run the agent**:

   ```bash
   cd apps/agent
   uv sync --extra voice
   uv run python -m agent.main download-files
   uv run python -m agent.main dev        # or `start` in production
   ```

   It reads the root `.env` (`LIVEKIT_*`, `SARVAM_API_KEY` etc., `VOICEOPS_API_URL`, `AGENT_SERVICE_TOKEN`, `BUSINESS_SLUG`).
5. **Forwarding**: the business keeps its published number and forwards busy, unanswered and after-hours calls to the VoiceOps number. Staff still pick up first; the AI catches what they miss.
6. Make 20 test calls from different phones and networks. Check the transcripts in **Calls**, especially dates and times, before switching forwarding on for real customers.

The phone agent caller ID is trusted (phone network), so returning callers are greeted by name and never asked for their number.

## 5. Privacy (India's DPDP rules)

- The greeting says an AI answers and the call may be recorded. Keep it.
- Decide retention (for example: transcripts 180 days) and delete on request. Settings for these are a next step; for now delete through the database.
- The business is the data owner; you process data for them. Put that in the pilot agreement.
- Have the consent wording reviewed before the pilot.

## 6. Run the pilot

- Weeks 1–2: after-hours calls only. Weeks 3–4: add busy/no-answer overflow.
- Every week, read five transcripts with the owner and fix the worst problem. Add each failure to `apps/api/eval/scenarios.ts` before fixing it.
- Track: calls handled, bookings by the AI, call backs completed on time, no-shows before vs after reminders, and your cost per call.
