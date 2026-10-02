param(
  [string]$EnvironmentFile = ".env",
  [switch]$UseFixedAdminCredential
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
# 管理员口令：默认随机生成（与 Linux 侧 scripts/linux/init-env.sh 同一判据）。
# 固定值只在显式传 -UseFixedAdminCredential 时使用 —— 那是给本机开发留的逃生口。
#
# 为什么改（2026-10-02）：原先写死 KnowTrace@123，而这对凭据**写在公开 README 里**。
# 实测一台全新 VPS（公网可访问）上，管理员口令就是这 13 个字符。
# 学习目录的《从零部署教程》§10 用的是随机 48 字符，老机也是随机 —— 只有
# "照仓库脚本装"的机器是固定值。
#
# 幂等判据与 Ensure-Secret 一致：已有值一律不动。
# **特别地，不要把已存在的 KnowTrace@123 当成"需要替换"** ——
# 否则重跑会把已部署环境的已知口令悄悄换掉，运维人员会登不进去。
$adminPassword = (Get-EnvValue "KNOWTRACE_ADMIN_PASSWORD")
$adminPasswordNeedsGeneration =
  [string]::IsNullOrWhiteSpace($adminPassword) -or $adminPassword -match '^(replace|your_)'
if ($UseFixedAdminCredential -and $adminPasswordNeedsGeneration) {
  Set-EnvValue "KNOWTRACE_ADMIN_PASSWORD" "KnowTrace@123"
  $generated.Add("KNOWTRACE_ADMIN_PASSWORD(FIXED)")
} elseif ($adminPasswordNeedsGeneration) {
  Set-EnvValue "KNOWTRACE_ADMIN_PASSWORD" (New-UrlSafeSecret 24)
  $generated.Add("KNOWTRACE_ADMIN_PASSWORD")
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
# 以前这里无条件打印「默认管理员凭据：KnowTrace / KnowTrace@123」。
# 2026-10-02 起口令默认随机，那句话会误导人去用一对已不成立的凭据。
if ($UseFixedAdminCredential) {
  Write-Output "管理员口令使用固定值 KnowTrace@123（-UseFixedAdminCredential；仅本机开发用）。"
} else {
  Write-Output "管理员口令为随机生成；查看方式（勿贴进聊天或日志）："
  Write-Output "  Select-String '^KNOWTRACE_ADMIN_(USERNAME|PASSWORD)=' $environmentPath"
  Write-Output "  首次登录后请立即修改；修改后 .env 中的值不再代表当前口令。"
}
