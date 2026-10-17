"""
VoiceOps phone agent (LiveKit Agents 1.x).

LiveKit gives us audio, voice activity detection, turn detection, speech-to-text and text-to-speech.
The receptionist itself lives in the Node API: every caller utterance is sent to
POST /api/v1/agent/calls/:id/turns and the reply is spoken back. That keeps one brain for web and
phone, and all booking rules stay on the server.

Run:  uv sync --extra voice  →  uv run python -m agent.main download-files  →  uv run python -m agent.main dev
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterable
from typing import Any

from livekit import api
from livekit.agents import Agent, AgentSession, JobContext, WorkerOptions, cli, llm
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

from .client import FALLBACK_REPLY, VoiceOpsClient, VoiceOpsError, caller_phone_from_attributes, speech_seconds
from .config import Settings

log = logging.getLogger("voiceops.agent")


def build_stt(s: Settings):
    if s.stt == "deepgram":
        from livekit.plugins import deepgram

        # nova-3 supports multilingual (code-switched) speech; good for Hinglish.
        return deepgram.STT(model="nova-3", language="multi")
    from livekit.plugins import sarvam

    return sarvam.STT(language=s.language)


def build_tts(s: Settings):
    if s.tts == "elevenlabs":
        from livekit.plugins import elevenlabs

        return elevenlabs.TTS(model="eleven_flash_v2_5")
    from livekit.plugins import sarvam

    return sarvam.TTS(target_language_code=s.language)


class Receptionist(Agent):
    """An Agent whose 'LLM' is the VoiceOps API."""

    def __init__(self, client: VoiceOpsClient, call_id: str, ctx: JobContext, lang: str) -> None:
        super().__init__(instructions="Replies come from the VoiceOps API.")
        self._client = client
        self._call_id = call_id
        self._ctx = ctx
        self._lang = lang
        self._pending: str | None = None
        self.ended = False

    async def on_user_turn_completed(self, turn_ctx: llm.ChatContext, new_message: llm.ChatMessage) -> None:
        self._pending = (new_message.text_content or "").strip()

    async def llm_node(self, chat_ctx: llm.ChatContext, tools: list[Any], model_settings: Any) -> AsyncIterable[str]:
        text = self._pending or last_user_text(chat_ctx)
        self._pending = None
        if not text:
            return
        try:
            reply = await self._client.turn(self._call_id, text)
        except VoiceOpsError as err:
            log.error("turn failed: %s", err)
            yield FALLBACK_REPLY["hi" if self._lang.startswith("hi") else "en"]
            return
        log.info("turn: %s ms, tools=%s", reply.latency_ms, [t.get("name") for t in reply.tools])
        yield reply.text
        if reply.ended:
            self.ended = True
            asyncio.create_task(self._hang_up_after(reply.text))

    async def _hang_up_after(self, text: str) -> None:
        await asyncio.sleep(speech_seconds(text))
        await hang_up(self._ctx)


def last_user_text(chat_ctx: llm.ChatContext) -> str:
    for item in reversed(list(chat_ctx.items)):
        if getattr(item, "role", None) == "user":
            return (getattr(item, "text_content", "") or "").strip()
    return ""


async def hang_up(ctx: JobContext) -> None:
    try:
        await ctx.api.room.delete_room(api.DeleteRoomRequest(room=ctx.room.name))
    except Exception as err:  # noqa: BLE001
        log.warning("hang up failed: %s", err)


async def entrypoint(ctx: JobContext) -> None:
    settings = Settings.load()
    await ctx.connect()
    participant = await ctx.wait_for_participant()
    phone = caller_phone_from_attributes(getattr(participant, "attributes", None))
    lang = "hi" if settings.language.startswith("hi") else "en"

    client = VoiceOpsClient(settings.api_url, settings.agent_token)
    try:
        start = await client.start_call(settings.business_slug, phone, engine=settings.engine, lang=lang)
    except VoiceOpsError as err:
        log.error("could not start call: %s", err)
        await client.aclose()
        await hang_up(ctx)
        return

    agent = Receptionist(client, start.call_id, ctx, settings.language)
    session = AgentSession(
        stt=build_stt(settings),
        tts=build_tts(settings),
        vad=silero.VAD.load(),
        turn_detection=MultilingualModel(),
    )

    async def on_shutdown() -> None:
        await client.end_call(start.call_id)
        await client.aclose()

    ctx.add_shutdown_callback(on_shutdown)
    await session.start(room=ctx.room, agent=agent)
    await session.say(start.text, allow_interruptions=True)


if __name__ == "__main__":
    import os

    # Empty name = LiveKit dispatches this agent to every new room (easiest for testing).
    # Set AGENT_NAME and reference it in your SIP dispatch rule for explicit dispatch in production.
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint, agent_name=os.getenv("AGENT_NAME", "")))
