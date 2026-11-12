@echo off
rem Double-click to start Modulyt. Close this window (or press Ctrl+C) to stop it.
cd /d "%~dp0"
py -m pip install -q -r requirements.txt
py modulyt.py %*
pause
