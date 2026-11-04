@echo off
REM Script 2: demonstrates every objective through the real screens. Run Script 1 first. See guides H and J.
REM Add --headed to watch the browser, e.g.  run_script2.bat --headed --slow 250
cd /d "%~dp0\.."
python automation\script2_demo.py %*
pause
