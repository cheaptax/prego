# Run from project root after cloning from GitHub.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/setup-local.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

Write-Host "== pregosuv local setup ==" -ForegroundColor Cyan

if (-not (Test-Path ".env.local")) {
  if (Test-Path "env.local.transfer") {
    Copy-Item "env.local.transfer" ".env.local"
    Write-Host "Copied env.local.transfer -> .env.local" -ForegroundColor Green
  } elseif (Test-Path ".env.example") {
    Copy-Item ".env.example" ".env.local"
    Write-Host "Created .env.local from .env.example" -ForegroundColor Yellow
    Write-Host "Fill in Firebase values in .env.local, then run this script again." -ForegroundColor Yellow
    exit 1
  } else {
    Write-Host "Missing .env.local and env.local.transfer" -ForegroundColor Red
    exit 1
  }
}

Write-Host "Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host ""
Write-Host "Setup complete." -ForegroundColor Green
Write-Host "Start dev server: npm run dev"
Write-Host "Admin console: http://localhost:3000/admin"
Write-Host "Admin Auth bootstrap: see docs/ADMIN_AUTH_MIGRATION.md"
