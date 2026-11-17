# Keeps the catalog pipeline running. Launched by the "SillajukuPipeline" scheduled task
# (see README START HERE), never as a Claude background task: the 10-14, 11-11 and 11-16
# outages were all the pipeline dying with whatever process launched it.
#
# Restarts the pipeline 60s after any exit. To stop it for good:
#   New-Item scripts\data\pipeline.stop      (the runner exits at the next restart check)
#   then Stop-ScheduledTask SillajukuPipeline, or kill the node pipeline process.
# Delete scripts\data\pipeline.stop before starting it again.

$ErrorActionPreference = 'Continue'
$web = Split-Path -Parent $PSScriptRoot
Set-Location $web
$log = Join-Path $web 'scripts\data\pipeline-live.log'
$stop = Join-Path $web 'scripts\data\pipeline.stop'
$flags = '--no-embed --no-qc'

function Write-Log($msg) {
  Add-Content -Path $log -Encoding utf8 -Value "=== runner $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') - $msg"
}

while ($true) {
  if (Test-Path $stop) { Write-Log 'stop file present, runner exiting'; break }
  Write-Log "starting pipeline ($flags)"
  $p = Start-Process -FilePath 'cmd.exe' -WindowStyle Hidden -PassThru -Wait `
    -ArgumentList "/c npx tsx --env-file=.env.local scripts/pipeline.ts $flags >> scripts\data\pipeline-live.log 2>&1"
  Write-Log "pipeline exited (code $($p.ExitCode)); restarting in 60s unless scripts\data\pipeline.stop exists"
  Start-Sleep -Seconds 60
}
