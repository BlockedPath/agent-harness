# Agent Harness

Agent Harness is a local terminal agent prototype. It opens an Ink chat UI for a workspace, loads provider configuration, streams model output, and exposes the repository tools under `src/tools`.

## Setup

Install dependencies:

```sh
npm install
```

Run the development CLI from a workspace:

```sh
npm run dev -- /path/to/workspace
```

If no workspace is supplied, the current directory is used.

## Login And Providers

The default provider is `codex` with Codex OAuth credentials. By default, the harness reads existing Codex credentials from `~/.codex/auth.json` and syncs newer source credentials into `.harness/auth/codex.json` when needed.

Inside the TUI, run:

```text
/login
```

The login flow opens the browser and stores refreshed Codex credentials for the workspace.

OpenAI and Anthropic are also wired through API key environment variables:

```sh
export OPENAI_API_KEY=...
export ANTHROPIC_API_KEY=...
```

Select a provider on startup:

```sh
npm run dev -- . --provider openai --model gpt-4.1
npm run dev -- . --provider anthropic --model claude-sonnet-4-5
```

## Configuration

Configuration is merged in this order:

1. Built-in defaults.
2. `~/.config/harness/config.json`.
3. `<workspace>/.harness/config.json`.
4. A file passed with `--config`.

Example project config:

```json
{
  "defaultProvider": "codex",
  "defaultModel": "gpt-5.5",
  "permissions": {
    "mode": "on-request",
    "read": "allow",
    "write": "ask",
    "execute": "ask",
    "network": "ask"
  },
  "providers": {
    "codex": {
      "auth": "codex-oauth",
      "oauthTokenEnv": "CODEX_ACCESS_TOKEN",
      "oauthCredentialsPath": ".harness/auth/codex.json",
      "oauthSourceCredentialsPath": "~/.codex/auth.json"
    }
  }
}
```

## Common Commands

```sh
npm run dev -- .                 # start the TUI
npm run build                    # compile TypeScript to dist
npm run typecheck                # run TypeScript without emit
npm test                         # run Vitest
npm run lint                     # run ESLint
```

Useful TUI commands:

```text
/login              # open provider login choices
/models             # open the Codex model picker
/models gpt-5.5     # switch directly to a known Codex model
```
