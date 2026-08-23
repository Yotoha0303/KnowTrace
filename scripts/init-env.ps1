param(
  [string]$EnvironmentFile = ".env"
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$environmentPath = [System.IO.Path]::GetFullPath(
  [System.IO.Path]::Combine($projectDirectory, $EnvironmentFile)
)
$examplePath = Join-Path $projectDirectory ".env.example"

if (-not (Test-Path -LiteralPath $environmentPath)) {
  Copy-Item -LiteralPath $examplePath -Destination $environmentPath
}

$lines = [System.Collections.Generic.List[string]]::new()
Get-Content -LiteralPath $environmentPath | ForEach-Object { $lines.Add($_) }
$generated = [System.Collections.Generic.List[string]]::new()

function Find-EnvIndex([string]$Name) {
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match "^$([regex]::Escape($Name))=") { return $index }
  }
  return -1
}

function Get-EnvValue([string]$Name) {
  $index = Find-EnvIndex $Name
  if ($index -lt 0) { return $null }
  return $lines[$index].Substring($Name.Length + 1)
}

function Set-EnvValue([string]$Name, [string]$Value) {
  $index = Find-EnvIndex $Name
  $entry = "$Name=$Value"
  if ($index -lt 0) {
    if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -ne "") { $lines.Add("") }
    $lines.Add($entry)
  } else {
    $lines[$index] = $entry
  }
}

function New-UrlSafeSecret([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Ensure-Secret([string]$Name, [int]$ByteCount) {
  $value = Get-EnvValue $Name
  if ([string]::IsNullOrWhiteSpace($value) -or $value -match "^(replace|your_)") {
    Set-EnvValue $Name (New-UrlSafeSecret $ByteCount)
    $generated.Add($Name)
  }
}

if ([string]::IsNullOrWhiteSpace((Get-EnvValue "KNOWTRACE_ADMIN_USERNAME"))) {
  Set-EnvValue "KNOWTRACE_ADMIN_USERNAME" "KnowTrace"
}
if ([string]::IsNullOrWhiteSpace((Get-EnvValue "AUTH_ENABLED"))) {
  Set-EnvValue "AUTH_ENABLED" "true"
}
if ([string]::IsNullOrWhiteSpace((Get-EnvValue "KNOWTRACE_HOST"))) {
  Set-EnvValue "KNOWTRACE_HOST" "127.0.0.1"
}

Ensure-Secret "AUTH_DB_ROOT_PASSWORD" 32
Ensure-Secret "AUTH_DB_PASSWORD" 32
Ensure-Secret "AUTH_JWT_SECRET" 48
Ensure-Secret "KNOWTRACE_ADMIN_PASSWORD" 24

[System.IO.File]::WriteAllLines(
  $environmentPath,
  $lines,
  [System.Text.UTF8Encoding]::new($false)
)

if ($generated.Count -gt 0) {
  Write-Output "已在 .env 中生成本机密钥：$($generated -join ', ')（不会打印密钥值）。"
} else {
  Write-Output ".env 已包含统一启动所需密钥。"
}
Write-Output "默认管理员用户名：$(Get-EnvValue 'KNOWTRACE_ADMIN_USERNAME')；密码保存在 .env 的 KNOWTRACE_ADMIN_PASSWORD。"
