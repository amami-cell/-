@echo off
set PROJ=%~dp0
cd /d %PROJ%
if not exist "%PROJ%logs" mkdir "%PROJ%logs"

for /f "usebackq" %%m in (`py -c "import datetime; t=datetime.date.today(); m=t.month-1 or 12; y=t.year-(1 if t.month==1 else 0); print(str(y)+'-'+str(m).zfill(2))"`) do set PREV_MONTH=%%m

echo [%DATE% %TIME%] FW取得開始: 対象月=%PREV_MONTH% >> "%PROJ%logs\scheduler_fw.log"
py main.py --foodist-only --month %PREV_MONTH% >> "%PROJ%logs\scheduler_fw.log" 2>&1
set RESULT=%errorlevel%
if %RESULT% equ 0 (
    echo [%DATE% %TIME%] FW取得完了 [成功] >> "%PROJ%logs\scheduler_fw.log"
) else (
    echo [%DATE% %TIME%] FW取得完了 [失敗 exitcode=%RESULT%] >> "%PROJ%logs\scheduler_fw.log"
)
