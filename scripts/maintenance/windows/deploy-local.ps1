[CmdletBinding(DefaultParameterSetName='Plan')]
param(
  [Parameter(ParameterSetName='Plan', Mandatory=$true)][switch]$Plan,
  [Parameter(ParameterSetName='Apply', Mandatory=$true)][switch]$Apply,
  [Parameter(ParameterSetName='Rollback', Mandatory=$true)][switch]$Rollback,
  [string]$Root,
  [string]$SourceRoot,
  [string]$ToRelease,
  [switch]$ForceRestart,
  [switch]$IUnderstandThisStopsVerifiedPiWebLocalProcesses
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalDeployment.psm1') -Force
if([string]::IsNullOrWhiteSpace($SourceRoot)){$SourceRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path}
function Stop-WithCode([string]$Kind,[string]$Message){[Console]::Error.WriteLine($Message);exit (Get-DeploymentExitCode $Kind)}

if($Apply -or $Rollback){Stop-WithCode Prerequisite 'Deploy -Apply and -Rollback are unsupported and fail closed. No task, process, pointer, release, port, Tailscale, or global npm state was changed.'}
if($ForceRestart -or $IUnderstandThisStopsVerifiedPiWebLocalProcesses){Stop-WithCode Prerequisite 'Restart approval flags are unavailable because deployment mutation is unsupported.'}
$layout=Get-LocalDeploymentLayout $Root
try {
  $proof=Get-SourceProof $SourceRoot
  # A pre-existing install is deliberately not adopted. Reading it is validation only.
  $active=$null
  if([IO.File]::Exists($layout.Active)){$active=Get-ActiveRelease $layout.Root}
  $planPayload=New-ReadOnlyPlan 'deploy' $SourceRoot $proof $layout
  $planPayload | Add-Member -NotePropertyName bootstrapPresent -NotePropertyValue ($null -ne $active)
  $planPayload | Add-Member -NotePropertyName activeGeneration -NotePropertyValue $(if($null -eq $active){$null}else{$active.generation})
  $planPayload | ConvertTo-Json -Depth 10
  if($null -eq $active){Stop-WithCode Prerequisite 'No supported bootstrap exists. This build will not adopt a pre-existing or unmanaged install.'}
  Stop-WithCode Prerequisite 'Deployment mutation is unsupported and fails closed.'
} catch { Stop-WithCode Validation $_.Exception.Message }
