# Meeting Scribe

Record meetings, transcribe with cloud STT, summarize with LLM, and auto-generate structured meeting notes — all within Obsidian.

## Features

- **One-click recording** — Start/stop with a ribbon icon, status bar click, or keyboard shortcut
- **Cloud STT transcription** — OpenAI Whisper (GPT-4o-mini-transcribe, GPT-4o-transcribe with diarization)
- **LLM summarization** — OpenAI or Anthropic Claude generate structured meeting summaries
- **Auto-generated notes** — Markdown notes with YAML frontmatter, tags, and transcript
- **Fire and Forget** — Stop recording and the entire pipeline runs in the background
- **Import audio files** — Process existing audio files from your vault
- **Guided onboarding** — API key validation, test recording, step-by-step setup
- **Accessible** — WCAG AA compliant: keyboard navigation, screen reader support, reduced motion

## How It Works

1. Press the ribbon icon or use the command palette to **start recording**
2. **Stop recording** when your meeting ends
3. The plugin automatically processes your audio:
   - Transcribes speech to text via cloud STT
   - Summarizes the transcript with an LLM
   - Generates a structured meeting note in your vault
4. A notification appears — click to open your completed note

## Setup

1. Install the plugin from Obsidian Community Plugins
2. The settings tab opens automatically on first install
3. Enter your API keys:
   - **STT**: [OpenAI API key](https://platform.openai.com/api-keys)
   - **LLM**: [OpenAI](https://platform.openai.com/api-keys) or [Anthropic](https://console.anthropic.com/settings/keys) API key
4. Click **Run Test** to verify your setup
5. You're ready to record!

## BYOK (Bring Your Own Key)

This plugin uses your own API keys — no intermediary servers, no subscriptions. Audio is sent directly from your device to the API provider. Your data stays between you and the provider.

## Commands

| Command | Description |
|---------|-------------|
| Meeting Scribe: Start recording | Begin audio recording |
| Meeting Scribe: Stop recording | Stop recording and start processing |
| Meeting Scribe: Toggle recording | Start or stop recording |
| Meeting Scribe: Import audio file | Process an existing audio file |

## Settings

- **STT/LLM Provider & Model** — Choose your preferred provider and model
- **STT/LLM Language** — Set transcription and summary language
- **Output folders** — Configure where notes and audio files are saved
- **Audio retention** — Keep or delete audio after processing
- **Include transcript** — Optionally include the full transcript in generated notes

## Requirements

- Obsidian v0.15.0+
- OpenAI API key (for STT)
- OpenAI or Anthropic API key (for LLM summarization)
- Microphone access (for recording; not needed for audio import)

## License

[MIT](LICENSE)
