# Silence Editor

Professional desktop audio editor for intelligent silence removal. Built with Electron, React, FFmpeg, and optional Silero VAD.

## Features

- Import WAV, MP3, FLAC, M4A, OGG, AAC via drag-and-drop or file dialog
- Multi-resolution waveform timeline with zoom, pan, playhead scrubbing, and selection
- Hybrid silence detection: traditional threshold analysis + AI voice-activity detection
- Full customization: dB threshold, min duration, padding, crossfade, frequency band, attack/release, VAD sensitivity
- Manual editing: split, delete, undo/redo, ripple delete, region toggle
- Preview non-silence playback before export
- Export to WAV, MP3, or FLAC with crossfade joins

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Space | Play / Pause |
| S / Ctrl+B | Split at playhead |
| Delete | Delete selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo |
| Ctrl+O / Ctrl+E | Open / Export |
| [ / ] | Previous / next silence region |
| Ctrl+ + / Ctrl+ - | Zoom in / out |
| L | Loop selection |
| Alt+Drag | Select region |
| Shift+Drag | Pan timeline |

## Setup

```bash
npm install
npm run dev
```

## Optional: Silero VAD Model

For best AI detection, download the Silero VAD ONNX model and place it at:

```
resources/models/silero_vad.onnx
```

Download from [snakers4/silero-vad](https://github.com/snakers4/silero-vad). Without the model, AI modes fall back to energy-based VAD.

## Build

```bash
npm run build
npm run preview
```

## Stack

- Electron + electron-vite
- React 19 + TypeScript + Tailwind CSS
- FFmpeg (ffmpeg-static) for decode/export
- ONNX Runtime (optional Silero VAD)
- Zustand for state management

## License

MIT. FFmpeg is used under its respective license when exporting audio.
