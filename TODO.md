# TODO

## Near Term

- ~~Add a non-interactive command mode for running one prompt from the shell.~~ (done: `harness -p "<prompt>"`)
- Improve Codex OAuth recovery by offering a guided `/login` retry after auth failures.
- ~~Persist model changes made through `/models` back into the active session file.~~ (done)

## Quality

- ~~Add tests for TUI command handling (`/login`, `/models`, model selection).~~ (done)
- ~~Add tests for session resume behavior.~~ (done)
- Add fixtures for malformed tool-call arguments and provider stream failures.

## Product

- Add a concise session list/resume UI.
- Show token usage in the TUI when providers emit usage chunks.
- Add clearer error rendering for provider, tool, and approval failures.
- Add a first-run state that explains how to authenticate providers.

## Later

- Support repository-level config templates.
- Add export/import for sessions.
- Add configurable tool allowlists.
- ~~Add CI for typecheck, tests, and build.~~ (done)
