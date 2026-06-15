@echo off
set PROJ=%~dp0
cd /d %PROJ%
if not exist "%PROJ%logs" mkdir "%PROJ%logs"
echo [%DATE% %TIME%] FW start >> "%PROJ%logs\scheduler_fw.log"
py main.py --foodist-only >> "%PROJ%logs\scheduler_fw.log" 2>&1
set RESULT=%errorlevel%
if %RESULT% equ 0 (
    echo [%DATE% %TIME%] FW done [OK] >> "%PROJ%logs\scheduler_fw.log"
) else (
    echo [%DATE% %TIME%] FW done [FAILED exitcode=%RESULT%] >> "%PROJ%logs\scheduler_fw.log"
)