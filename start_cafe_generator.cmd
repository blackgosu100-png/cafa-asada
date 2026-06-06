@echo off
cd /d "%~dp0"
"C:\Program Files\nodejs\node.exe" "%~dp0codex_local_server.js" > "%~dp0codex_local_server.out.log" 2> "%~dp0codex_local_server.err.log"
