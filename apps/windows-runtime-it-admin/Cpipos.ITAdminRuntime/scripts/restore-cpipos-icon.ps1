param(
  [Parameter(Mandatory = $true)]
  [string] $SourceBase64,

  [Parameter(Mandatory = $true)]
  [string] $DestinationIcon
)

$ErrorActionPreference = "Stop"

if (!(Test-Path -LiteralPath $SourceBase64)) {
  throw "CpIPOS icon base64 source not found: $SourceBase64"
}

$destinationDir = Split-Path -Parent $DestinationIcon
if (![string]::IsNullOrWhiteSpace($destinationDir)) {
  New-Item -ItemType Directory -Force -Path $destinationDir | Out-Null
}

$iconBase64 = (Get-Content -LiteralPath $SourceBase64 -Raw).Trim()
[System.IO.File]::WriteAllBytes($DestinationIcon, [System.Convert]::FromBase64String($iconBase64))

if (!(Test-Path -LiteralPath $DestinationIcon)) {
  throw "CpIPOS icon was not restored: $DestinationIcon"
}

$bytes = [System.IO.File]::ReadAllBytes($DestinationIcon)
if (!($bytes.Length -gt 6 -and $bytes[0] -eq 0 -and $bytes[1] -eq 0 -and $bytes[2] -eq 1 -and $bytes[3] -eq 0)) {
  throw "Restored CpIPOS icon is not a valid Windows .ico file: $DestinationIcon"
}

Write-Host "Restored CpIPOS icon: $DestinationIcon ($($bytes.Length) bytes)"
