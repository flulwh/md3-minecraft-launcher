@echo off
chcp 65001 >nul
title Minecraft Launcher

:: Proxy (Clash default 7890)
set HTTP_PROXY=http://127.0.0.1:7890
set HTTPS_PROXY=http://127.0.0.1:7890

echo =====================================
echo Minecraft Launcher - One Click Start
echo =====================================
echo Proxy: %HTTP_PROXY%
echo.

:: Check Java 17+
java -version 2>&1 | findstr /r /c:"version \"1[789]\." /c:"version \"2[0-9]\." >nul
if %errorlevel% equ 0 (
    echo [OK] Java 17+ detected
) else (
    echo [WARN] Java 17+ NOT found (required for Forge 1.20.1+)
    echo        Install: https://adoptium.net/temurin/releases/?version=17
    echo.
)

set ROOT=%~dp0
set BACKEND=%ROOT%backend
set FRONTEND=%ROOT%frontend

echo [1/2] Starting backend...
start "MC-Launcher-Backend" cmd /k "cd /d "%BACKEND%" && corepack pnpm dev"

:: Wait for backend
timeout /t 3 >nul

echo [2/2] Starting frontend...
start "MC-Launcher-Frontend" cmd /k "cd /d "%FRONTEND%" && corepack pnpm dev"

echo.
echo =====================================
echo Started!
echo Backend: http://127.0.0.1:8787
echo Frontend: http://127.0.0.1:5173 (Electron window opens)
echo =====================================
echo Close the two windows titled "MC-Launcher-*" to stop.
echo.
pause