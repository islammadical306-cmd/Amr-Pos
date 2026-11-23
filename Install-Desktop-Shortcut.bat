@echo off
title AmarPOS Desktop Shortcut Creator
echo ===================================================
echo     Creating AmarPOS Desktop Shortcut on PC...
echo ===================================================
powershell -NoProfile -Command "$ws = New-Object -ComObject WScript.Shell; $d = [System.IO.Path]::Combine([System.Environment]::GetFolderPath('Desktop'), 'AmarPOS.lnk'); $s = $ws.CreateShortcut($d); if (Test-Path 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') { $s.TargetPath = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'; } else { $s.TargetPath = 'msedge.exe'; }; $s.Arguments = '--app=http://localhost:3000'; $s.Description = 'AmarPOS Smart AI Desktop App'; $s.Save(); Write-Host 'Desktop shortcut AmarPOS created successfully!'"
echo.
echo AmarPOS shortcut is now on your Windows Desktop!
timeout /t 3
exit
