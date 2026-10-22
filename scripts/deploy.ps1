param(
    [string]$SshHost = 'root@www.thomas-hub.com',
    [string]$ExpectedManifest,
    [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $ExpectedManifest) { $ExpectedManifest = Join-Path $projectRoot 'docs/production-manifest.json' }
$ExpectedManifest = (Resolve-Path -LiteralPath $ExpectedManifest).Path
Push-Location $projectRoot
try {
    & node scripts/package.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Build or package failed' }
    $uploadId = [guid]::NewGuid().ToString('N')
    $remoteDir = '/var/tmp/thomas-homepage-' + $uploadId
    & ssh -o BatchMode=yes $SshHost "install -d -m 700 $remoteDir"
    if ($LASTEXITCODE -ne 0) { throw 'Unable to create staging directory' }
    & scp -o BatchMode=yes (Join-Path $projectRoot 'release/homepage.tar.gz') "${SshHost}:$remoteDir/homepage.tar.gz"
    if ($LASTEXITCODE -ne 0) { throw 'Archive upload failed' }
    & scp -o BatchMode=yes (Join-Path $projectRoot 'scripts/server-release.py') "${SshHost}:$remoteDir/server-release.py"
    if ($LASTEXITCODE -ne 0) { throw 'Deployment script upload failed' }
    & scp -o BatchMode=yes $ExpectedManifest "${SshHost}:$remoteDir/expected.json"
    if ($LASTEXITCODE -ne 0) { throw 'Expected manifest upload failed' }
    $command = "python3 $remoteDir/server-release.py --archive $remoteDir/homepage.tar.gz --expect $remoteDir/expected.json"
    if ($DryRun) { $command += ' --dry-run' }
    & ssh -o BatchMode=yes $SshHost $command
    if ($LASTEXITCODE -ne 0) { throw 'Deployment stopped; inspect server output' }
    Write-Output "Remote deployment tool: $remoteDir/server-release.py"
} finally {
    Pop-Location
}
