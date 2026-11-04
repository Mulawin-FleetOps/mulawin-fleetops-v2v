@echo off
REM Script 1: create / check the user accounts through the Admin screens (login codes are typed by you).
REM Double-click this file, or run it from PowerShell inside the project folder. See guide H.
cd /d "%~dp0\.."
python automation\script1_init_accounts.py %*
pause
