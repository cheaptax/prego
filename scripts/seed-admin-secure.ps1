# Secure local helper: prompt for ADMIN_PASSWORD without echoing, then run seed:admin.
# Does not write the password to disk or git-tracked files.
#
# Usage (from project root):
#   powershell -ExecutionPolicy Bypass -File scripts/seed-admin-secure.ps1 -ExpectedProject nong-1af31 -DryRun
#   powershell -ExecutionPolicy Bypass -File scripts/seed-admin-secure.ps1 -ExpectedProject nong-1af31 -ConfirmProduction

param(
  [Parameter(Mandatory = $true)]
  [string]$ExpectedProject,

  [switch]$DryRun,
  [switch]$ConfirmProduction
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

if (-not $DryRun -and -not $ConfirmProduction) {
  Write-Host "Apply mode requires -ConfirmProduction. Use -DryRun first." -ForegroundColor Red
  exit 1
}

if (-not $DryRun) {
  $secure = Read-Host -AsSecureString "Enter new ADMIN_PASSWORD (min 8 chars, recommend 12+; input hidden)"
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:ADMIN_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }

  if (-not $env:ADMIN_PASSWORD -or $env:ADMIN_PASSWORD.Length -lt 8) {
    Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
    Write-Host "Password rejected: minimum 8 characters required." -ForegroundColor Red
    exit 1
  }
  if ($env:ADMIN_PASSWORD.Length -lt 12) {
    Write-Host "Warning: password is shorter than the recommended 12 characters." -ForegroundColor Yellow
  }
}

try {
  if ($DryRun) {
    npm run seed:admin -- --dry-run --expected-project $ExpectedProject
  } else {
    npm run seed:admin -- --expected-project $ExpectedProject --confirm-production
  }
  $code = $LASTEXITCODE
} finally {
  Remove-Item Env:ADMIN_PASSWORD -ErrorAction SilentlyContinue
}

if (-not $DryRun) {
  Write-Host "ADMIN_PASSWORD cleared from this PowerShell session." -ForegroundColor Yellow
  Write-Host "Store the password in your password manager if the seed succeeded." -ForegroundColor Yellow
}

exit $code
