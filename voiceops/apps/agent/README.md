# VoiceOps phone agent (Python)

Takes real phone calls through LiveKit. LiveKit handles audio, voice activity detection, turn detection, speech-to-text and text-to-speech. What to say and do comes from the VoiceOps API, the same receptionist as the web Talk page.

```
caller ⇄ SIP provider ⇄ LiveKit ⇄ this agent (STT → API turn → TTS) ⇄ VoiceOps API
```

## Run it

You need the API running (`pnpm dev` at the repo root), a LiveKit Cloud project (India region for Indian numbers) and speech keys. Install uv: https://docs.astral.sh/uv/

```bash
cd apps/agent
uv sync --extra voice
uv run python -m agent.main download-files   # turn-detector and VAD models, once
uv run python -m agent.main dev
```

Settings come from the repo-root `.env`:

| Variable | Default | |
| --- | --- | --- |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | | From your LiveKit project |
| `VOICEOPS_API_URL` | `http://localhost:4000` | Where the API runs |
| `AGENT_SERVICE_TOKEN` | dev token | Must match the API's |
| `BUSINESS_SLUG` | `autocare` | Which business this number belongs to |
| `AGENT_STT` / `AGENT_TTS` | `sarvam` | `sarvam`, or `deepgram` / `elevenlabs` |
| `AGENT_LANGUAGE` | `hi-IN` | Recognition language |
| `AGENT_ENGINE` | `rules` | `llm` to use the API's LLM mode |
| `AGENT_NAME` | empty | Set it and name it in your SIP dispatch rule for explicit dispatch |
| `SARVAM_API_KEY` / `DEEPGRAM_API_KEY` / `ELEVEN_API_KEY` | | For the providers you chose |

To test without a phone number, open the LiveKit Agents Playground for your project and talk to the agent from the browser.

## Tests

```bash
uv sync
uv run pytest
```

The tests cover the API client (auth, retries, error handling) and caller-ID parsing. The audio path needs real LiveKit and speech accounts, so it's tested by making calls.
