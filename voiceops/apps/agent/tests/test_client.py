import asyncio
import json

import httpx
import pytest

from agent.client import VoiceOpsClient, VoiceOpsError, caller_phone_from_attributes, speech_seconds


def make_client(handler):
    return VoiceOpsClient("http://api.test", "tok", transport=httpx.MockTransport(handler))


def test_start_and_turn_send_token_and_parse_replies():
    seen = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append((req.method, req.url.path, req.headers.get("authorization"), json.loads(req.content or b"{}")))
        if req.url.path == "/api/v1/agent/calls":
            return httpx.Response(201, json={"callId": "c1", "reply": "Namaste!", "ended": False, "latencyMs": 5, "trace": []})
        return httpx.Response(200, json={"callId": "c1", "reply": "Done", "ended": True, "latencyMs": 40, "trace": [{"name": "book_appointment", "ok": True}]})

    async def run():
        c = make_client(handler)
        start = await c.start_call("autocare", "+919812345678")
        reply = await c.turn(start.call_id, "haan")
        await c.aclose()
        return start, reply

    start, reply = asyncio.run(run())
    assert start.text == "Namaste!"
    assert reply.ended and reply.tools[0]["name"] == "book_appointment"
    assert seen[0][2] == "Bearer tok"
    assert seen[0][3]["callerPhone"] == "+919812345678"
    assert seen[1][1] == "/api/v1/agent/calls/c1/turns"


def test_client_errors_are_readable_and_4xx_not_retried():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        return httpx.Response(409, json={"error": {"code": "call_ended", "message": "This call has ended."}})

    async def run():
        c = make_client(handler)
        try:
            await c.turn("c1", "hello")
        finally:
            await c.aclose()

    with pytest.raises(VoiceOpsError, match="call_ended"):
        asyncio.run(run())
    assert calls["n"] == 1


def test_server_errors_are_retried_for_start():
    calls = {"n": 0}

    def handler(req):
        calls["n"] += 1
        if calls["n"] < 2:
            return httpx.Response(503, json={})
        return httpx.Response(201, json={"callId": "c2", "reply": "Hi", "ended": False})

    async def run():
        c = make_client(handler)
        r = await c.start_call("autocare", None)
        await c.aclose()
        return r

    assert asyncio.run(run()).call_id == "c2"
    assert calls["n"] == 2


def test_caller_phone_from_sip_attributes():
    assert caller_phone_from_attributes({"sip.phoneNumber": "+919876543210"}) == "+919876543210"
    assert caller_phone_from_attributes({}) is None
    assert caller_phone_from_attributes(None) is None


def test_speech_time_estimate():
    assert speech_seconds("ok") == 1.5
    assert 5 < speech_seconds("x" * 100) < 9
