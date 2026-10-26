#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$Version = "latest",
    [string]$Archive = "",
    [string]$ZipPath = "",
    [string]$InstallDir = "$HOME\.opencode\bin",
    [switch]$NoPath
)

$ErrorActionPreference = "Stop"
$tempDir = Join-Path ([IO.Path]::GetTempPath()) ("opencode-qol-" + [Guid]::NewGuid().ToString("N"))
try {
    if ($Archive -and $ZipPath) { throw "Specify only one of -Archive or -ZipPath." }
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $localZip = if ($Archive) { $Archive } else { $ZipPath }
    if ($localZip) {
        $localZip = (Resolve-Path -LiteralPath $localZip).Path
    } else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $base = "https://github.com/zjm54321/opencode-qol/releases"
        $url = if ($Version -eq "latest") { "$base/latest/download/opencode-windows-x64.zip" } else { "$base/download/$Version/opencode-windows-x64.zip" }
        $localZip = Join-Path $tempDir "opencode.zip"
        Write-Host "Downloading OpenCode QoL ($Version)..."
        Invoke-WebRequest -Uri $url -OutFile $localZip -UseBasicParsing
    }
    $unpacked = Join-Path $tempDir "unpacked"
    Expand-Archive -LiteralPath $localZip -DestinationPath $unpacked -Force
    $executables = @(Get-ChildItem -LiteralPath $unpacked -Filter "opencode.exe" -File -Recurse)
    if ($executables.Count -ne 1) { throw "Archive must contain exactly one opencode.exe." }
    $InstallDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($InstallDir)
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    # Preserve companion files next to the executable.
    Get-ChildItem -LiteralPath $executables[0].Directory.FullName -Force | Copy-Item -Destination $InstallDir -Recurse -Force
    $exe = Join-Path $InstallDir "opencode.exe"
    $installedVersion = & $exe --version
    if ($LASTEXITCODE -ne 0) { throw "opencode.exe --version failed (exit $LASTEXITCODE)." }
    if (-not $NoPath) {
        $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
        $normalized = $InstallDir.TrimEnd('\', '/')
        $entries = @($userPath -split ';' | Where-Object { $_ })
        $present = @($entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\', '/') -ieq $normalized }).Count -gt 0
        if (-not $present) {
            [Environment]::SetEnvironmentVariable("Path", (($entries + $InstallDir) -join ';'), "User")
        }
        $currentEntries = @($env:PATH -split ';' | Where-Object { $_ })
        if (@($currentEntries | Where-Object { $_.TrimEnd('\', '/') -ieq $normalized }).Count -eq 0) {
            $env:PATH = ($currentEntries + $InstallDir) -join ';'
        }
    }
    Write-Host "OpenCode QoL installed: $exe"
    Write-Host "Version: $installedVersion"
    if ($NoPath) { Write-Host "PATH unchanged. Run: & '$exe'" } else { Write-Host "Run 'opencode'. New terminals will use the updated user PATH." }
} catch {
    throw "OpenCode QoL installation failed: $($_.Exception.Message)"
} finally {
    if (Test-Path -LiteralPath $tempDir) { Remove-Item -LiteralPath $tempDir -Recurse -Force }
}
