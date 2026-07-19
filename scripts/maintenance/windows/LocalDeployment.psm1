Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Native Windows deployment is intentionally plan-only until a separately reviewed, injected
# transaction implementation exists. This module contains read-only preflight and validation only.
$script:ExitCodes = [ordered]@{ Success = 0; Prerequisite = 2; Validation = 3; Busy = 4; Deployment = 5; Rollback = 6 }
$script:ReleaseNamePattern = '^release-[0-9a-f]{40}$'
$script:ExpectedOrigin = 'https://github.com/DanRJ/pi-web.git'

function Get-DeploymentExitCode { param([ValidateSet('Success','Prerequisite','Validation','Busy','Deployment','Rollback')][string]$Kind) [int]$script:ExitCodes[$Kind] }
function Get-LocalDeploymentRoot { param([string]$Root) if ($Root) { return [IO.Path]::GetFullPath($Root) }; Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'PiWebLocal' }
function Get-LocalDeploymentLayout {
  param([string]$Root)
  $base = Get-LocalDeploymentRoot $Root
  [pscustomobject]@{ Root=$base; Releases=(Join-Path $base 'releases'); Active=(Join-Path $base 'active.json'); Lock=(Join-Path $base 'deploy.lock'); State=(Join-Path $base 'state'); Logs=(Join-Path $base 'logs'); Plans=(Join-Path $base 'plans') }
}
function Get-NormalPath { param([Parameter(Mandatory)][string]$Path) [IO.Path]::GetFullPath($Path).TrimEnd([IO.Path]::DirectorySeparatorChar,[IO.Path]::AltDirectorySeparatorChar) }
function Test-PathContained {
  param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$Path)
  $root = Get-NormalPath $Root; $candidate = Get-NormalPath $Path
  $prefix = $root + [IO.Path]::DirectorySeparatorChar
  $candidate.Equals($root,[StringComparison]::OrdinalIgnoreCase) -or $candidate.StartsWith($prefix,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-ContainedPath {
  param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$Path,[string]$Label='path')
  if (-not (Test-PathContained $Root $Path)) { throw "$Label escapes managed root: $Path" }
  Get-NormalPath $Path
}
function Test-ReparsePoint {
  param([Parameter(Mandatory)][string]$Path)
  if (-not [IO.File]::Exists($Path) -and -not [IO.Directory]::Exists($Path)) { return $false }
  (([IO.File]::GetAttributes($Path) -band [IO.FileAttributes]::ReparsePoint) -ne 0)
}
function Assert-ParentChainNotReparse {
  param([Parameter(Mandatory)][string]$Path)
  $current = Get-NormalPath $Path
  while ($true) {
    if (([IO.File]::Exists($current) -or [IO.Directory]::Exists($current)) -and (Test-ReparsePoint $current)) { throw "Reparse point is not allowed: $current" }
    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrEmpty($parent) -or $parent -eq $current) { break }
    $current = $parent
  }
}
function Assert-NoReparsePath {
  param([Parameter(Mandatory)][string]$Root,[Parameter(Mandatory)][string]$Path)
  $normal = Assert-ContainedPath $Root $Path
  Assert-ParentChainNotReparse $normal
  $normal
}
function Get-Sha256 {
  param([Parameter(Mandatory)][string]$Path)
  if (-not [IO.File]::Exists($Path)) { throw "File not found: $Path" }
  (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}
function Assert-ExactObjectKeys {
  param([Parameter(Mandatory)]$Value,[string[]]$Keys,[Parameter(Mandatory)][string]$Name)
  if ($null -eq $Value -or $Value -is [Array]) { throw "$Name must be an object." }
  $actual = @($Value.PSObject.Properties.Name | Sort-Object); $expected = @($Keys | Sort-Object)
  if (($actual -join "`0") -ne ($expected -join "`0")) { throw "$Name has an invalid schema." }
}
function ConvertTo-RelativeManifestPath {
  param([Parameter(Mandatory)][string]$Path)
  if ([string]::IsNullOrWhiteSpace($Path) -or $Path -match '^[\\/]' -or $Path -match '(^|[\\/])\.{1,2}([\\/]|$)' -or $Path.Contains(':')) { throw "Invalid relative manifest path: $Path" }
  $Path -replace '\\','/'
}
function Read-JsonFile {
  param([Parameter(Mandatory)][string]$Path,[string]$ManagedRoot)
  if ($ManagedRoot) { Assert-NoReparsePath $ManagedRoot $Path | Out-Null } else { Assert-ParentChainNotReparse $Path }
  if (-not [IO.File]::Exists($Path)) { return $null }
  try { [IO.File]::ReadAllText($Path,[Text.Encoding]::UTF8) | ConvertFrom-Json -ErrorAction Stop } catch { throw "Invalid JSON at ${Path}: $($_.Exception.Message)" }
}
function Get-ReleaseInventory {
  param([Parameter(Mandatory)][string]$ReleasePath)
  $root = Get-NormalPath $ReleasePath; Assert-ParentChainNotReparse $root
  if (-not [IO.Directory]::Exists($root)) { throw "Release directory is missing: $root" }
  if (Test-ReparsePoint $root) { throw 'Release root cannot be a reparse point.' }
  $files = New-Object Collections.Generic.List[object]; $directories = New-Object Collections.Generic.List[string]
  foreach ($entry in Get-ChildItem -LiteralPath $root -Force -Recurse) {
    if (Test-ReparsePoint $entry.FullName) { throw "Release contains a reparse point: $($entry.FullName)" }
    $relative = ConvertTo-RelativeManifestPath ($entry.FullName.Substring($root.Length).TrimStart([char]'\',[char]'/'))
    if ($entry -is [IO.DirectoryInfo]) { $directories.Add($relative) }
    elseif ($entry -is [IO.FileInfo]) { $files.Add([ordered]@{ path=$relative; sha256=(Get-Sha256 $entry.FullName); bytes=[int64]$entry.Length }) }
    else { throw "Release contains an unsupported filesystem entry: $($entry.FullName)" }
  }
  [ordered]@{ files=@($files | Sort-Object path); directories=@($directories | Sort-Object) }
}
function Test-ReleaseManifest {
  param([Parameter(Mandatory)][string]$ReleasePath)
  $root = Get-NormalPath $ReleasePath; Assert-ParentChainNotReparse $root
  $manifestPath = Assert-NoReparsePath $root (Join-Path $root 'release-manifest.json')
  $sidecar = Assert-NoReparsePath $root (Join-Path $root 'release-manifest.sha256')
  $manifest = Read-JsonFile $manifestPath $root
  Assert-ExactObjectKeys $manifest @('schemaVersion','commit','files','directories') 'release manifest'
  if ($manifest.schemaVersion -ne 2 -or $manifest.commit -notmatch '^[0-9a-f]{40}$' -or $manifest.files -isnot [Array] -or $manifest.directories -isnot [Array]) { throw 'Invalid release manifest.' }
  if (-not [IO.File]::Exists($sidecar) -or ([IO.File]::ReadAllText($sidecar,[Text.Encoding]::UTF8).Trim() -ne (Get-Sha256 $manifestPath))) { throw 'Release manifest sidecar hash mismatch.' }
  $listedFiles = @{}; foreach ($file in $manifest.files) {
    Assert-ExactObjectKeys $file @('path','sha256','bytes') 'release manifest file entry'; $relative = ConvertTo-RelativeManifestPath ([string]$file.path)
    if ($relative -in @('release-manifest.json','release-manifest.sha256') -or $listedFiles.ContainsKey($relative) -or $file.sha256 -notmatch '^[0-9a-f]{64}$' -or [int64]$file.bytes -lt 0) { throw 'Invalid release manifest file entry.' }
    $listedFiles[$relative] = $file
  }
  $listedDirectories = @{}; foreach ($directory in $manifest.directories) { $relative = ConvertTo-RelativeManifestPath ([string]$directory); if ($listedDirectories.ContainsKey($relative)) { throw 'Duplicate release manifest directory.' }; $listedDirectories[$relative]=$true }
  $inventory = Get-ReleaseInventory $root
  $actualFiles = @($inventory.files | Where-Object { $_.path -notin @('release-manifest.json','release-manifest.sha256') })
  if (($actualFiles.path -join "`0") -ne (($listedFiles.Keys | Sort-Object) -join "`0") -or (($inventory.directories -join "`0") -ne (($listedDirectories.Keys | Sort-Object) -join "`0"))) { throw 'Release tree does not exactly match its manifest.' }
  foreach ($actual in $actualFiles) { $declared=$listedFiles[$actual.path]; if ($actual.sha256 -ne $declared.sha256 -or [int64]$actual.bytes -ne [int64]$declared.bytes) { throw "Release manifest hash mismatch: $($actual.path)" } }
  $manifest
}
function Get-ActiveRelease {
  param([Parameter(Mandatory)][string]$Root)
  $layout=Get-LocalDeploymentLayout $Root; Assert-ParentChainNotReparse $layout.Root; $active=Read-JsonFile $layout.Active $layout.Root
  if($null -eq $active){return $null}; Assert-ExactObjectKeys $active @('schemaVersion','generation','release','switchedAt') 'active release pointer'
  if($active.schemaVersion -ne 2 -or [int64]$active.generation -lt 1 -or $active.release -notmatch $script:ReleaseNamePattern -or [string]::IsNullOrWhiteSpace($active.switchedAt)){throw 'Invalid active-release pointer.'}
  $release=Assert-NoReparsePath $layout.Releases (Join-Path $layout.Releases $active.release); if(-not [IO.Directory]::Exists($release)){throw 'Active release is missing.'}; Test-ReleaseManifest $release | Out-Null
  $active | Add-Member -NotePropertyName releasePath -NotePropertyValue $release -Force; $active
}
function New-ReadOnlyPlan {
  param([Parameter(Mandatory)][string]$Kind,[Parameter(Mandatory)][string]$SourceRoot,[Parameter(Mandatory)]$SourceProof,[Parameter(Mandatory)]$Layout)
  $payload=[ordered]@{schemaVersion=1;kind=$Kind;source=[ordered]@{root=(Get-NormalPath $SourceRoot);head=$SourceProof.head;remoteMain=$SourceProof.remoteMain;origin=$SourceProof.origin};managedRoot=$Layout.Root;applySupported=$false}
  $json=$payload|ConvertTo-Json -Compress -Depth 10; $digest=([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($json))|ForEach-Object ToString x2)-join ''
  $payload['digest']=$digest; $payload
}
function Invoke-ReadOnlySourceGit {
  param([Parameter(Mandatory)][string]$SourceRoot,[Parameter(Mandatory)][string[]]$Arguments)
  $original = [Environment]::GetEnvironmentVariable('GIT_OPTIONAL_LOCKS', 'Process')
  try {
    [Environment]::SetEnvironmentVariable('GIT_OPTIONAL_LOCKS', '0', 'Process')
    $output = & git -C $SourceRoot @Arguments 2>$null
    [pscustomobject]@{ exitCode=$LASTEXITCODE; output=@($output) }
  } finally {
    [Environment]::SetEnvironmentVariable('GIT_OPTIONAL_LOCKS', $original, 'Process')
  }
}
function Get-SourceProof {
  param([Parameter(Mandatory)][string]$SourceRoot,[string]$ExpectedOrigin=$script:ExpectedOrigin)
  $root=Get-NormalPath $SourceRoot
  $originResult=Invoke-ReadOnlySourceGit -SourceRoot $root -Arguments @('remote','get-url','origin'); $origin=($originResult.output -join "`n").Trim()
  if($originResult.exitCode -ne 0 -or $origin -ne $ExpectedOrigin){throw 'Source origin identity does not match the deployment policy.'}
  $headResult=Invoke-ReadOnlySourceGit -SourceRoot $root -Arguments @('rev-parse','HEAD'); $head=($headResult.output -join "`n").Trim()
  if($headResult.exitCode -ne 0 -or $head -notmatch '^[0-9a-f]{40}$'){throw 'Could not resolve source HEAD.'}
  $remoteResult=Invoke-ReadOnlySourceGit -SourceRoot $root -Arguments @('ls-remote','--refs','origin','refs/heads/main'); $remoteLine=($remoteResult.output -join "`n").Trim()
  if($remoteResult.exitCode -ne 0 -or $remoteLine -notmatch '^(?<sha>[0-9a-f]{40})\s+refs/heads/main$'){throw 'Remote origin/main did not return one exact SHA.'}; $remoteMain=$Matches.sha
  $statusResult=Invoke-ReadOnlySourceGit -SourceRoot $root -Arguments @('status','--porcelain'); $dirty=($statusResult.output -join "`n").Trim()
  if($statusResult.exitCode -ne 0 -or $head -ne $remoteMain -or -not [string]::IsNullOrWhiteSpace($dirty)){throw 'Source is not clean and exactly at remote origin/main.'}
  [pscustomobject]@{head=$head;remoteMain=$remoteMain;origin=$origin}
}

Export-ModuleMember -Function Get-DeploymentExitCode,Get-LocalDeploymentLayout,Get-ActiveRelease,New-ReadOnlyPlan,Get-SourceProof
