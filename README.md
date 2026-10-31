<div align="center">

# subvid.app

**Generate, edit, translate, and export subtitles for any video or audio — entirely in your browser.**

No uploads. No backend. No API keys.

<a href="https://subvid.app">🌐 Live site</a> ·
<a href="https://github.com/midudev/subvid.app">📦 Repository</a> ·
<a href="#getting-started">🚀 Getting started</a>

<br />

<img width="900" alt="subvid.app — subtitle editor with timeline and live preview" src="https://github.com/user-attachments/assets/6a4463ce-9cf7-4053-a193-97104080b6a7" />

<br />
<br />

[![Astro](https://img.shields.io/badge/Astro-7-FF5D01?logo=astro&logoColor=white)](https://astro.build)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-38BDF8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Whisper](https://img.shields.io/badge/AI-Whisper-412991?logo=openai&logoColor=white)](https://huggingface.co/Xenova/whisper-base)
[![Static site](https://img.shields.io/badge/Deploy-Static%20hosting-4B5563)](#deployment)

</div>

## What it does

1. **Upload a video or audio** — drag & drop or browse. Supports MP4, MOV, WebM, MKV, MP3, WAV, and OGG.
2. **Configure languages** — pick the audio language (or auto-detect) and the subtitle language.
3. **Generate subtitles** — Whisper transcribes the audio; NLLB translates when needed.
4. **Edit in the timeline** — fix text, timing, and styling with undo/redo.
5. **Export** — download an `.srt` file or a new video with burned-in captions (video files only).

Everything runs client-side. Your files never leave your device.

## Features

- **AI transcription** — [Whisper](https://huggingface.co/Xenova/whisper-base) via [transformers.js](https://huggingface.co/docs/transformers.js), with optional WebGPU acceleration.
- **AI translation** — [NLLB-200](https://huggingface.co/Xenova/nllb-200-distilled-600M) for multilingual subtitle tracks.
- **Subtitle editor** — segment list, timeline scrubbing, multi-language tracks, caption presets (font, color, background, outline, position).
- **Export options**
  - `.srt` subtitle file
  - MP4 with hard-coded subtitles (WebCodecs + [mediabunny](https://github.com/Vanilagy/mediabunny) when available; canvas + MediaRecorder as fallback)
- **Internationalization** — English (default) and Spanish, with static pages per locale.
- **Offline-friendly models** — AI weights are downloaded once and cached in the browser (IndexedDB).
- **Audio-only mode** — upload MP3, WAV, or OGG files to generate subtitle files without needing video.

## Tech stack

| Layer | Technology |
| --- | --- |
| Framework | [Astro 7](https://astro.build) (static site) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) |
| Speech recognition | [@xenova/transformers](https://www.npmjs.com/package/@xenova/transformers) (Whisper) |
| Translation | transformers.js (NLLB-200) |
| Audio extraction | [@ffmpeg/ffmpeg](https://ffmpegwasm.netlify.app) (WASM) |
| Video export | [mediabunny](https://www.npmjs.com/package/mediabunny) + WebCodecs |
| Deployment | Static assets in `dist/` (any static host) |

## Requirements

- **Node.js** ≥ 22.12.0
- **pnpm** (recommended package manager for this repo)

For end users, a modern Chromium-based browser (Chrome, Edge, Brave) or Firefox is recommended. Safari works but WebCodecs export may fall back to the slower MediaRecorder path.

## Getting started

```sh
# Clone the repository
git clone https://github.com/midudev/subvid.app.git
cd subvid.app

# Install dependencies
pnpm install

# Start the dev server (http://localhost:4321)
pnpm dev
```

The app builds as a fully static site, so it runs on any OS with Node.js 22.12+ (including macOS 12). The first transcription/translation downloads the selected model weights to the browser cache.

On the supplied Mac, double-click `launch-subvid.command` (or the `ESTUDIO VIDEO EDIT.command` alias on the Desktop) to start local development and open the app in the browser.

## Multi-video projects

Add two or more videos to open the production desk. Each row has its own subtitle text, language, trim, manual cuts, and editor snapshot; the editor state is restored when switching between videos. The project queue transcribes one video at a time. Choose SRT output or MP4 + SRT; project downloads can be packaged as a store-only ZIP, with individual downloads as the memory-limit fallback. A single file keeps the existing upload → config → editor flow.

## CLI batch processing

For an unattended folder workflow, install FFmpeg on the machine and use the CLI:

```sh
pnpm batch -- --input ./videos --output ./subtitles --model tiny --language es --watch
```

The CLI accepts a project manifest (`--manifest project.json`) with `{"version":1,"videos":[{"file":"clip.mp4","trim":{"start":2,"end":18},"manualCuts":[{"start":5,"end":7}],"styleOverride":{}}]}` as well as directory input. Use `--trim START-END`, repeatable `--cut START-END`, `--style style.json`, and `--render-video` to apply edits and render a subtitled video. Speech models support `--model tiny|base|small` and `--language es`; optional translation uses `--translate-to es` and `--source-language en`. Media is processed locally, model weights are cached in `~/.cache/subvid/models`, and existing output files are preserved.

The editor also supports adding subtitle cues and independent text overlays, splitting/merging transcript lines, optional alignment to nearby speech edges, custom style presets, vertical/square framing, horizontal crop, watermark text, and deterministic subtitle review hints. Speech-edge alignment is a timing aid and should be reviewed for music or noisy audio.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Start Astro dev server at `localhost:4321` |
| `pnpm build` | Build the production site to `./dist/` |
| `pnpm preview` | Preview the production build locally |
| `pnpm batch -- [options]` | Transcribe a folder locally; see Batch processing above |

## Project structure

```text
src/
├── components/       # Astro UI (upload, config, editor, export modal, …)
├── i18n/ui.ts        # Translations (en, es) — server + client strings
├── layouts/          # HTML shell, hreflang, meta tags
├── pages/            # Routes: / (en), /es/ (es)
├── scripts/
│   ├── app.ts        # Main client logic (state, transcription, export)
│   ├── transcriber.worker.ts  # Web Worker for AI models
│   └── dom.ts        # DOM helpers
└── styles/           # Global and app-specific CSS
```

The app is a multi-stage SPA embedded in static Astro pages. Build-time copy lives in `src/i18n/ui.ts`; runtime strings for the active locale are injected into `window.__I18N__` so only one language ships per page.

## Architecture notes

- **Main thread** — UI, video playback, timeline, FFmpeg orchestration, export rendering.
- **Transcriber worker** — loads Whisper/NLLB and runs inference off the main thread so the UI stays responsive.
- **FFmpeg worker** — extracts audio from the uploaded video before transcription.
- **Model downloads** — fetched from Hugging Face on first use (~150 MB for Whisper base + translation model). Progress is shown in the status dock; models can be cleared from the downloads panel.

### Browser capabilities

| Capability | Used for |
| --- | --- |
| WebGPU | Faster Whisper inference (when supported) |
| WebCodecs | Fast MP4 export with burned-in subtitles |
| SharedArrayBuffer / cross-origin isolation | Required by FFmpeg WASM in some environments |

## Deployment

The site is a plain static build. Generate it with:

```sh
pnpm build
```

Then upload the contents of `dist/` to any static host (Netlify, Vercel, GitHub Pages, Cloudflare Pages, S3, or a local web server). No Cloudflare account, Wrangler, or server runtime is required.

## Adding a language

1. Add the locale code to `i18n.locales` in `astro.config.mjs`.
2. Create `src/pages/<code>/index.astro` (copy `src/pages/es/index.astro`).
3. Add a translation block in `src/i18n/ui.ts` mirroring the English keys.
4. Register the display name in `languages` inside `src/i18n/ui.ts`.

## Privacy

subvid.app is designed around local-first processing:

- Videos are read from disk via the File API — never uploaded.
- AI models run in Web Workers with WASM/WebGPU.
- No analytics backend or user accounts in this codebase.

## License

See the repository for license details.

## Author

Built by [midudev](https://midu.dev) and [Contributors](https://github.com/midudev/subvid.app/graphs/contributors).
