"""Settings from the repo's root .env (shared with the Node API) or the environment."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_ENV = Path(__file__).resolve().parents[3] / ".env"
load_dotenv(ROOT_ENV)


@dataclass(frozen=True)
class Settings:
    api_url: str
    agent_token: str
    business_slug: str
    stt: str  # deepgram | sarvam
    tts: str  # elevenlabs | sarvam
    language: str  # e.g. hi-IN / en-IN for STT
    engine: str  # rules | llm  (which receptionist engine the API should use)

    @staticmethod
    def load() -> "Settings":
        return Settings(
            api_url=os.getenv("VOICEOPS_API_URL", "http://localhost:4000").rstrip("/"),
            agent_token=os.getenv("AGENT_SERVICE_TOKEN", "dev-agent-token-change-me"),
            business_slug=os.getenv("BUSINESS_SLUG", "autocare"),
            stt=os.getenv("AGENT_STT", "sarvam").lower(),
            tts=os.getenv("AGENT_TTS", "sarvam").lower(),
            language=os.getenv("AGENT_LANGUAGE", "hi-IN"),
            engine=os.getenv("AGENT_ENGINE", "rules").lower(),
        )
