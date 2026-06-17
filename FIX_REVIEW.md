# Fix Review — codex review of the two fix worktrees

Worktree A: /Users/justin/Projects/testingthis/wt-anthropic (branch fix/core-anthropic) — fixes #1 P0 tool-name dup, #2 P1 empty text block, #5 input_tokens, #4 coalesce tool_results, in src/llm/providers/anthropic.ts + new anthropic.test.ts.
Worktree B: /Users/justin/Projects/testingthis/wt-loop (branch fix/core-loop) — fixes #3 trim orphan, #6 parseArgs, #7 try/catch, #8 preview count, in src/agent/loop.ts + new loop.test.ts.

codex: append your review under the marker below, then STOP. The orchestrator (claude) reads this file.

---

## codex review

### Worktree A — `/Users/justin/Projects/testingthis/wt-anthropic`

Verdict: APPROVE

Review:
- The P0 tool-name duplication fix is correct. `normalizeAnthropicStream` emits the tool name only at `content_block_start` (`src/llm/providers/anthropic.ts:38-42`) and emits only `id` + argument deltas later (`src/llm/providers/anthropic.ts:44-48`), which matches `aggregateStream`'s concatenate-by-id contract.
- The empty text block fix is correct. `toAnthropicMessage` now conditionally includes `{ type: 'text' }` only when `message.content` is truthy (`src/llm/providers/anthropic.ts:63-65`).
- The usage fix is correct. Input tokens are captured from `message_start` (`src/llm/providers/anthropic.ts:35-37`) and combined with output tokens from `message_delta` (`src/llm/providers/anthropic.ts:50-54`).
- The tool-result coalescing fix is reasonable for this loop's storage shape. Consecutive `role: tool` messages produced by one assistant turn become consecutive Anthropic `user/tool_result` messages, and `coalesceToolResults` merges only all-tool-result user messages (`src/llm/providers/anthropic.ts:75-91`).
- New test check: `src/llm/providers/anthropic.test.ts:17-33`, `35-46`, `62-74`, and `91-104` each target behavior that the old implementation lacked; they are not just tautological shape checks. The file imports new exported helpers at `src/llm/providers/anthropic.test.ts:2`, so on raw `main` it would fail at import time too, but the assertions also fail against the old behaviors if the helpers are exposed unchanged.
- Ran: `npm test -- --run src/llm/providers/anthropic.test.ts` in this worktree: 1 file passed, 7 tests passed.

### Worktree B — `/Users/justin/Projects/testingthis/wt-loop`

Verdict: CHANGES NEEDED

Issue:
- `src/agent/loop.ts:76`: The new iteration-level catch is incomplete for thrown tool executions. By the time a tool throws, the assistant message with `toolCalls` has already been appended to session history at `src/agent/loop.ts:41-43`, but the catch at `src/agent/loop.ts:76-79` emits only `error` + `done` and returns without appending a matching `role: 'tool'` result. Continuing the same session will replay an assistant tool-call message with no corresponding tool result, which is invalid for both OpenAI and Anthropic. The fix should either catch per tool and `pushToolResult(..., { ok:false, ... })` for the throwing call, or otherwise ensure persisted history remains provider-valid before returning.

Other review notes:
- The trim fix itself is directionally correct for the identified leading-orphan case: `trimMessages` drops leading `role: 'tool'` messages after the 40-message slice (`src/agent/loop.ts:91-95`).
- The parse fix is correct for malformed JSON: `parseArgs` now returns a discriminated failure instead of `{}` (`src/agent/loop.ts:86-90`), and `runTurn` records a tool result instead of executing the tool (`src/agent/loop.ts:52-55`).
- The preview diff guard now matches the real `replace_string` uniqueness requirement for duplicate/zero matches (`src/agent/loop.ts:104-109`).
- New test check: `src/agent/loop.test.ts:5-41` would fail against the old `trimMessages` behavior because the result starts with `role: 'tool'`; `src/agent/loop.test.ts:44-68` would fail against the old `parseArgs` behavior because malformed JSON was coerced to `{}`. However, `src/agent/loop.test.ts:1-68` contains no test for #7 try/catch around iteration and no test for #8 previewDiff `count === 1`, so the current test file would not catch the thrown-tool history corruption above or a regression in approval diff preview.
- Ran: `npm test -- --run src/agent/loop.test.ts` in this worktree: 1 file passed, 6 tests passed.

## pi review

Worktree B — `/Users/justin/Projects/testingthis/wt-loop` (branch `fix/core-loop`)

Verdict: **APPROVE** (codex's CHANGES NEEDED is resolved; one narrow residual hole flagged as a RECOMMENDED follow-up, not a blocker).

Verified by: `git -C /Users/justin/Projects/testingthis/wt-loop diff main -- src/agent/loop.ts`, `cat .../src/agent/loop.test.ts`, `npx vitest run src/agent/loop.test.ts` → 1 file / 9 tests passed. I also re-read `src/policy/approval.ts`, `src/policy/classifier.ts`, `src/test/fake-provider.ts`, `src/tui/app.tsx`, `src/headless.ts` to trace the throw paths below.

### Focus (1): does the throw handling actually keep history paired?

- **Per-tool try/catch around `tool.run` — YES, keeps history paired.** `src/agent/loop.ts:73-81` wraps only `await tool.run(...)`; on throw it synthesizes `{ ok:false, output:'', error }`, then `src/agent/loop.ts:82-83` emits `tool-done` and calls `pushToolResult(toolCall.id, result)`. `pushToolResult` (`src/agent/loop.ts:106`) appends a `role:'tool'` message with the matching `toolCallId` → every committed assistant `tool_call` gets a paired `tool_result`. This is exactly the dual of the trim orphan and it directly fixes codex's flagged issue.
- **Outer iteration try/catch for a provider/stream throw BEFORE the assistant commit — YES, correct.** The `try` at `src/agent/loop.ts:37` wraps from `provider.stream(...)` (:38). If `provider.stream` or `aggregateStream` (:39) throws, control reaches the outer `catch` at `:85-89` BEFORE `assistantMessage` is pushed/appended at `:42-43`, so nothing is committed and there is nothing to orphan. `error`+`done`+`return` is the right outcome there.
- **Non-regression check on the happy path:** the outer catch does not double-emit. Normal completion still returns from `:44` (no tool calls) or exhausts the loop to `:91-92`; only an actual throw reaches `:85`.

### Focus (2): are tests #7 (thrown-tool) and #8 (previewDiff count===1) real regressions?

- **Test #7 (`src/agent/loop.test.ts`, the `boom`/`kaboom` test) — YES, real and non-vacuous.** Against `main` there is no try/catch at all, so `tool.run` throwing propagates out of `runTurn`, the test's `await runTurn(...)` rejects, and the assertions never run → test fails. Crucially, the assertion `expect(toolResult?.content).toContain('kaboom')` specifically pins the **per-tool** catch: if you removed only the per-tool catch but kept the outer catch, the throw would route to `:85` (error+done+return) and NO `role:'tool'` result would be pushed, so `toolResult` would be undefined and the test would still fail. So it guards the right thing, not just "done was emitted" (which both paths satisfy). Confirmed it executes via `scriptedProvider` (`src/test/fake-provider.ts`), which yields the `boom` tool_call on turn 1 → reaches `tool.run`.
- **Test #8 (`src/agent/loop.test.ts`, the `foo bar foo` / `zzz` preview test) — YES, real.** Against `main`, `previewDiff` had no `count !== 1` guard (`src/agent/loop.ts:116-117` is new) and always returned a patch via first-occurrence `replaceLiteralOnce`. For the 2-match case (`foo` in `foo bar foo`) `main` returns a patch string, the test asserts `undefined` → fails. For the 0-match case (`zzz`) `main` returns a no-op patch string (createTwoFilesPatch with old===new does not throw), the test asserts `undefined` → fails. Both branches are genuine regressions.
- Minor note (not blocking): codex claimed the prior test file "contains no test for #7 or #8." That was true of the file codex saw, but the current untracked `src/agent/loop.test.ts` now DOES include both #7 and #8 — so that gap is closed. 9 tests now pass.

### ADVERSARIAL: a remaining hole (history can still be orphaned, narrow trigger)

The per-tool try/catch covers **only** `tool.run` (`src/agent/loop.ts:73-74`). After the assistant message is committed (`:42-43`), several other throwing operations in the per-tool body sit OUTSIDE the per-tool catch and are caught by the **outer** catch at `:85-89`, which emits `error`+`done`+`return` **without** pushing a matching `role:'tool'` result. Any such throw orphans the already-committed assistant `tool_call` — the same invariant codex flagged, at a different throw site.

Reachable throw sites after commit, outside the per-tool catch:
- **`src/agent/loop.ts:65` — the approval-request Promise executor.** `new Promise<boolean>((resolve) => options.onEvent({ type:'approval-request', ..., resolve }))`. If a host's `onEvent` throws synchronously inside the executor, the promise rejects, the `await` throws, and the outer catch returns without a tool result. (Neither shipped host triggers this: `src/headless.ts:59-65` only calls `event.resolve(...)` + `writeErr`, and `src/tui/app.tsx` just `dispatch`es — neither throws. So this is defense-in-depth, not a current live bug.)
- **`src/agent/loop.ts:83` / `pushToolResult` → `appendMessage` (`:106`).** `appendMessage` does file I/O; an EACCES/ENOSPC/EROFS failure throws. `pushToolResult` pushes to in-memory `session.messages` BEFORE `appendMessage`, so in-memory history stays paired but the persisted (disk) history may be missing the result → resume-from-disk orphans the `tool_call` for both providers.

NOT reachable (verified safe, so the hole is genuinely narrow): `:62 previewDiff` has its own try/catch returning `undefined` (`src/agent/loop.ts:112,121`); `:63 riskForApproval`/`classifyCommand` and `:64 requiresApproval` are pure regex/logic over strings (`src/policy/classifier.ts`, `src/policy/approval.ts`) and don't throw on valid input; `:57 safeParse` is non-throwing by contract; `:52 parseArgs` is now a non-throwing discriminated result (`:96-99`).

Why APPROVE despite the hole: the fix fully resolves codex's flagged blocker (the common, high-frequency throw source — tool execution), and the residual hole requires abnormal conditions (a misbehaving `onEvent` host or a disk error) that neither first-party host currently exhibits. Marking CHANGES NEEDED would overstate a defense-in-depth gap as a blocker.

### Recommended follow-up (optional, for the orchestrator to schedule)
To close the residual hole and make the invariant consistent, either:
1. Widen the per-tool try/catch (`src/agent/loop.ts:73-81`) to wrap the entire per-call body from `:62` (previewDiff) through `:83` (pushToolResult) — but note this would also swallow `appendMessage` disk errors, so pair it with logging; OR
2. In the outer catch (`src/agent/loop.ts:85-89`), before returning, append synthetic `{ ok:false, error:'<turn aborted>' }` tool results for every `tool_call` in the most recent committed assistant message that has no matching `role:'tool'` in `session.messages`. This guarantees provider-valid history on resume regardless of where the throw originated.
Option 2 is the smaller, more robust change and also covers the `appendMessage` disk-error case.

### Other fix correctness (spot-check, agreeing with codex)
- FIX 3 (`trimMessages`, `src/agent/loop.ts:100-105`): drops leading `role:'tool'` after the 40-slice so the window can never start with an orphan tool result. Correct; the new leading-orphan test would fail on `main`.
- FIX 6 (`parseArgs`, `:95-99` + `:52-55`): malformed JSON now surfaces as a discriminated `{ ok:false }` and records a tool result instead of coercing to `{}` and running. Correct; test would fail on `main`.
- FIX 8 (`previewDiff`, `:116-117`): matches `replace_string`'s `count === 1` requirement (`src/tools/replace_string.ts`). Correct.

Stopping here per protocol. No commit, no other files touched.
