"""HTTP client for the VoiceOps receptionist API (the /api/v1/agent/* routes)."""

from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class Reply:
    call_id: str
    text: str
    ended: bool
    latency_ms: int
    tools: list[dict[str, Any]] = field(default_factory=list)


class VoiceOpsError(Exception):
    pass


class VoiceOpsClient:
    """Talks to the Node API. Retries network errors briefly; never retries a 4xx."""

    def __init__(self, base_url: str, token: str, *, transport: httpx.AsyncBaseTransport | None = None, timeout: float = 10.0):
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"authorization": f"Bearer {token}"},
            timeout=timeout,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _post(self, path: str, body: dict[str, Any], *, retries: int = 2) -> dict[str, Any]:
        request_id = f"agent-{uuid.uuid4().hex[:16]}"
        last: Exception | None = None
        for attempt in range(retries + 1):
            try:
                res = await self._http.post(path, json=body, headers={"x-request-id": request_id})
            except (httpx.ConnectError, httpx.ReadTimeout, httpx.RemoteProtocolError) as err:
                last = err
                await asyncio.sleep(0.3 * (attempt + 1))
                continue
            if res.status_code >= 500 and attempt < retries:
                last = VoiceOpsError(f"HTTP {res.status_code}")
                await asyncio.sleep(0.3 * (attempt + 1))
                continue
            data = res.json() if res.content else {}
            if res.status_code >= 400:
                err = data.get("error", {}) if isinstance(data, dict) else {}
                raise VoiceOpsError(f"{err.get('code', res.status_code)}: {err.get('message', 'request failed')}")
            return data
        raise VoiceOpsError(f"VoiceOps API unreachable: {last}")

    @staticmethod
    def _reply(data: dict[str, Any]) -> Reply:
        return Reply(
            call_id=data["callId"],
            text=data["reply"],
            ended=bool(data.get("ended")),
            latency_ms=int(data.get("latencyMs", 0)),
            tools=list(data.get("trace", [])),
        )

    async def start_call(self, business_slug: str, caller_phone: str | None, *, engine: str = "rules", lang: str = "en") -> Reply:
        body: dict[str, Any] = {"businessSlug": business_slug, "engine": engine, "lang": lang}
        if caller_phone:
            body["callerPhone"] = caller_phone
        return self._reply(await self._post("/api/v1/agent/calls", body))

    async def turn(self, call_id: str, text: str) -> Reply:
        # A turn is not idempotent on the server (it advances the conversation), so don't retry it.
        return self._reply(await self._post(f"/api/v1/agent/calls/{call_id}/turns", {"text": text}, retries=0))

    async def end_call(self, call_id: str) -> None:
        try:
            await self._post(f"/api/v1/agent/calls/{call_id}/end", {})
        except VoiceOpsError:
            pass  # the server also closes idle calls on its own


def caller_phone_from_attributes(attributes: dict[str, str] | None) -> str | None:
    """LiveKit SIP participants carry the caller ID in 'sip.phoneNumber'."""
    if not attributes:
        return None
    for key in ("sip.phoneNumber", "sip.callerNumber", "phoneNumber"):
        value = attributes.get(key)
        if value:
            return value
    return None


def speech_seconds(text: str) -> float:
    """Rough time to speak a reply (~14 characters/second), used before hanging up."""
    return max(1.5, len(text) / 14 + 0.8)


FALLBACK_REPLY = {
    "en": "Sorry, I'm having a technical problem. Our team will call you back shortly.",
    "hi": "Maaf kijiye, abhi technical problem hai. Hamari team aapko jaldi call karegi.",
}
