# VoiceOps one-click start for Windows (double-click "Start VoiceOps.bat").
# Checks Node and pnpm, installs packages, starts the app, opens the browser,
# and writes everything to voiceops-log.txt (plain UTF-8, so it can be read and shared).
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:FORCE_COLOR = "0"      # no colour codes in the log
$env:NO_COLOR = "1"         # Vite and other tools honour this one
$env:NO_UPDATE_NOTIFIER = "1"
$log = Join-Path $PSScriptRoot "voiceops-log.txt"

function Log($msg, $color = "Cyan") {
  $line = "[$(Get-Date -Format HH:mm:ss)] $msg"
  Write-Host $line -ForegroundColor $color
  Add-Content -Path $log -Value $line -Encoding UTF8
}
function Fail($msg) { Log "ERROR: $msg" "Red"; Read-Host "Press Enter to close"; exit 1 }

# Run a command through cmd so its error output arrives as plain text (PowerShell 5.1 turns it
# into scary-looking red "NativeCommandError" records otherwise), and copy every line to the log.
function Run($command) {
  cmd /c "$command 2>&1" | ForEach-Object {
    Write-Host $_
    Add-Content -Path $log -Value $_ -Encoding UTF8
  }
  return $LASTEXITCODE
}

Set-Content -Path $log -Value "VoiceOps start log $(Get-Date)" -Encoding UTF8
Log "Folder: $PSScriptRoot"

# --- Node.js 22.9 or newer -------------------------------------------------
$node = (cmd /c "node -v 2>&1")
if (-not $node -or "$node" -notmatch "^v(\d+)\.(\d+)") { Fail "Node.js is not installed. Install the LTS version from https://nodejs.org, then run this again." }
$major = [int]$Matches[1]; $minor = [int]$Matches[2]
Log "Node: $node"
if ($major -lt 22 -or ($major -eq 22 -and $minor -lt 9)) { Fail "Node.js $node is too old. Install 22.9 or newer from https://nodejs.org." }

# --- pnpm ------------------------------------------------------------------
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Log "pnpm not found, installing it with npm..."
  Run "npm install -g pnpm" | Out-Null
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) { Fail "Couldn't install pnpm. Run 'npm install -g pnpm' yourself, then try again." }
}
Log "pnpm: $(cmd /c 'pnpm -v 2>&1')"

# --- Ports -----------------------------------------------------------------
foreach ($port in 4000, 5173) {
  $busy = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
  if ($busy) {
    $proc = (Get-Process -Id $busy[0].OwningProcess -ErrorAction SilentlyContinue).ProcessName
    Fail "Port $port is already in use by '$proc'. VoiceOps may already be running in another window. Close it (or restart the computer) and try again."
  }
}

# --- Install ---------------------------------------------------------------
Log "Installing packages (the first time takes a few minutes)..."
$code = Run "pnpm install"
if ($code -ne 0) { Fail "pnpm install failed (exit $code). The lines above say why. Send voiceops-log.txt if you need help." }
Log "Packages installed."

# --- Open the browser once the dashboard answers -------------------------------
Start-Job -ScriptBlock {
  for ($i = 0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 2
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:4000/health" -TimeoutSec 2 | Out-Null
      Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:5173" -TimeoutSec 2 | Out-Null
      Start-Process "http://localhost:5173"
      break
    } catch {}
  }
} | Out-Null

Log "Starting VoiceOps. Keep this window open; closing it stops the app." "Green"
Log "Dashboard: http://localhost:5173   Click "Try the demo", or set up your own business" "Green"
$code = Run "pnpm dev"
Log "VoiceOps stopped (exit $code)."
Read-Host "Press Enter to close"
