param(
  [string]$DestinationDirectory = "backups/auth"
)

$ErrorActionPreference = "Stop"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$resolvedDestination = [System.IO.Path]::GetFullPath(
  [System.IO.Path]::Combine($projectDirectory, $DestinationDirectory)
)
$projectPrefix = $projectDirectory.TrimEnd(
  [System.IO.Path]::DirectorySeparatorChar,
  [System.IO.Path]::AltDirectorySeparatorChar
) + [System.IO.Path]::DirectorySeparatorChar
if (-not $resolvedDestination.StartsWith($projectPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "认证备份目录必须位于 KnowTrace 项目内。"
}

function Get-SHA256Hex([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
    $stream.Dispose()
  }
}

$runningServices = @(docker compose ps --status running --services)
if ($LASTEXITCODE -ne 0 -or $runningServices -notcontains "auth-mysql") {
  throw "统一 Compose 的 auth-mysql 服务尚未运行。"
}

New-Item -ItemType Directory -Force -Path $resolvedDestination | Out-Null
$createdAt = (Get-Date).ToUniversalTime()
$stamp = $createdAt.ToString("yyyyMMdd-HHmmss")
$containerPath = "/tmp/go_user_system-$stamp.sql"
$backupPath = Join-Path $resolvedDestination "go_user_system-$stamp.sql"
$manifestPath = "$backupPath.manifest.json"
$dumpCommand = 'umask 077; MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot --single-transaction --routines --triggers --events --set-gtid-purged=OFF go_user_system > ' + $containerPath

try {
  docker compose exec -T auth-mysql sh -c $dumpCommand
  if ($LASTEXITCODE -ne 0) { throw "go-user-system MySQL 备份失败。" }

  $containerHash = ((docker compose exec -T auth-mysql sha256sum $containerPath) -split "\s+")[0].ToLowerInvariant()
  if ($LASTEXITCODE -ne 0) { throw "无法校验容器内认证备份。" }

  docker compose cp "auth-mysql:$containerPath" $backupPath
  if ($LASTEXITCODE -ne 0) { throw "无法复制认证备份文件。" }
  $file = Get-Item -LiteralPath $backupPath
  if ($file.Length -le 0) { throw "认证备份文件为空。" }
  $hostHash = Get-SHA256Hex $backupPath
  if ($hostHash -ne $containerHash) { throw "认证备份复制前后校验和不一致。" }

  $manifest = [ordered]@{
    schema_version = 1
    source = "knowtrace-unified-compose"
    database = "go_user_system"
    created_at_utc = $createdAt.ToString("o")
    application_commit = (git rev-parse HEAD 2>$null | Select-Object -First 1)
    file = $file.Name
    size_bytes = $file.Length
    sha256 = $hostHash
  }
  $manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8
  Write-Output $backupPath
} finally {
  docker compose exec -T auth-mysql rm -f $containerPath 2>$null
}
