# Project Conventions

## Code Patterns (MUST follow)

- **Defensive copy on public getters** — Any class that stores state internally (SessionManager, StateManager, etc.) must return copies from public methods, including nested objects and arrays: `{ ...obj, pipeline: { ...obj.pipeline }, completedSteps: [...obj.pipeline.completedSteps] }`
- **String replacement: `split/join`** — Never use `replaceAll()`. Obsidian's environment may not support it. Use `str.split(search).join(replace)` instead.
- **File I/O: `vault.adapter.read/write`** — For raw JSON file operations (transcript data, etc.), use `vault.adapter.read()` / `vault.adapter.write()`. Do NOT use `vault.read()` / `vault.create()` which create TFile objects and trigger Obsidian events.
- **Error taxonomy** — Use existing error types: `TransientError` (retryable, e.g. network), `ConfigError` (user config issue), `DataError` (data integrity). Defined in `src/utils/errors.ts`.
- **No emoji in UI** — Use SVG icons for UI elements, never emoji.
- **Both test and build must pass** — Always verify `npm run test` AND `npm run build` before considering work complete.

## Testing

- Manual test results must be documented in Dev Agent Record section of story file.
- Integration tests must validate response values (not just API success).
- Per-story commits with descriptive messages.

## Project Structure

- `src/transcript/` — TranscriptData v2 model, migration, I/O
- `src/session/` — SessionManager, MeetingSession types
- `src/pipeline/` — Pipeline executor, PipelineDispatcher, steps
- `src/providers/` — STT and LLM provider adapters
- `src/state/` — Global PluginState (Recording/Idle only)
- `src/ui/` — UI components (status bar, settings tab)
