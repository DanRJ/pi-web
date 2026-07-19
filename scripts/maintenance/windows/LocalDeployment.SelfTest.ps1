[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$root=Join-Path ([IO.Path]::GetTempPath()) ('pi-web-local-test-'+[Guid]::NewGuid())
function Assert-True([bool]$Value,[string]$Message){if(-not $Value){throw $Message}}
function Get-FileFingerprint([string]$Path){
  if(-not [IO.File]::Exists($Path)){return [ordered]@{exists=$false}}
  $item=Get-Item -LiteralPath $Path
  [ordered]@{exists=$true;bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($Path));lastWriteTimeUtcTicks=$item.LastWriteTimeUtc.Ticks}
}
function Get-TreeFingerprint([string]$Path){
  if(-not [IO.Directory]::Exists($Path)){return [ordered]@{exists=$false}}
  $entries=@(Get-ChildItem -LiteralPath $Path -Force -Recurse | Sort-Object FullName | ForEach-Object {
    $relative=$_.FullName.Substring($Path.Length).TrimStart([char]'\',[char]'/')
    if($_ -is [IO.FileInfo]){[ordered]@{path=$relative;kind='file';bytes=[Convert]::ToBase64String([IO.File]::ReadAllBytes($_.FullName));lastWriteTimeUtcTicks=$_.LastWriteTimeUtc.Ticks}}
    else{[ordered]@{path=$relative;kind='directory';lastWriteTimeUtcTicks=$_.LastWriteTimeUtc.Ticks}}
  })
  [ordered]@{exists=$true;entries=$entries}
}
function Invoke-Plan([string]$Script,[string[]]$PlanArguments,[string]$ShimPath){
  $originalPath=$env:PATH
  try {
    $env:PATH="$ShimPath$([IO.Path]::PathSeparator)$originalPath"
    $output=& powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File $Script @PlanArguments
    [pscustomobject]@{exitCode=$LASTEXITCODE;output=@($output)}
  } finally { $env:PATH=$originalPath }
}
try {
  $source=Join-Path $root 'source'; $managed=Join-Path $root 'managed'; $shim=Join-Path $root 'git-shim'
  New-Item -ItemType Directory -Path $source,$managed,$shim | Out-Null
  [IO.File]::WriteAllText((Join-Path $source 'fixture.txt'),'fixture',[Text.UTF8Encoding]::new($false))
  & git -C $source init -q; & git -C $source config user.email test@example.test; & git -C $source config user.name Test
  & git -C $source add fixture.txt; & git -C $source commit -qm fixture; & git -C $source remote add origin https://github.com/DanRJ/pi-web.git
  $head=(& git -C $source rev-parse HEAD).Trim()
  [IO.File]::WriteAllText((Join-Path $managed 'sentinel.txt'),'managed sentinel',[Text.UTF8Encoding]::new($false))
  # The child scripts get a test-only read-only Git descriptor. It supplies the remote proof while
  # the source index remains a real Git index whose bytes and mtime are fingerprinted below.
  $shimContent=@"
@echo off
if /I "%3"=="remote" (echo https://github.com/DanRJ/pi-web.git& exit /b 0)
if /I "%3"=="rev-parse" (echo $head& exit /b 0)
if /I "%3"=="ls-remote" (echo $head refs/heads/main& exit /b 0)
if /I "%3"=="status" exit /b 0
exit /b 1
"@
  [IO.File]::WriteAllText((Join-Path $shim 'git.cmd'),$shimContent,[Text.ASCIIEncoding]::new())
  $index=Join-Path $source '.git\index'
  $beforeIndex=Get-FileFingerprint $index; $beforeManaged=Get-TreeFingerprint $managed
  $bootstrap=Invoke-Plan -Script (Join-Path $PSScriptRoot 'bootstrap-local.ps1') -PlanArguments @('-Plan','-Root',$managed,'-SourceRoot',$source) -ShimPath $shim
  Assert-True ($bootstrap.exitCode -in @(0,4)) 'bootstrap Plan did not return its documented success/discovery status'
  $afterBootstrapIndex=Get-FileFingerprint $index; $afterBootstrapManaged=Get-TreeFingerprint $managed
  Assert-True (($beforeIndex|ConvertTo-Json -Compress) -eq ($afterBootstrapIndex|ConvertTo-Json -Compress)) 'bootstrap Plan changed source .git/index bytes or mtime'
  Assert-True (($beforeManaged|ConvertTo-Json -Depth 32 -Compress) -eq ($afterBootstrapManaged|ConvertTo-Json -Depth 32 -Compress)) 'bootstrap Plan changed the managed root'
  $deploy=Invoke-Plan -Script (Join-Path $PSScriptRoot 'deploy-local.ps1') -PlanArguments @('-Plan','-Root',$managed,'-SourceRoot',$source) -ShimPath $shim
  Assert-True ($deploy.exitCode -eq 2) 'deploy Plan without a supported bootstrap did not fail closed with prerequisite exit'
  $afterDeployIndex=Get-FileFingerprint $index; $afterDeployManaged=Get-TreeFingerprint $managed
  Assert-True (($beforeIndex|ConvertTo-Json -Compress) -eq ($afterDeployIndex|ConvertTo-Json -Compress)) 'deploy Plan changed source .git/index bytes or mtime'
  Assert-True (($beforeManaged|ConvertTo-Json -Depth 32 -Compress) -eq ($afterDeployManaged|ConvertTo-Json -Depth 32 -Compress)) 'deploy Plan changed the managed root'
  Write-Output 'LocalDeployment self-tests passed.'
} finally {if(Test-Path -LiteralPath $root){Remove-Item -LiteralPath $root -Force -Recurse}}
