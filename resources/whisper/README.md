# Whisper (script–audio alignment)

Script-to-audio matching uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp) locally.

## Quick setup (Windows)

From the project root:

```bash
npm run install:whisper
```

This downloads into this folder:

- `Release/whisper-cli.exe` — transcription binary (with required DLLs)
- `ggml-large-v3.bin` — large multilingual model (~3.1 GB)

The app prefers models in this order if multiple are present:

1. `ggml-large-v3.bin`
2. `ggml-large-v3-turbo.bin`
3. `ggml-medium.en.bin`
4. `ggml-base.en.bin`

## Manual setup

1. Download [whisper-bin-x64.zip](https://github.com/ggml-org/whisper.cpp/releases/latest) and copy `whisper-cli.exe` here.
2. Download [ggml-large-v3.bin](https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin) here.

These files are bundled into packaged builds via `electron-builder` `extraResources`.
