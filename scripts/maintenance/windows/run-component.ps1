[CmdletBinding()]
param(
  [Parameter(Mandatory)][ValidateSet('sessiond','web')][string]$Component,
  [string]$Root,
  [int]$SessiondPort = 8504,
  [int]$WebPort = 8506
)
Set-StrictMode -Version Latest
[Console]::Error.WriteLine('PiWebLocal component runner is unsupported and fails closed; it will not launch a process.')
exit 2
