@echo off
echo Fechando instancias anteriores...
taskkill /f /im electron.exe 2>nul
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul
echo Iniciando Graph Explorer...
node_modules\.bin\electron.cmd .
pause
