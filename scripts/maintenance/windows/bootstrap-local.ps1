[CmdletBinding(DefaultParameterSetName='Plan')]
param(
  [Parameter(ParameterSetName='Plan', Mandatory=$true)][switch]$Plan,
  [Parameter(ParameterSetName='Apply', Mandatory=$true)][switch]$Apply,
  [string]$Root,
  [string]$SourceRoot
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'LocalDeployment.psm1') -Force
if ([string]::IsNullOrWhiteSpace($SourceRoot)) { $SourceRoot=(Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path }

function Stop-WithCode([string]$Kind,[string]$Message) { [Console]::Error.WriteLine($Message); exit (Get-DeploymentExitCode $Kind) }
function Get-UnmanagedBlockers {
  $blockers=@()
  foreach($port in @(8504,8506)) { $owners=@(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique); if($owners.Count -gt 0){$blockers += "port $port is occupied by unmanaged PID(s): $($owners -join ', ')"} }
  $tailscale=Get-Service -Name Tailscale -ErrorAction SilentlyContinue; if($null -ne $tailscale -and $tailscale.Status -eq 'Running'){$blockers += 'Tailscale is running; this unsupported installer will not alter it.'}
  $blockers
}

if($Apply) { Stop-WithCode Prerequisite 'Bootstrap -Apply is unsupported and fails closed. No task, process, port, Tailscale, or global npm state was changed.' }
$layout=Get-LocalDeploymentLayout $Root
try { $proof=Get-SourceProof $SourceRoot; $planPayload=New-ReadOnlyPlan -Kind 'bootstrap' -SourceRoot $SourceRoot -SourceProof $proof -Layout $layout; $blockers=@(Get-UnmanagedBlockers); $planPayload | Add-Member -NotePropertyName unmanagedBlockers -NotePropertyValue $blockers; $planPayload | ConvertTo-Json -Depth 10; if($blockers.Count -gt 0){exit (Get-DeploymentExitCode Busy)}; exit 0 }
catch { Stop-WithCode Validation $_.Exception.Message }
