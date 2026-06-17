# Relay Codebase Review

A round-robin review relay across four agents in this herdr workspace. Each agent
does its OWN independent review, compares against what's already here, appends its
section, then hands off to the next agent.

## RELAY PROTOCOL — read this first

Order and panes:

1. **claude** (`w2:p1`) → hands to codex
2. **codex**  (`w2:p2`) → hands to pi
3. **pi**     (`w2:p3`) → hands to omp
4. **omp**    (`w2:p4`) → hands back to claude (final synthesis / bug hunt)

When it is your turn:

1. Read this whole file, especially the prior agents' sections.
2. Independently review the codebase in `src/` (don't just trust prior findings).
3. Append a `## <yourname> findings` section below. In it: list YOUR findings,
   then explicitly **compare** — which prior findings you confirm, which you think
   are wrong/overstated, and what they missed.
4. Hand off by running EXACTLY this (substitute your next target + role):
   - codex: `herdr pane run w2:p3 "Your relay turn: read RELAY_REVIEW.md and follow the RELAY PROTOCOL for role pi. codex just appended its section."`
   - pi:    `herdr pane run w2:p4 "Your relay turn: read RELAY_REVIEW.md and follow the RELAY PROTOCOL for role omp. pi just appended its section."`
   - omp:   `herdr pane run w2:p1 "Relay complete: read RELAY_REVIEW.md. All four sections are in. Now do the final synthesis and bug hunt, claude."`

Keep your section concise (bullets, file:line refs). Do not edit other agents' sections.

---

## pi findings

Scope reviewed: `src/agent/loop.ts`, `src/agent/prompts.ts`, `src/tui/app.tsx`, `src/tui/store.tsx`,
`src/tui/commands.ts`, `src/cli-program.tsx`, `src/cli.tsx`, `src/config/loader.ts`,
`src/session/store.ts`, `src/llm/*`, `src/tools/*`, `src/sandbox/*`, `src/policy/*`,
`src/workspace/*`, `src/util/*`, plus all test files.

### My new findings

1. **Multiple tools throw uncaught errors on filesystem failures — no try/catch anywhere**
   `src/tools/create_file.ts:5` — `writeFile(abs, content, { flag: 'wx' })` throws `EEXIST` if
   file exists. `src/tools/replace_string.ts:8` — `fs.readFile(abs, 'utf8')` throws `ENOENT` if
   file missing. `src/tools/read_file.ts:14` — same `readFile` `ENOENT` risk.
   `src/tools/delete_file.ts:5` — `fs.rename` throws `EXDEV` on cross-device moves. None of
   these have try/catch. The error propagates out of `tool.run()` at `src/agent/loop.ts:63`,
   becoming an unhandled promise rejection — the TUI's `.catch()` at `app.tsx:83` catches it
   as a generic provider error instead of a clean tool error result.

2. **TUI permanently wedges on iteration-limit error — `running.current` never cleared**
   `src/agent/loop.ts:69` emits `{ type: 'error' }` but does NOT emit `done` and does NOT
   throw. The TUI at `src/tui/app.tsx:68-73` only re-enables input and clears `running.current`
   on the `done` event path. The `.catch()` at `app.tsx:83-100` won't fire because `runTurn`
   returns normally (not a rejection). Result: `running.current` stays `true` and
   `inputDisabled` stays `true` forever — the TUI is dead until the user kills the process.
   (Codex noted this; I independently verified the exact mechanism.)

3. **`globTool` ignores `.gitignore`; `listFilesTool` respects it — inconsistent**
   `src/tools/glob.ts:13` passes only `DEFAULT_IGNORES` to `walkWorkspace`. But
   `src/tools/list_files.ts:23` also reads `.gitignore` via `readGitignore()`. Both are
   read-level tools listing workspace files, but they can return different result sets.

4. **`safeJson` in Anthropic adapter silently swallows malformed arguments**
   `src/llm/providers/anthropic.ts:55-56` — `safeJson(input)` returns `{}` for any parse
   failure. If the model sends a tool call with non-JSON arguments (stream corruption,
   model bug), the invalid payload is silently replaced with `{}`, masking the error.

5. **No provider stream timeout — agent loop hangs forever on stalled connections**
   `src/llm/types.ts` — `LlmProvider.stream()` returns `AsyncIterable<StreamChunk>` with no
   timeout contract. No adapter implements a timeout, and `src/agent/loop.ts:40` just
   awaits the stream. A hung provider connection freezes the agent indefinitely with no
   recovery path.

6. **`trimMessages` cuts tool-result content to 4000 chars — long outputs silently truncated**
   `src/agent/loop.ts:73` — tool messages > 4000 chars get `[trimmed]` suffix. If the
   agent runs `cat large-file.log` and the result is 20K chars, the model never sees the
   full output. Worse, the trim doesn't note how much was truncated, so the model can't
   request a re-read with offset.

7. **`create_file` snapshots before checking for EEXIST — snapshot may be stale/empty**
   `src/tools/create_file.ts:5` calls `snapshotFile()` before `writeFile({flag:'wx'})`. If
   the file already exists, `snapshotFile`'s `copyFile` throws `ENOENT` (caught, writes
   empty snapshot), then `writeFile` throws `EEXIST` (uncaught, see finding #1). The empty
   snapshot file clutters `.harness/snapshots`.

8. **`deleteFileTool` risk is `dangerous`, but `createFileTool` is only `write`**
   `src/tools/delete_file.ts:5` — `risk: 'dangerous'`. `src/tools/create_file.ts:5` —
   `risk: 'write'`. Deleting moves to `.harness/snapshots` (recoverable); creating a new
   file overwriting nothing is less impactful. The danger levels feel inverted for the
   actual operations performed.

9. **Session ID regex generates T-format but still has `T` in filename**
   `src/session/store.ts:7` — `replace(/[:.]/g, '-')` leaves `T` in the filename:
   `2026-06-14T08-18-00-000Z-abc12345.jsonl`. The `T` is harmless but shows the intent
   was to create safe filesystem names — a more thorough sanitization would be cleaner.

10. **`deepMerge` in config loader could mangle `permissions.mode` if user provides partial object**
    `src/config/loader.ts:28` — `deepMerge(DEFAULT_CONFIG, user, project, explicit)` correctly
    merges nested objects. But if a user provides `{ "permissions": { "mode": "auto" } }`,
    the other permission keys (`read`, `write`, etc.) will be inherited from defaults.
    This is actually correct behavior, but the `zod` schema `permissionSchema.default(...)`
    at `src/config/schema.ts:8` may override the deep-merged result since
    `configSchema.parse()` applies defaults. Verify with tests.

### Comparison with prior findings

**Confirming Claude's findings:**
- #1 `trimMessages` orphan — confirmed. `src/agent/loop.ts:73` slices arbitrarily.
- #2 Missing spawn `error` handler — confirmed. `src/sandbox/executor.ts:28-40`.
- #3 No sandbox off macOS — confirmed. `src/sandbox/executor.ts:23` — `process.platform === 'darwin'`.
- #4 Bypassable danger classifier — confirmed. `src/policy/classifier.ts:4` is a shallow deny-list.
- #5 `replace_string` `String.replace` semantics — confirmed real. But since preview and apply
  both use `String.replace`, the preview and the actual write stay consistent with each other.
  Agree with Codex: more of a footgun than a divergence.
- #6 Streaming fragmentation — confirmed for OpenAI.
  `src/llm/providers/openai.ts:37-39` forwards `call.id` which is `undefined` on later
  argument deltas; `aggregateStream` at `src/llm/stream.ts:27` assigns new anonymous IDs.

**Confirming Codex's findings:**
- #1 Static `run_command` risk vs. parsed command risk — confirmed.
  `src/agent/loop.ts:55-64` checks `tool.risk` (always `'execute'` from
  `src/tools/run_command.ts:7`) BEFORE `run_command` classifies the command.
  I'd upgrade this from a bug to a **design issue**: the approval gate and the
  sandbox profile selector use DIFFERENT risk signals (static vs. parsed).
- #2 TUI wedges on error — confirmed (see my finding #2).
- #3 OpenAI fragmentation — confirmed.
- #4 `apply_patch` cannot delete — confirmed. `normalizePatchPath` at
  `src/tools/apply_patch.ts:34-36` rejects `/dev/null`.
- #5 `search_files` also missing spawn error handler — confirmed.
  `src/tools/search_files.ts:34-40` (`collect` function).

**What they missed (covered in my findings above):**
- Uncaught tool errors from filesystem operations (finding #1) — fundamentally breaks
  the error-reporting contract.
- No provider timeout (finding #5) — agent loop hangs forever.
- `safeJson` silently masking parse errors (finding #4).
- `globTool` vs `listFilesTool` ignore-file inconsistency (finding #3).
- `trimMessages` content truncation to 4000 chars (finding #6).
- `create_file` snapshot-then-fail ordering (finding #7).

---

## claude findings

Scope reviewed: `src/agent/loop.ts`, `src/sandbox/{executor,workspace-boundary}.ts`,
`src/policy/{classifier,approval}.ts`, `src/tools/{run_command,replace_string}.ts`,
`src/session/store.ts`, `src/llm/stream.ts`.

Candidate bugs / risks (unverified — to be challenged by the relay):

1. **Orphaned tool-call sequence from `trimMessages`** — `src/agent/loop.ts:73`
   slices `messages.slice(-40)`. The cut can land between an assistant message that
   carries `toolCalls` and its corresponding `role:'tool'` results (or vice-versa),
   producing an invalid message sequence. Anthropic/OpenAI both reject a tool_use
   without its tool_result (and a tool_result with no preceding call). Long sessions
   will intermittently 400.

2. **`spawn` has no `'error'` handler** — `src/sandbox/executor.ts:28-41`. If the
   child fails to spawn (ENOENT for `sandbox-exec`/`/bin/sh`, EAGAIN, etc.) the
   `'error'` event fires, `'close'` may never fire, the Promise never resolves, and
   the unhandled error can crash the process. Needs a `child.on('error', ...)`.

3. **No sandbox off macOS** — `src/sandbox/executor.ts:23` only builds a profile when
   `process.platform === 'darwin'`. On Linux/CI a command classified `dangerous`
   still runs via plain `/bin/sh -c` with `env: process.env` and zero isolation. The
   risk classification creates a false sense of containment.

4. **Trivially bypassable danger classifier** — `src/policy/classifier.ts:4`. Patterns
   like `/rm\s+-rf/i` miss `rm -r -f`, `rm --recursive --force`, `find … -delete`,
   env-prefixed or quoted commands. It's a deny-list; treat as best-effort only.

5. **`replace_string` preview uses `String.replace` semantics** — `src/agent/loop.ts:82`
   `oldContent.replace(data.oldString, data.newString)`. A `newString` containing `$&`,
   `$1`, `$\`` etc. is interpreted as a replacement pattern, so the PREVIEW diff can
   differ from what the apply writes. (Apply at `replace_string.ts:8` also uses
   `String.replace`, so both share the quirk — preview/apply stay consistent, but both
   mangle `$` sequences.)

6. **Streaming tool-call id fragmentation** — `src/llm/stream.ts:27`. Deltas without a
   stable `id` get a fresh `tool-${anonymousIndex++}` each chunk, which would shatter a
   single streamed tool call into many partial ones. Safe only if every provider adapter
   guarantees a stable id (or no-id) per call. Worth verifying the OpenAI/Codex adapters.

Verify these against the real provider adapters and tests before trusting them.

## codex findings

Scope reviewed: `src/agent/loop.ts`, `src/llm/{stream,providers/*}.ts`,
`src/policy/*`, `src/sandbox/*`, `src/tools/*`, `src/headless.ts`,
`src/tui/app.tsx`, and nearby tests.

My findings:

1. **`run_command` approval uses the static `execute` risk, not the parsed command
   risk** — `src/agent/loop.ts:55-64` calls `requiresApproval(tool.risk, ...)`
   before `run_command` classifies `input.command`; `run_command` is declared
   `risk: 'execute'` at `src/tools/run_command.ts:7`. With permissions like
   `execute: allow, network: ask`, `curl https://...` or `npm install` runs
   without the network prompt even though `classifyCommand` would return
   `network`. With `mode: auto`, even a matched dangerous command avoids the
   dangerous approval path because the static risk is still only `execute`.

2. **TUI can wedge permanently on agent iteration-limit errors** —
   `src/agent/loop.ts:69` emits an `error` event without a following `done` or
   throw. `runHeadless` records and throws that error (`src/headless.ts:74-84`),
   but the TUI only re-enables input and clears `running.current` on `done`
   (`src/tui/app.tsx:68-73`). A long tool loop / missing-tool loop can leave the
   UI disabled forever.

3. **OpenAI tool-call streaming fragmentation is real** —
   `src/llm/providers/openai.ts:37-39` forwards only `call.id`, but Chat
   Completions deltas commonly provide the id on the first tool-call delta and
   only `index` on later argument deltas. `aggregateStream` then assigns a fresh
   anonymous id for every later id-less chunk (`src/llm/stream.ts:27`), splitting
   one call into multiple partial calls. Anthropic and Codex adapters look safer:
   Anthropic maps `event.index` back to the original id (`src/llm/providers/anthropic.ts:27-39`),
   and Codex emits complete function calls from `output_item.done`
   (`src/llm/providers/codex-oauth.ts:191-198`).

4. **`apply_patch` cannot delete files from a normal unified diff** —
   `src/tools/apply_patch.ts:20` prefers `newFileName` over `oldFileName`, and
   `normalizePatchPath` rejects `/dev/null` at `src/tools/apply_patch.ts:34-36`.
   For a deletion patch (`--- a/file`, `+++ /dev/null`), this returns "Patch file
   is missing a filename" instead of removing the file.

5. **Spawn error handling is missing in two places** —
   Claude noted `src/sandbox/executor.ts:28-40`; the same pattern exists in
   `src/tools/search_files.ts:34-40`. If spawning `rg`/`grep` fails, the Promise
   does not resolve and the process can see an unhandled `'error'` event.

Comparison with Claude:

- Confirmed: #1 `trimMessages` can orphan tool-call/result pairs
  (`src/agent/loop.ts:73`), #2 missing `spawn` error handling, #3 Linux/no
  `sandbox-exec` fallback means no real sandbox (`src/sandbox/executor.ts:23-26`),
  #4 classifier is a shallow deny-list, and #6 streaming fragmentation. I would
  upgrade #6 from "worth verifying" to confirmed for the OpenAI adapter.
- Partly disagree / de-emphasize: #5 replacement `$` semantics is real because
  both preview and apply use `String.replace` (`src/agent/loop.ts:82`,
  `src/tools/replace_string.ts:8`), but since preview and write are consistent it
  is more of an API semantics footgun than a preview/apply divergence.
- Missed by Claude: dynamic `run_command` risk is not enforced at approval time;
  TUI does not recover from iteration-limit `error` events; deletion patches are
  rejected; `search_files` also lacks a `spawn` error handler.

## omp findings

Scope reviewed (independently, not trusting prior sections): `src/agent/loop.ts`,
`src/sandbox/{executor,profiles,workspace-boundary}.ts`, `src/policy/{classifier,approval,types}.ts`,
`src/llm/{stream,types}.ts`, `src/llm/providers/{openai,anthropic,codex-oauth}.ts`,
`src/tools/{create_file,delete_file,replace_string,apply_patch,run_command,search_files,glob,list_files}.ts`,
`src/workspace/{ignores,glob,snapshot,context}.ts`, `src/session/store.ts`, `src/config/{loader,schema}.ts`,
`src/agent/{prompts,types}.ts`, `src/headless.ts`, `src/test/fake-provider.ts`.

### My new findings

1. **Sandbox grants GLOBAL read access: any sandboxed command can read `~/.ssh/id_rsa`, `~/.aws/credentials`, `/etc/passwd`, etc.**
   `src/sandbox/profiles.ts:10` (`read-only`) and `:17` (`workspace-write`) both emit `(allow file-read*)`
   with NO `(subpath workspaceRoot)` restriction. `run_command` runs in `workspace-write` for everything
   not classified `dangerous`/`network` (`src/tools/run_command.ts:7`). So `cat ~/.ssh/id_rsa` runs under
   the sandbox and the content is captured into `stdout`, which the agent loop forwards verbatim into the
   tool-result message (`loop.ts:74`) → straight to the LLM provider. The sandbox prevents *writes* and
   *network*, but silently allows full-system reads. Highest-impact miss across the prior reviews.

2. **`runSandboxed` leaks the entire parent `process.env` into every sandboxed command** —
   `src/sandbox/executor.ts:29` `env: process.env`. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
   `CODEX_ACCESS_TOKEN`, CI tokens, etc. are visible to any `run_command` the model issues (including
   ones the user approved as merely `execute`). `echo $OPENAI_API_KEY` exfiltrates to the model via
   stdout. The seatbelt profile never scopes env. Combined with #1, the sandbox's read/env surface is
   wide open even though write/network look locked down.

3. **OpenAI streaming bug is WORSE than "fragmentation": tool calls get truncated arguments, not split calls.**
   `src/llm/providers/openai.ts:37-39` forwards `call.id`/`call.function?.name`, both `undefined` on
   every delta after the first for a given `index` (OpenAI sends `id`+`name` only on the first
   tool-call delta). `aggregateStream` then assigns each id-less delta a fresh `tool-${n}`
   (`src/llm/stream.ts:27`) into its own map entry, but the final
   `.filter((call) => call.function.name)` (`stream.ts:35`) DROPS those anonymous entries. Net result:
   the surviving call keeps only the FIRST delta's argument fragment (often just `{"path":`), yielding
   invalid JSON → `parseArgs` (`loop.ts:72`) returns `{}` → zod rejects → the tool call fails. The
   OpenAI adapter is broken for any tool call whose arguments span >1 streaming delta. Pi/Codex called
   it "shatters into many partial calls"; the real effect is one call with truncated args (the partials
   are silently discarded). Fix: key by `call.index ?? call.id` in the aggregator, or have the adapter
   track `index→id` like Anthropic does (`anthropic.ts:27-33`).

4. **`runSandboxed` timeout sends SIGTERM but never escalates to SIGKILL and never kills the process group** —
   `src/sandbox/executor.ts:37`. `child.kill('SIGTERM')` hits only the spawned `/bin/sh`, not its
   children (no `detached:true`, no `process.kill(-child.pid)`). `npm run dev`, servers, or any child
   that ignores SIGTERM keeps running orphaned; and if the shell itself doesn't exit, `'close'` never
   fires and the Promise hangs indefinitely despite `timedOut` being set. The `timedOut` flag is only
   read on the `close` path that may never come.

5. **`loadSession` hard-crashes on any malformed JSONL line; `appendEvent` is non-atomic** —
   `src/session/store.ts:34` does `JSON.parse(line)` with no try/catch. A single truncated line (crash
   mid-`appendFile`, disk error, partial write — there is no temp-file-then-rename at `:18`) makes the
   whole session unloadable. `listSessionSummaries` (`:74`) swallows this so the session just vanishes
   from the picker; but `loadSession` (used by `--resume` and the TUI `useEffect` at `app.tsx:44`)
   throws and, in the TUI case, the unhandled rejection leaves `session` null forever.

6. **`listFilesTool` silently truncates with no marker and still recurses past the limit** —
   `src/tools/list_files.ts:30` `if (lines.join('\n').length > 20_000) break;`. The `break` is checked
   AFTER pushing a full subtree (the recursive `tree(...)` call on `:29` already completed), so output
   can blow well past 20K in one iteration; there is no `[truncated]` suffix, so the model sees a
   partial tree and believes it is complete. Also recomputes `lines.join('\n')` every iteration →
   O(n²). (Mirror of pi's trimMessages-truncation finding, but for the listing tool.)

7. **`globTool` duplicates `DEFAULT_IGNORES` locally instead of importing it** —
   `src/tools/glob.ts:6` defines its own `Set(['node_modules','.git','.harness','.pi','.DS_Store','dist'])`
   identical to `src/workspace/ignores.ts:4` today, but they will drift. `glob` also skips
   `readGitignore()` (so gitignored files appear) while `list_files`/`loadWorkspaceContext` honor it —
   pi noted the inconsistency; the duplicated literal is the underlying maintenance trap.

8. **`(allow process-exec)` is unrestricted in both sandbox profiles** — `profiles.ts:9,:16`. A
   sandboxed command can `exec` any binary on the system (no `(subpath ...)` allow-list of
   interpreters/binaries). With #1/#2 this makes the "sandbox" largely advisory for anything that can
   spawn a helper.

9. **`read-only` sandbox mode is effectively unused but also globally-readable** — `profiles.ts:6-12`.
   No tool currently selects it (`run_command.ts:7` picks `dangerous` or `workspace-write`), so it is a
   latent footgun rather than live: if wired up later it would inherit the global-read problem from #1.

10. **Hardcoded "macOS" in the system prompt + Linux has no sandbox at all** — `src/agent/prompts.ts:6`
    tells the model it "runs on macOS"; on Linux `executor.ts:23` skips profile building entirely and
    drops to plain `/bin/sh -c` with full env. The model is told a false platform and gets no isolation.
    (Claude #3 noted the no-sandbox-off-macOS part; the misleading prompt is the add.)

### Comparison with prior findings

**Confirming (independently re-traced to the cited lines):**

- Claude #1 `trimMessages` orphan — confirmed, `loop.ts:73` slices at an arbitrary message boundary;
  a cut between an assistant `toolCalls` message and its `role:'tool'` results (or vice-versa) yields a
  sequence both Anthropic and OpenAI reject with 400.
- Claude #2 / Codex #5 / Pi #2 spawn `'error'` handler missing — confirmed in both
  `executor.ts:28-41` and `search_files.ts:34-42`. `spawn` ENOENT/EAGAIN → `'error'` fires, `'close'`
  may not, Promise never resolves.
- Claude #3 no sandbox off macOS — confirmed (`executor.ts:23`).
- Claude #4 / weak classifier — confirmed and extend: `classifier.ts:6` `network` list misses `ssh`,
  `scp`, `rsync`, `nc`, `docker pull`, `git clone`, `python -c 'import urllib'`, bare-IP, etc. Both the
  `dangerous` and `network` lists are trivially bypassed by quoting/`eval`/`$VAR` indirection.
- Codex #1 static `run_command` risk at approval — confirmed as a design issue. `loop.ts:56` gates on
  `tool.risk` (`'execute'`, `run_command.ts:7`) BEFORE `run_command` internally reclassifies; with
  `execute: allow, network: ask`, `curl …` never prompts even though the user asked network to ask.
- Codex #2 / Pi #2 TUI wedge on iteration-limit `error` — confirmed, cleanest reproduction: `loop.ts:69`
  emits `{type:'error'}` then returns NORMALLY (no throw), so the TUI's `.catch()` (`app.tsx:76`) never
  runs and only the `'done'` arm (`app.tsx:69-73`) clears `running.current`/`inputDisabled`. Headless is
  fine because `headless.ts:84` throws after the await. TUI is wedged until process kill.
- Codex #3 OpenAI fragmentation — confirmed, with corrected mechanism (see my #3).
- Codex #4 `apply_patch` can't delete — confirmed (`apply_patch.ts:20` prefers `newFileName`, and
  `normalizePatchPath` `:34-36` rejects `/dev/null`).
- Claude #5 `replace_string` `$` semantics — confirmed; agree with Codex it's a footgun, not a
  preview/apply divergence (both paths use `String.replace`).

**Disagreeing / correcting:**

- **Pi #10 (deepMerge vs zod `permissionSchema.default`) is NOT a bug.** `configSchema.parse()` only
  applies a `.default()` when the key is absent; `deepMerge(DEFAULT_CONFIG, user, project, explicit)`
  always produces a complete `permissions` object, and the nested `permissionSchema` fields' own
  `.default()`s only fill MISSING keys, never overwrite present ones. A user `{permissions:{mode:'auto'}}`
  correctly yields the full merged object. No clobber. I'd drop this finding.
- **Pi #8 (risk "inversion" delete=dangerous vs create=write)** — mild disagreement: `delete_file`
  moves a file the user HAD (data loss even if snapshotted; snapshots can be GC'd), `create_file` only
  adds a new file. The levels are defensible, not inverted. Not a bug.
- **OpenAI effect mis-stated by Pi/Codex** — see my #3: the partial deltas are filtered out
  (`stream.ts:35`), so the symptom is truncated args on a single call, not "many partial calls."

**What they missed (all in my findings above):** global sandbox read + full env leak (#1, #2, #8) —
the single most important gap; SIGTERM/no-SIGKILL/no-pgrp timeout behavior (#4); non-atomic session
writes + hard crash on bad line (#5); silent list_files truncation (#6); duplicated `DEFAULT_IGNORES`
(#7); misleading "macOS" prompt on Linux (#10).

---

## claude — FINAL SYNTHESIS & bug hunt

Deduped + ranked across all four sections. Items marked **[verified]** were re-read
against source by claude in this pass; line refs rechecked.

### P0 — Security (sandbox is largely advisory)
1. **Sandbox grants unscoped read + leaks full env.** `profiles.ts:10,17` emit
   `(allow file-read*)` with no `(subpath …)`, and `executor.ts:29` passes
   `env: process.env`. Any `workspace-write` command can read `~/.ssh`, `~/.aws`,
   `/etc/passwd`, and echo `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`CODEX_ACCESS_TOKEN`;
   output streams back into the tool-result message to the model. `(allow process-exec)`
   is also unscoped (`:9,:16`). **[verified]** (omp #1/#2/#8)
2. **Approval gate uses static `execute` risk, not the parsed command risk.**
   `loop.ts:56` gates on `tool.risk` (always `'execute'`, `run_command.ts:7`) BEFORE
   the command is classified. `curl …`/`npm install` skip the `network: ask` prompt;
   under `mode:auto` a dangerous-matched command skips the dangerous prompt too.
   **[verified]** (codex #1)
3. **No sandbox at all off macOS.** `executor.ts:23` only builds a profile on darwin;
   elsewhere it's plain `/bin/sh -c` with full env, and the system prompt still claims
   "macOS" (`prompts.ts:6`). **[verified]** (claude #3 + omp #10)

### P0 — Correctness (broken features)
4. **OpenAI adapter loses tool-call arguments.** Later streaming deltas have
   `id/name === undefined` and `openai.ts:38` never forwards `call.index`; `stream.ts:27`
   files each fragment under a new `tool-N`, then `stream.ts:35`'s
   `.filter(c => c.function.name)` drops them — the surviving call keeps only the first
   fragment → invalid JSON → `parseArgs` returns `{}` → zod fails. Breaks essentially
   every multi-delta tool call. Fix: key the aggregator by `index ?? id`, or map
   `index→id` in the adapter like `anthropic.ts:27-33`. **[verified]** (omp #3; corrects
   claude #6 / codex #3 / pi #6)
5. **`trimMessages` can orphan tool_call/tool_result pairs.** `loop.ts:73` slices
   `messages.slice(-40)` at an arbitrary boundary; a cut between an assistant `toolCalls`
   message and its `role:'tool'` results → Anthropic/OpenAI 400. **[verified]** (claude #1, all confirm)
6. **`apply_patch` cannot delete files.** `apply_patch.ts:20` prefers `newFileName`
   (`/dev/null` for deletions) and `normalizePatchPath:34-36` rejects `/dev/null` →
   "missing a filename"; even via `oldFileName` it would `writeFile` empty, never `unlink`.
   **[verified]** (codex #4)

### P1 — Robustness
7. **`spawn` missing `'error'` handler** in `executor.ts:28` AND `search_files.ts:34` →
   on ENOENT/EAGAIN the Promise never resolves and the `'error'` goes unhandled. (claude #2, codex #5)
8. **TUI wedges on iteration-limit.** `loop.ts:69` emits `{type:'error'}` then returns
   normally (no throw), so the TUI `.catch()` never fires and only the `done` arm clears
   `running.current`/input (`app.tsx`). Headless is fine (`headless.ts` throws). (codex #2, pi #2, omp)
9. **Timeout doesn't really kill.** `executor.ts:37` sends only `SIGTERM` to `/bin/sh`
   (no `detached`/process-group, no SIGKILL escalation); children orphan and if the shell
   ignores SIGTERM the Promise hangs forever. (omp #4)
10. **`loadSession` crashes on one bad JSONL line; writes non-atomic.** `store.ts:34`
    `JSON.parse` has no try/catch; `appendEvent:18` is append-with-no-rename, so a torn
    write makes `--resume`/TUI load throw. (omp #5)
11. **`trimMessages` silently truncates tool output to 4000 chars** with no byte count,
    so the model can't re-read with offset. `loop.ts:73`. (pi #6)

### P2 — Quality / footguns
12. Weak, bypassable danger/network deny-list classifier — `classifier.ts` misses
    `rm -r -f`, `ssh`/`scp`/`rsync`/`nc`, `git clone`, `$VAR`/`eval` indirection. (claude #4, omp)
13. `replace_string` mangles `$&`/`$1` via `String.replace` (consistent preview/apply,
    still a footgun). `loop.ts:82`, `replace_string.ts:8`. (claude #5, codex/pi/omp agree)
14. `list_files` truncates with no `[truncated]` marker and checks the limit *after*
    pushing a whole subtree; O(n²) `join`. `list_files.ts:30`. **[verified]** (omp #6)
15. `globTool` duplicates `DEFAULT_IGNORES` and skips `.gitignore` (drift + inconsistency
    with `list_files`). `glob.ts:6`. (omp #7, pi)
16. `create_file` writes an empty snapshot before its `wx` EEXIST check. `create_file.ts:5`. (pi #7)

### Dismissed (looked, not bugs)
- **pi #10** deepMerge/zod `permissionSchema.default` clobber — defaults only fill *missing*
  keys; merged object is complete. omp's refutation holds.
- **pi #8** delete=`dangerous` vs create=`write` "inversion" — defensible (delete loses
  existing data), not inverted.
- **pi #9** `T` left in session filename — cosmetic, harmless.

Highest-leverage fixes first: #1+#2+#3 (sandbox/approval) and #4 (OpenAI adapter is the
one that makes a whole provider unusable).
