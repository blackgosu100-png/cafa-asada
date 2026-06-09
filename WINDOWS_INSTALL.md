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

## First-run setup

Open **API 키 설정** in the app.

For local CLI use:

- Select `Codex Local` when the user has Codex CLI installed and logged in.
- Select `Claude CLI` when the user has Claude CLI installed and logged in.
- Set the CLI path or command in the local CLI settings section.

For browser API use:

- Select `Claude API` or `Google Gemini`.
- Enter the user's own API key.

For a different community or product category, edit the personalization fields:

- `커뮤니티/채널명`: for example `맘카페`, `지역 육아카페`, `아프니까 사장이다`
- `판매자/상품군`: for example `육아용품 브랜드`, `주방용품 업체`
- `읽는 사람`: for example `30대 육아맘`, `자영업 사장님`
- `채널별 말투/금지사항`: channel-specific tone and safety rules
- title/body/fact-guard custom prompts

## Notes

- Node.js must be installed on the PC.
- Codex Local requires Codex CLI installed and logged in on that PC.
- Claude CLI requires Claude CLI installed and logged in on that PC.
- YouTube transcript extraction uses the local Python runtime and the vendored `yt_dlp` / `imageio_ffmpeg` files.
- The GitHub Pages version is still useful for simple browser-only features, but local-only features need this installer or `start_cafe_generator.cmd`.
