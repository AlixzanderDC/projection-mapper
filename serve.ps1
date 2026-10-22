# Starts the local server and opens the control window.
# Keep this window open while running a show. Ctrl+C stops it.
Set-Location $PSScriptRoot
$port = 8765
$url = "http://127.0.0.1:$port/"

if (Get-Command python -ErrorAction SilentlyContinue) { $py = @('python') }
elseif (Get-Command py -ErrorAction SilentlyContinue) { $py = @('py', '-3') }
else {
  Write-Host "Python 3 was not found. Install it from https://www.python.org/downloads/ (tick 'Add to PATH'), then run this again." -ForegroundColor Yellow
  Read-Host "Press Enter to close"
  exit 1
}

# Open the browser once the server has had a moment to start.
Start-Process powershell -WindowStyle Hidden -ArgumentList "-Command", "Start-Sleep -Seconds 1; Start-Process '$url'"

Write-Host "Projection mapper: $url   (Ctrl+C to stop)" -ForegroundColor Cyan
& $py[0] $py[1..($py.Length)] "$PSScriptRoot\serve.py" $port
