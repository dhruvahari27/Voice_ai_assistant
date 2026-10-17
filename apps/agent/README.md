# VoiceOps voice agent (Python)

Empty until Phase 1. It will be a LiveKit Agents worker that:

- joins a LiveKit room when a call starts (browser or phone),
- runs VAD + turn detection + speech-to-text + LLM + text-to-speech,
- calls the Node API's `/api/v1/tools/*` endpoints for anything that reads or changes business data,
- never writes to the database directly.

Setup (Phase 1):

```bash
cd apps/agent
uv sync
uv run pytest
```
