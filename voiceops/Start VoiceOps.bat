@echo off
title VoiceOps
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-voiceops.ps1"
