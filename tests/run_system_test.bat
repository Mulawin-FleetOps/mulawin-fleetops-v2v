@echo off
REM Mulawin FleetOps automated system test. TEST COPY ONLY.
REM Double-click this file, or run it from PowerShell inside the project folder.
cd /d "%~dp0\.."
python tests\system_test.py
pause
