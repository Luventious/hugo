@echo off
rem 用默认可用的 Chromium 浏览器打开照片管理页（无需 Python / Node）
cd /d "%~dp0"

where msedge >nul 2>nul
if %errorlevel%==0 (
    start "" "msedge" "%~dp0index.html"
    goto :eof
)

if exist "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" (
    start "" "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" "%~dp0index.html"
    goto :eof
)

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "%~dp0index.html"
    goto :eof
)

echo 未找到 Edge 或 Chrome，请用 Chrome / Edge 手动打开 index.html
pause
