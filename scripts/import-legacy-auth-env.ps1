param(
  [string]$LegacyEnvironmentFile = "../go-user-system/.env",
  [string]$EnvironmentFile = ".env"
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$legacyPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($projectDirectory, $LegacyEnvironmentFile))
$environmentPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($projectDirectory, $EnvironmentFile))
if (-not (Test-Path -LiteralPath $legacyPath)) { return }
if (-not (Test-Path -LiteralPath $environmentPath)) {
  Copy-Item -LiteralPath (Join-Path $projectDirectory ".env.example") -Destination $environmentPath
}

function Read-Env([string]$Path) {
  $values = @{}
  Get-Content -LiteralPath $Path | ForEach-Object {
    if ($_ -match '^([^#=]+)=(.*)$') { $values[$matches[1]] = $matches[2] }
  }
  return $values
}

$legacy = Read-Env $legacyPath
$current = Read-Env $environmentPath
if ($current["AUTH_LEGACY_IMPORTED"] -eq "true") { return }

$requiredMappings = [ordered]@{
  DB_ROOT_PASSWORD = "AUTH_DB_ROOT_PASSWORD"
  DB_PASSWORD = "AUTH_DB_PASSWORD"
  JWT_SECRET = "AUTH_JWT_SECRET"
}
foreach ($sourceName in $requiredMappings.Keys) {
  if ([string]::IsNullOrWhiteSpace($legacy[$sourceName])) {
    throw "旧 go-user-system .env 缺少 $sourceName，无法安全复用现有认证数据卷。"
  }
}

$lines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $environmentPath | ForEach-Object { $lines.Add($_) }
function Set-EnvValue([string]$Name, [string]$Value) {
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match "^$([regex]::Escape($Name))=") {
      $lines[$index] = "$Name=$Value"
      return
    }
  }
  if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne "") { $lines.Add("") }
  $lines.Add("$Name=$Value")
}

foreach ($sourceName in $requiredMappings.Keys) {
  Set-EnvValue $requiredMappings[$sourceName] $legacy[$sourceName]
}
Set-EnvValue "AUTH_LEGACY_IMPORTED" "true"
[System.IO.File]::WriteAllLines($environmentPath, $lines, [System.Text.UTF8Encoding]::new($false))
Write-Output "已迁移旧 go-user-system 的数据库/JWT密钥（密钥值未输出）。"
