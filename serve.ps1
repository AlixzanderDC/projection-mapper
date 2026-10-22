# Starts the local server and opens the control window.
# Keep this window open while running a show.
Set-Location $PSScriptRoot
$port = 8765
Start-Process "http://127.0.0.1:$port/"
python "$PSScriptRoot\serve.py" $port
