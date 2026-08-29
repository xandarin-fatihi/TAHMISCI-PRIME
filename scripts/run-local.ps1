$ErrorActionPreference = "Stop"

try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
} catch {}

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw "npm bulunamadı. Node.js LTS kurulu olmalıdır."
}

cmd /c npm run dev:local
