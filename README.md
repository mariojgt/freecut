# FreeCut

**[freecut.net](http://freecut.net/)**

**Edit videos. In your browser.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Discord](https://img.shields.io/badge/Discord-Join%20community-5865F2?logo=discord&logoColor=white)](https://discord.gg/aQtQ7NyUBd)

![FreeCut editor workspace](./public/assets/landing/main.png)

FreeCut is a browser-based, multi-track video editor. No install, no uploads:
projects and media stay local, while editing, preview, analysis, transcription,
AI generation, and export run in the browser through WebGPU, WebCodecs, Web
Workers, OPFS, and the File System Access API.

FreeCut writes projects, media metadata, copied media, thumbnails, waveforms,
generated AI assets, transcripts, scene cuts, and caches into one workspace.
Chromium browsers can use a folder you choose on disk; Firefox uses an
origin-private browser workspace, can import a read-only folder selection as a
private copy, and uses portable project bundles for backup.

This fork is maintained by [mariojgt](https://github.com/mariojgt) and builds on
the [original FreeCut project](https://github.com/walterlow/freecut). Upstream
copyright and MIT attribution are preserved in [LICENSE](LICENSE).

## User Guide

New to FreeCut? Start with the [user guide](https://freecut.net/docs).

## Community

Join the [FreeCut Discord](https://discord.gg/aQtQ7NyUBd) to share edits,
request features, report bugs, and give feedback on browser-based editing workflows.

## Screenshots

<table>
  <tr>
    <td width="50%">
      <strong>Timeline</strong><br />
      <img src="./public/assets/landing/timeline.png" alt="FreeCut multi-track timeline" width="100%" />
    </td>
    <td width="50%">
      <strong>Keyframes</strong><br />
      <img src="./public/assets/landing/dopesheet.png" alt="FreeCut dopesheet keyframe editor" width="100%" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Semantic scene search</strong><br />
      <img src="./public/assets/landing/semantic.png" alt="FreeCut semantic scene browser" width="100%" />
    </td>
    <td width="50%">
      <strong>Export</strong><br />
      <img src="./public/assets/landing/export.png" alt="FreeCut export dialog" width="100%" />
    </td>
  </tr>
  <tr>
    <td width="50%">
      <strong>Audio EQ</strong><br />
      <img src="./public/assets/landing/eq.png" alt="FreeCut audio EQ controls" width="100%" />
    </td>
    <td width="50%">
      <strong>Hotkeys</strong><br />
      <img src="./public/assets/landing/hotkeys.png" alt="FreeCut hotkey editor" width="100%" />
    </td>
  </tr>
</table>

## Features

### Timeline & Editing

- Multi-track timeline with video, audio, text, image, shape, mask, Lottie, and compound clip items
- Multiple timelines per project as Sequences with tabs, unified with compound clips (open a compound clip as its own sequence)
- Linked audio/video editing with split, join, ripple, rolling, slip, slide, and rate-stretch tools
- Cut-centered transitions with live resize, alignment, source-time anchoring, and preview overlays
- Track mute/visibility/lock controls, linked sync badges, track push/pull, and close-gap workflows
- Filmstrip thumbnails, stereo waveforms, snap guides, markers, timecode, and undo/redo
- Source monitor with mark in/out, patch destinations, insert edits, and overwrite edits
- Project templates, auto-match canvas/FPS from first media, and configurable keyboard shortcuts

### Preview & Playback

- Real-time preview with transform, crop, corner-pin, mask, and group gizmos
- Frame-accurate playback through FreeCut's custom `Clock` and composition runtime
- Fast scrub overlays, decoder prewarming, adaptive preview quality, and source warming
- Two-up and four-up edit panels for ripple, rolling, slip, and slide operations
- GPU color scopes: waveform, vectorscope, and histogram
- Separate project master bus and monitor/device volume

### Audio

- Clip volume, audio fades, track faders, master bus fader, and stereo LED meters
- Per-clip pitch shift in semitones/cents with SoundTouch preview playback
- Clip EQ and track EQ stages, including a compact six-band floating EQ panel
- Pitch, EQ, fades, volume, and transition audio paths are preserved in preview and export

### Effects, Masks & Compositing

All visual effects and compositing paths are WebGPU-first, with fallbacks where practical.

- **Blur:** gaussian, box, motion, radial, zoom
- **Color:** brightness, contrast, exposure, hue shift, saturation, vibrance, temperature/tint, levels, curves, color wheels, gradient map, LUT (`.cube`), grayscale, sepia, invert
- **Distortion:** pixelate, RGB split, twirl, wave, bulge/pinch, kaleidoscope, mirror, fluted glass, ripple glass, glass mosaic, droste
- **Stylize:** vignette, film grain, sharpen, posterize, glow, edge detect, scanlines, halftone, ASCII art, color glitch, block glitch, VHS, CRT, ink, pixel sort
- **Keying:** chroma key with tolerance, softness, and spill suppression
- 25 blend modes, including multiply, screen, overlay, soft light, difference, hue, saturation, color, and luminosity
- Clip masks and pen paths with keyframeable geometry transforms
- Color picker with hex and alpha input, plus an in-app eyedropper with loupe

### Transitions

- Fade, wipe, slide, 3D flip, clock wipe, and iris transitions with directional variants
- Dissolve, sparkles, glitch, light leak, pixelate, chromatic aberration, and radial blur
- Adjustable duration, alignment, source anchoring, and Canvas 2D fallback for non-WebGPU paths

### Keyframe Animation

- Bezier graph editor, dopesheet, split view, and multi-curve overlays
- Easing presets (linear, ease-in/out, cubic-bezier, spring) with a live-preview editor and saved custom presets
- Procedural motion modifiers (drift, sway, breath, spin, shake) evaluated at render time, with one-click bake to keyframes
- Motion text: per-character, per-word, and per-line text animation
- Auto-keyframe mode, tangent mirroring, property accordions, and marquee selection
- Animated transform, crop, mask, text, effect, and color properties

### Media & Import

- Import videos, audio, images, GIFs, SVGs, Lottie animations, and generated assets without copying originals
- Edit imported Lottie animations (`.json` and `.lottie`): remap colors and themes, edit text, and adjust value slots with live preview
- Apple ProRes decode for import, preview, and thumbnails, including variants browsers cannot natively decode
- Proxy generation, thumbnail extraction, waveform caching, and media relinking

### Local AI & Analysis

Runs on your machine — nothing is uploaded unless you deliberately configure a
non-local model endpoint.

- Plain-language editing assistant with review-before-apply timeline plans, validated bulk fades/transitions, styled titles, transforms, and exact timed cuts
- Selectable Qwen 3.5 and Gemma 4 assistants running in a WebGPU worker, cached after their first download
- OpenAI-compatible local model support for Ollama, LM Studio, and LocalAI
- On-device transcription with the Parakeet engine (Whisper fallback) and generated caption text items
- AI captioning with local vision-language providers and configurable sample cadence
- Scene detection with fast histogram or frame-accurate adaptive content analysis and optional model verification
- Scene Browser for searching captioned media and reusing detected moments
- Local Kokoro text-to-speech voiceovers
- Local MusicGen music generation with presets, progress, and cancellation
- Local model cache controls and unload controls in settings

### Projects & Storage

- Workspace folder persistence via the File System Access API on Chromium
- Firefox workspace persistence through the origin-private file system (OPFS)
- Multi-workspace switcher with known workspace management
- Projects stored as plain files on disk, with legacy browser-storage migration
- Project soft-delete, restore, empty-trash, and permanent delete flows
- Portable project ZIP bundle export/import with media copied into the active workspace
- Auto-save, project thumbnails, workspace cache mirroring, and orphan cleanup

### Export

- In-browser rendering through WebCodecs and worker-backed render paths
- Export any sequence, not just the main timeline
- **Video containers:** MP4, WebM, MOV, MKV
- **Video codecs:** H.264, H.265, VP8, VP9, AV1 (where the browser provides an encoder)
- **Audio export formats:** MP3, AAC, WAV/PCM
- **Subtitles:** off, burn-in, sidecar file, or embedded soft track (container-dependent)
- Quality presets from low to ultra, with runtime capability checks and fallbacks

## Quick Start

**Prerequisites:** Node.js 22+ recommended, npm 11+, and a current Chrome, Edge,
Brave, or Firefox release.

```bash
git clone https://github.com/mariojgt/freecut.git
cd freecut
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Chrome or Edge provides the
widest codec and GPU feature set; Firefox uses browser-private workspace storage.

### Workflow

1. Pick a workspace folder when prompted. In Firefox, start an empty browser workspace or import a copy of an existing FreeCut workspace folder.
2. Create a project from the projects page.
3. Import media by dragging files into the media library.
4. Drag clips to the timeline, then trim, arrange, add effects, transitions, masks, captions, and audio work.
5. Use the source monitor, keyframe editor, scene browser, AI tools, and preview overlays as needed.
6. Export directly from the browser.

## Browser Support

Chrome or Edge 113+ is recommended for the broadest WebGPU, WebCodecs, and
folder-access support. Firefox is supported through OPFS: projects and copied
media persist for this site, but Firefox cannot expose that workspace as a
normal writable folder on disk. Its folder chooser can import a directory tree,
but later edits stay in the private browser copy rather than syncing back to the
selected folder. Export a `.freecut.zip` project bundle for a portable backup.
GPU effects, local AI, preview, and export remain capability-dependent
because browsers and operating systems expose different WebGPU and codec sets.

### Brave

Brave may disable the File System Access API. To enable it:

1. Navigate to `brave://flags/#file-system-access-api`
2. Change the setting from **Disabled** to **Enabled**
3. Click **Relaunch** to restart the browser

## Local Editing Assistant

Open the editor's **AI** tab and choose **Assistant**. Pick a browser model from
the model menu: **Qwen 3.5 0.8B** is the fast default (~0.6 GB), **Gemma 4 E2B**
is the balanced option (~3.2 GB), and **Gemma 4 E4B** offers the best quality
(~5.0 GB). The selected text-only weights load in a worker through
Transformers.js/ONNX Runtime Web. The UI shows whole-model bytes and progress;
downloads can be cancelled or retried and remain in the browser cache after
completion. Inference runs through WebGPU without uploading the prompt or
project. FreeCut gives the model a compact timeline description and a strict
tool catalog; it validates the returned JSON plan and asks you to confirm before
applying it.

For more capable local models, choose **Local server (Ollama / LM Studio)** and
configure an OpenAI-compatible `/v1` endpoint and model name. For example, run
Ollama on `http://127.0.0.1:11434/v1` and use `qwen3:4b`. The local server must
allow browser requests from the FreeCut origin. Model files and assistant
settings are machine/browser state; project timelines and generated assets stay
in the workspace.

## Docker

Run the production browser app in a container:

```bash
docker compose up --build web
# open http://localhost:8080
```

The UI is still local-first: the workspace belongs to the browser using the
app, not to the static web container. Chrome/Edge can select a host folder;
Firefox uses its persistent OPFS workspace and can import an existing workspace
folder into that private storage.

Start an optional containerized Ollama server and pull a model:

```bash
docker compose --profile local-ai up -d ollama
docker compose exec ollama ollama pull qwen3:4b
```

Start the headless editing/render API against a selected host folder:

```bash
FREECUT_WORKSPACE=/absolute/path/to/workspace \
FREECUT_API_TOKEN=change-me \
docker compose --profile automation up --build -d headless
curl http://localhost:8787/health
```

The headless image defaults to `linux/amd64` because Google Chrome for Linux is
distributed for that architecture. Docker Desktop runs it through emulation on
Apple Silicon. Set `FREECUT_HEADLESS_PLATFORM` only when supplying a compatible
Chrome build for another architecture.

Ports bind to loopback by default. The health endpoint is public; all other API
routes require `Authorization: Bearer ...` when `FREECUT_API_TOKEN` is set.

### Opening FreeCut from another machine

FreeCut keeps projects in a workspace folder through the File System Access
API, falling back to OPFS. Browsers expose both only in a secure context, and
`http://<lan-ip>:8080` is not one: Chrome hides the APIs and the workspace gate
reports an unsupported browser even though the browser is perfectly capable.
Only `https://` and `localhost` qualify, which is why the same build works on
the Docker host but not from a second machine.

The `https` profile starts a Caddy front door that terminates TLS using its own
local certificate authority:

```bash
COMPOSE_PROFILES=https FREECUT_PUBLIC_HOST=192.168.1.50 docker compose up -d
# open https://192.168.1.50
```

Setting those two in `.env` makes it the default for every `up`.
`FREECUT_PUBLIC_HOST` has to match the address typed in the address bar,
because the certificate is issued for exactly that name. `FREECUT_HTTPS_PORT`
moves the listener off 443. The `web` container keeps its loopback-only HTTP
binding; the proxy reaches it over the Compose network.

The certificate is signed by Caddy's own CA, so the first visit warns. Clicking
through still produces a secure context and FreeCut works. To remove the
warning, copy the root certificate out and trust it on the client machine:

```bash
docker compose cp proxy:/data/caddy/pki/authorities/local/root.crt freecut-root.crt
```

On macOS, open it in Keychain Access under **System** and set it to **Always
Trust**; on Windows, import it into **Trusted Root Certification Authorities**.

Without the profile nothing changes: `docker compose up -d` starts no proxy and
binds no privileged port.

### Automatic updates from public releases

Publishing a stable GitHub Release with a semantic tag such as `v1.2.3` runs
`.github/workflows/release-docker.yml`. It validates the application and
publishes immutable web and headless images to GitHub Container Registry. The
web image supports `linux/amd64` and `linux/arm64`; the Chrome-based headless
image is `linux/amd64`. Prereleases are published but are not selected by the
automatic updater.

The Docker host checks GitHub's public `releases/latest` address every five
minutes. When the stable tag changes, it downloads the deployment files from
that tag, validates them, pulls the matching immutable images, and waits for
their health checks. A failed release is rolled back to the previous tag and is
retried at the next interval. No inbound SSH, GitHub deployment secret, or
Docker socket inside a container is required.

Managed Docker builds also show an **Update** button in the Projects header and
an update icon in the editor toolbar. One click writes a narrow request marker
to the host; a systemd path unit starts the same checked updater immediately.
The container receives neither the Docker socket nor permission to run host
commands.

GitHub makes new GHCR packages private initially. After the first workflow run,
make `ghcr.io/mariojgt/freecut` and `ghcr.io/mariojgt/freecut-headless` public.
Public packages can be checked and pulled anonymously. If they remain private,
run `docker login ghcr.io` once on the Docker host with a token limited to
`read:packages`.

After publishing the first stable release that contains these files, clone or
update the repository on the Linux Docker host and install the timer once:

```bash
sudo ./docker/install-auto-update.sh
systemctl list-timers freecut-update.timer
```

The installer copies only the production Compose and updater files into
`/opt/freecut`, enables the timer and in-app request watcher, and immediately
checks for the latest release. It also creates an empty, root-readable
`/opt/freecut/.env` without overwriting an existing one. Defaults run the
browser app on `127.0.0.1:8080`. Optional settings can be added with
`sudoedit /opt/freecut/.env`:

```env
FREECUT_WEB_PORT=8080
FREECUT_API_PORT=8787
FREECUT_WORKSPACE=/srv/freecut/workspace
FREECUT_MCP_OUTPUT=/srv/freecut/output
FREECUT_API_TOKEN=replace-with-a-long-random-token
```

Check immediately or inspect recent update logs with:

```bash
sudo systemctl start freecut-update.service
sudo journalctl -u freecut-update.service -n 100 --no-pager
```

To enable the optional headless/MCP service, start it once. Future releases
update it only while it is already running; Ollama is never changed:

```bash
cd /opt/freecut
sudo docker compose --env-file .env --env-file .freecut-release.env \
  -f docker-compose.production.yml --profile automation up -d --wait
```

Open FreeCut browsers check the served build every five minutes and whenever
the tab becomes visible. A user-initiated **Update** request checks every five
seconds for up to 30 minutes, then saves an open project and reloads the new
build automatically. Releases installed by the background timer retain the
existing **Save and reload** prompt so an unexpected deployment never interrupts
editing. After the one-time updater installation, the host needs no CLI or SSH
interaction.

## MCP Video Editing Server

The MCP server is a stdio bridge to the headless API. It can list/read/create
projects, update project settings, execute validated timeline operations, inspect
media and layout, grab frames, and render finished files. Persistent edits use
workspace writer locking and revision checks; `edit_project` defaults to a dry
run.

Open **MCP setup** from the Projects header (or visit `/mcp`, or use
**AI → MCP** inside the editor) and choose **Copy MCP config** for the Docker
client configuration below.

First start the headless container as above. Then configure an MCP client with:

```json
{
  "mcpServers": {
    "freecut": {
      "command": "docker",
      "args": ["exec", "-i", "freecut-headless", "node", "mcp/server.mjs"]
    }
  }
}
```

For a native checkout, run `npm run build`, start
`npm run headless:serve -- --workspace /absolute/path/to/workspace`, and use
`node /absolute/path/to/freecut/mcp/server.mjs` as the MCP command. Set
`FREECUT_API_URL`, `FREECUT_API_TOKEN`, and `FREECUT_MCP_OUTPUT_DIR` in the MCP
process environment when their defaults do not apply.

## Tech Stack

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite+](https://github.com/voidzero-dev/vite-plus) for dev, build, lint, format, check, and tests
- [Vite](https://vite.dev/) + [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react)
- [WebGPU](https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API) for effects, compositing, transitions, masks, scopes, and AI acceleration
- [WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) for preview and export pipelines
- [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API) + OPFS for workspace-backed persistence and caches
- [Zustand](https://github.com/pmndrs/zustand) + [Zundo](https://github.com/charkour/zundo) for state management and undo/redo
- [TanStack Router](https://tanstack.com/router) for file-based, type-safe routing
- [Tailwind CSS 4](https://tailwindcss.com/) + [Radix UI](https://www.radix-ui.com/) + shadcn-style components
- [Mediabunny](https://mediabunny.dev/) for media decoding, metadata, and audio encoding support
- [Transformers.js](https://huggingface.co/docs/transformers.js) for local browser AI models
- [Kokoro.js](https://www.npmjs.com/package/kokoro-js) for WebGPU text-to-speech
- Web Workers and AudioWorklets for heavy media processing off the main thread

## Development

Most commands are npm scripts backed by `vite-plus` (`vp`).

```bash
npm run dev                 # Dev server on port 5173
npm run build               # Production build
npm run preview             # Preview the production build
npm run perf                # Build + serve a production-like perf target

npm run lint                # Oxlint through Vite+
npm run format              # Oxfmt
npm run test:run            # Run the test suite once (npm run test to watch)
npm run verify              # Full gate: static/arch/unit/build + portable headless contracts
npm run headless:test       # Build once, then run the complete portable headless suite
npm run mcp:test            # MCP protocol and API-client contracts

npm run routes              # Regenerate the TanStack Router route tree
```

`npm run verify` runs the complete quality gate, including architecture and
dead-code checks scoped to the current diff, all Node headless contracts, the
built-harness Chrome regression, every public edit operation, and generated
media/audio rendering. Real-GPU effects remain an explicit operator/release
gate because hosted PR CI does not provide a portable WebGPU adapter.

### Performance Checks

- `npm run dev` is best for correctness and iteration, but includes React/Vite dev overhead, HMR, and debug instrumentation.
- `npm run perf` is the better check for real playback or rendering performance because it serves a production build locally.
- `npm run dev:quiet` keeps HMR while hiding the editor debug panel.
- `npm run dev:compare` starts `http://localhost:5173` and `http://localhost:4173` together for side-by-side dev vs production-like checks.

### Environment

```env
VITE_SHOW_DEBUG_PANEL=true   # Show debug panel in dev
```

## Project Structure

The `src/` tree is organized into a few layers:

- **`features/`** — user-facing UI modules (editor, timeline, preview, media library, effects, keyframes, export, projects, settings, scene browser, and more)
- **`runtime/`** — playback and rendering engines (composition runtime, player, clock) that are not user-facing UI
- **`infrastructure/`** — platform adapters for GPU (effects, transitions, compositor, masks, text, scopes), analysis, audio, browser, storage, and thumbnails
- **`shared/`** — framework-agnostic primitives and cross-feature state (transition engine, schema migrations, Zustand stores, utils)
- **`app/`, `components/`, `config/`, `routes/`, `types/`** — bootstrap, shadcn/ui components, configuration, file-based routes, and shared types

Feature modules use their local `deps/` adapters for cross-feature imports.
Platform-coupled code (GPU, ML, audio, storage, browser) lives in
`@/infrastructure/*` and is imported directly; there is no separate `lib/`
layer.

## Contributing

FreeCut welcomes contributions that match the current priorities.

Current development priorities, in order:

1. Bug fixes across FreeCut.
2. Performance improvements for the live editor and playback, plus faster exports.
3. New features that have been discussed first.

- **Report bugs:** [open an issue](https://github.com/mariojgt/freecut/issues/new?template=bug_report.yml) with reproducible steps, your browser version, and screenshots or recordings
- **Report performance problems:** include the editing or export workflow, source media details, project size, and when the slowdown begins
- **Discuss feature ideas:** join the [FreeCut Discord](https://discord.gg/aQtQ7NyUBd) or [start a GitHub Discussion](https://github.com/mariojgt/freecut/discussions) before implementation. New features may be considered, but bug fixes and performance work take priority

## License

[MIT](LICENSE)
