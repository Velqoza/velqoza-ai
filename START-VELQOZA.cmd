@echo off
cd /d "%~dp0"
echo Starting VELQOZA AI...
if not exist "node_modules\.bin\tsc.cmd" (
  echo Installing libraries for first launch...
  call npm.cmd install
  if errorlevel 1 goto :fail
)
echo Starting development frontend and backend...
call npm.cmd run dev
goto :eof
:fail
echo Setup failed. Check the error above.
pause
