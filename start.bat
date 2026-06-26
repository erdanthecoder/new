@echo off
title KidWorld

echo.
echo  ==========================================
echo   KidWorld - Starting up...
echo  ==========================================
echo.

:: Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Python is not installed!
    echo.
    echo  Please download and install Python from:
    echo  https://www.python.org/downloads/
    echo.
    echo  Make sure to tick "Add Python to PATH"
    echo  during installation!
    echo.
    pause
    exit /b 1
)

:: Install Flask if needed
echo  Installing requirements...
pip install flask --quiet

echo.
echo  Starting KidWorld...
echo  Opening http://localhost:5000
echo.

:: Open browser after 2 seconds
start "" timeout /t 2 /nobreak >nul & start http://localhost:5000

:: Start server
python server.py

pause
