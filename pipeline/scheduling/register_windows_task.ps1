<#
.SYNOPSIS
  Registers (or removes) the hourly Windows Task Scheduler job that runs the orbit update.

.DESCRIPTION
  Creates a task named "Atmospheric Perspective - orbit update" that runs
      uv run --directory <repo>\pipeline python -m ap_pipeline.orbits.run_orbit_update
  once an hour at 17 minutes past, starting today, only when the network is available.
  The task itself is dumb: the pipeline decides internally whether anything may be fetched
  (CelesTrak's one-download-per-two-hour rule), so running hourly is safe by design.
  Output goes to data\logs\orbits.log; the last run's summary is data\orbits\last-run.json.

.USAGE
  powershell -ExecutionPolicy Bypass -File pipeline\scheduling\register_windows_task.ps1
  powershell -ExecutionPolicy Bypass -File pipeline\scheduling\register_windows_task.ps1 -Remove
  powershell -ExecutionPolicy Bypass -File pipeline\scheduling\register_windows_task.ps1 -Status
#>
param(
  [switch]$Remove,
  [switch]$Status
)

$TaskName = "Atmospheric Perspective - orbit update"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$PipelineDir = Join-Path $Root "pipeline"

if ($Status) {
  $t = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if (-not $t) { Write-Output "not registered"; exit 0 }
  $i = $t | Get-ScheduledTaskInfo
  Write-Output ("state={0}  last_run={1}  last_result={2}  next_run={3}" -f $t.State, $i.LastRunTime, $i.LastTaskResult, $i.NextRunTime)
  exit 0
}

if ($Remove) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output "removed: $TaskName"
  exit 0
}

$uv = (Get-Command uv -ErrorAction SilentlyContinue).Source
if (-not $uv) {
  $uv = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe\uv.exe"
}
if (-not (Test-Path $uv)) { throw "uv not found; install it first (winget install astral-sh.uv)" }

$action = New-ScheduledTaskAction -Execute $uv `
  -Argument "run --directory `"$PipelineDir`" python -m ap_pipeline.orbits.run_orbit_update" `
  -WorkingDirectory $PipelineDir

# Hourly at :17, indefinitely. (Any minute works; :17 avoids the top-of-hour rush.)
$start = (Get-Date).Date.AddHours((Get-Date).Hour).AddMinutes(17)
if ($start -lt (Get-Date)) { $start = $start.AddHours(1) }
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 1)

$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -RunOnlyIfNetworkAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description "Atmospheric Perspective: fetch CelesTrak element sets (paced to their 2-hour windows), validate, build the orbit snapshot, archive daily." `
  -Force | Out-Null

Write-Output "registered: $TaskName"
Write-Output "  runs   : hourly at :17 from $start"
Write-Output "  command: $uv run --directory `"$PipelineDir`" python -m ap_pipeline.orbits.run_orbit_update"
Write-Output "  log    : $Root\data\logs\orbits.log"
