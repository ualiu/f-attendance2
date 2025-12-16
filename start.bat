@echo off
echo ================================================
echo  Felton Brushes AI Attendance System
echo ================================================
echo.

REM Check if node_modules exists
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

REM Check if .env exists
if not exist ".env" (
    echo Creating .env file from template...
    copy .env.example .env
    echo Please edit .env file with your configuration
    echo.
)

echo Starting server...
echo.
echo Dashboard will be available at: http://localhost:3000
echo First time? Visit: http://localhost:3000/create-admin
echo.

npm run dev
