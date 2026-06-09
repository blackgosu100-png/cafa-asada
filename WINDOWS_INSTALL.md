# Windows installer

This project can be installed as a local Windows app because YouTube transcript extraction needs the local server at `127.0.0.1:8787`.

## Build

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools\windows\build_windows_package.ps1
```

The build output is written to:

```text
dist\windows
```

## Install

Run:

```text
dist\windows\CafeAsadaInstaller.exe
```

The installer copies the app to:

```text
%LOCALAPPDATA%\CafeAsada
```

It also creates this desktop shortcut:

```text
카페 바이럴 원고 생성기.lnk
```

Opening the shortcut starts the local server and opens:

```text
http://127.0.0.1:8787/cafe_viral_generator.html
```

## Notes

- Node.js must be installed on the PC.
- YouTube transcript extraction uses the local Python runtime and the vendored `yt_dlp` / `imageio_ffmpeg` files.
- The GitHub Pages version is still useful for simple browser-only features, but local-only features need this installer or `start_cafe_generator.cmd`.
