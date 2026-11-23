@echo off
title AmarPOS Smart AI Desktop Launcher
echo ===================================================
echo     AmarPOS Smart AI - Desktop Application
echo ===================================================
echo Launching AmarPOS in standalone native desktop mode...
start msedge --app=http://localhost:3000 || start chrome --app=http://localhost:3000 || start http://localhost:3000
exit
