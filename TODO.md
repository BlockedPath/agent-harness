# TODO

## Near Term

- ~~Add a non-interactive command mode for running one prompt from the shell.~~ (done: `harness -p "<prompt>"`)
- ~~Improve Codex OAuth recovery by offering a guided `/login` retry after auth failures.~~ (done)
- ~~Persist model changes made through `/models` back into the active session file.~~ (done)

## Quality

- ~~Add tests for TUI command handling (`/login`, `/models`, model selection).~~ (done)
- ~~Add tests for session resume behavior.~~ (done)
- Add fixtures for malformed tool-call arguments and provider stream failures.

## Product

- ~~Add a concise session list/resume UI.~~ (done: `/resume`)
- ~~Show token usage in the TUI when providers emit usage chunks.~~ (done)
- ~~Add clearer error rendering for provider, tool, and approval failures.~~ (done)
- ~~Add a first-run state that explains how to authenticate providers.~~ (done) — detects
  missing credentials at startup; Codex routes into `/login`, API-key providers show env-var guidance.

## Recommendations

Curated follow-ups, informed by the current code. Roughly highest-value first.

### Reliability & providers
- Emit token usage from the Anthropic provider. Only OpenAI and Codex emit `usage`
  chunks today, so the footer token counter stays blank on Anthropic.
- Add retry with backoff for transient provider failures (HTTP 429/5xx, dropped
  connections) before surfacing an error to the user.
- Harden mid-tool-call stream failures so a dropped stream can't leave a partial
  assistant/tool message pair in the session log.

### Product / UX
- ~~Add a `/compact` command (and/or auto-compaction). History is hard-trimmed to the
  last 40 messages in `src/agent/loop.ts` (`trimMessages`), which silently drops context.~~
  (done: `/compact` + opt-in auto-compaction in `src/agent/compaction.ts`, replayable
  `compaction` session events, and `trimMessages` now preserves the summary.)
- Stream tool-call arguments into the tool card as they arrive; today the card only
  appears after the full tool call is aggregated.
- Persist cumulative token usage to the session file and show it on resume.

### Testing
- Add `ink-testing-library` render tests for the TUI (header/footer, pickers, approval
  modal). Only reducer/logic paths are covered right now.
- Migrate `headless.test.ts`'s inline `providerEmitting` to the shared
  `src/test/fake-provider.ts` `scriptedProvider` (deferred during the e2e work).
- Raise the vitest coverage thresholds as TUI coverage grows (TUI is excluded today).

### Tech debt / scaffolding
- Adopt Prettier with a wide `printWidth` to consistently format the dense one-line
  tool/helper definitions (deferred from the cleanup pass to avoid a huge diff).
- Add a machine-readable `--json` output mode to headless `-p` for scripting.

## Later

- Support repository-level config templates.
- Add export/import for sessions.
- Add configurable tool allowlists.
- ~~Add CI for typecheck, tests, and build.~~ (done)
