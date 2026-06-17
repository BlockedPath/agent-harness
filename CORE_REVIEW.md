# Relay Code Review — Untested Core (`agent/loop.ts` + `llm/providers/`)

## RELAY PROTOCOL
Scope: `src/agent/loop.ts` and `src/llm/providers/` (especially `anthropic.ts`; compare to
`openai.ts` + the `aggregateStream` contract in `src/llm/stream.ts`). Shared file: CORE_REVIEW.md.
The ORCHESTRATOR (claude) drives every hop — do NOT forward to another agent. When prompted:
1. Independently review the scope (don't just trust prior sections — re-read the code).
2. Append a `## <yourname> findings` section using the STRUCTURED FINDING SCHEMA below.
3. Add a `### comparison` block: which prior findings you confirm, which you refute + why, what was missed.
4. STOP. The orchestrator handles the next step.

## STRUCTURED FINDING SCHEMA (required for every finding)
- severity: P0 | P1 | P2        # P0 = security/data-loss/broken; P1 = serious; P2 = quality
  confidence: 0.0–1.0
  location: path:line
  claim: one sentence
  evidence: exact code or a concrete repro/trigger
  how_to_disprove: what would show this is NOT a bug

## Key contract to keep in mind
`aggregateStream` (src/llm/stream.ts:29-31) keys tool calls by `id` and **concatenates**
`name` and `arguments` across chunks. So a provider's `normalize()` must emit a tool call's
`name` **exactly once** (subsequent argument fragments must carry empty/undefined `name`),
and must keep a **stable `id`** across all fragments of the same call. `openai.ts` does this
via an index→id map and only sends `name` on the first delta. Judge `anthropic.ts` against
this contract.

---

## claude findings

- severity: P0
  confidence: 0.9
  location: src/llm/providers/anthropic.ts:37-39 (vs src/llm/stream.ts:29)
  claim: The Anthropic provider re-emits the full tool name on every `input_json_delta`, so the aggregator concatenates it into a duplicated, unresolvable name — breaking essentially all tool calls that carry arguments.
  evidence: On `input_json_delta` it yields `{ id: toolIds.get(index), name: toolNames.get(index), arguments: partial_json }`. `toolNames.get(index)` is the FULL name (e.g. "read_file"), emitted again on each delta. The aggregator does `existing.function.name += chunk.toolCall?.name ?? ''` (stream.ts:29), so after `content_block_start` (name once) + N json deltas, the name becomes "read_fileread_file…". In loop.ts:46 `options.tools.find(c => c.name === toolCall.function.name)` then fails → `Unknown tool: read_fileread_file…`. A no-arg tool (no input_json_delta) survives; any tool with arguments does not.
  how_to_disprove: Show that Anthropic does not emit `input_json_delta` for tool args, OR that the aggregator dedups rather than concatenates `name`, OR a passing integration test where a multi-delta Anthropic tool call resolves to the bare tool name.

- severity: P1
  confidence: 0.8
  location: src/llm/providers/anthropic.ts:58
  claim: An assistant message that is tool-calls-only (empty content) is serialized with an empty `{type:'text', text:''}` block, which the Anthropic API rejects ("text content blocks must be non-empty") — breaking the turn that replays prior tool calls.
  evidence: `toAnthropicMessage` builds `content: [{ type:'text', text: message.content }, ...toolUses]` unconditionally. In loop.ts:40 the assistant message's content is `aggregated.content`, which is `''` when the model emitted only tool calls. On the next turn that message is replayed → empty text block → API 400.
  how_to_disprove: Show the Anthropic SDK/endpoint accepts empty text blocks, OR that `aggregated.content` is never empty when `toolCalls` is non-empty, OR a passing test sending an assistant message with `content:''` + tool_use.

- severity: P1
  confidence: 0.65
  location: src/agent/loop.ts:76 (trimMessages) feeding :37
  claim: `trimMessages` slices the last 40 messages by count, which can drop an assistant(tool_calls) message while keeping its `tool` result — producing an orphaned tool_result the provider APIs reject.
  evidence: `messages.slice(-40)` has no awareness of tool_call/tool_result pairing. If the 40-message window starts on a `tool` message whose preceding assistant tool_calls message is at index -41, the request begins with a tool result that has no matching tool_use/tool_calls. Both Anthropic ("tool_result without preceding tool_use") and OpenAI ("tool message must follow tool_calls") reject this.
  how_to_disprove: Show the window can never split a pair (e.g. pairs are always co-located within 40), or that the provider tolerates a leading orphan tool result.

- severity: P2
  confidence: 0.5
  location: src/agent/loop.ts:79,87 (replaceLiteralOnce in previewDiff)
  claim: The approval diff preview for `replace_string` may not match what the tool actually does (first-occurrence-only vs all-occurrences, or differing literal semantics), so the human approves a diff that differs from the real edit.
  evidence: `replaceLiteralOnce` does `content.replace(oldString, () => newString)` — first occurrence only. If the real `replace_string` tool replaces all occurrences or validates uniqueness differently, the previewed diff misleads the approver. Needs cross-check against src/tools/replace_string.ts.
  how_to_disprove: Show replace_string.ts also replaces exactly the first literal occurrence with identical semantics.

- severity: P2
  confidence: 0.55
  location: src/agent/loop.ts:59
  claim: Approval is an unbounded Promise resolved only by an `approval-request` event consumer; if no consumer resolves it (e.g. a headless/non-TUI host that ignores the event), the turn hangs forever with no timeout.
  evidence: `await new Promise<boolean>((resolve) => options.onEvent({ type:'approval-request', ..., resolve }))`. There is no timeout or default. Liveness depends entirely on every host wiring `resolve`. Headless mode docs say un-approved tools are denied — verify that path actually calls `resolve(false)` rather than dropping the event.
  how_to_disprove: Show every onEvent host (TUI + headless) guarantees `resolve` is always called.

### completeness note (claude)
Untested files in scope with no `*.test.ts`: `agent/loop.ts`, `llm/providers/anthropic.ts`,
`policy/approval.ts`. `openai.ts` has a test; `anthropic.ts` does not despite sharing the
same fragile streaming contract — that asymmetry is why the P0 above likely shipped.

---

## codex findings

- severity: P0
  confidence: 0.95
  location: src/llm/providers/anthropic.ts:38
  claim: Anthropic tool calls with streamed JSON arguments are reassembled with duplicated function names, so the agent cannot resolve the requested tool.
  evidence: `content_block_start` yields `{ id, name, arguments: '' }` at src/llm/providers/anthropic.ts:33, then every `input_json_delta` yields the same `name: toolNames.get(event.index)` at src/llm/providers/anthropic.ts:38. `aggregateStream` concatenates names with `existing.function.name += chunk.toolCall?.name ?? ''` at src/llm/stream.ts:29, and `runTurn` looks up the exact final name at src/agent/loop.ts:46. A streamed `read_file` call with one argument delta becomes `read_fileread_file`; with multiple deltas it grows further and falls into `Unknown tool`.
  how_to_disprove: Show an Anthropic stream where argument-bearing tool calls never emit `input_json_delta`, or a provider normalization test where a multi-delta Anthropic tool call aggregates to exactly one bare tool name.

- severity: P1
  confidence: 0.85
  location: src/llm/providers/anthropic.ts:58
  claim: Replaying an assistant message that contains only tool calls emits an empty text content block before the `tool_use` blocks, which is an invalid Anthropic message shape.
  evidence: `runTurn` persists assistant tool-call turns as `{ role: 'assistant', content: aggregated.content, toolCalls: ... }` at src/agent/loop.ts:40. When the model produced no text, `aggregated.content` is `''`. `toAnthropicMessage` still serializes that as `{ type: 'text', text: message.content }` before the tool uses at src/llm/providers/anthropic.ts:58, unlike `CodexOAuthProvider`, which only emits assistant text when `message.content` is truthy at src/llm/providers/codex-oauth.ts:149.
  how_to_disprove: Show the Anthropic API accepts `{ type: 'text', text: '' }` inside assistant content arrays, or a passing Anthropic provider test that replays `{ role: 'assistant', content: '', toolCalls: [...] }`.

- severity: P1
  confidence: 0.7
  location: src/llm/providers/anthropic.ts:55
  claim: Multiple tool results from the same assistant turn are replayed to Anthropic as multiple separate user messages instead of one user message containing all matching `tool_result` blocks.
  evidence: `runTurn` executes all aggregated tool calls in one assistant turn at src/agent/loop.ts:45 and appends one `role: 'tool'` message per result via `pushToolResult` at src/agent/loop.ts:68 and src/agent/loop.ts:77. `toAnthropicMessage` maps each individual `tool` message to its own `{ role: 'user', content: [{ type: 'tool_result', ... }] }` at src/llm/providers/anthropic.ts:53-55. A turn with two tool calls therefore replays as `assistant(tool_use A+B), user(tool_result A), user(tool_result B)`. The installed Anthropic SDK's own tool runner batches all results for one assistant message into a single `{ role: 'user', content: toolResults }`, which is the shape this adapter does not produce.
  how_to_disprove: Show Anthropic accepts split consecutive user messages for the results of one assistant message with multiple `tool_use` blocks, or add a provider test that serializes two tool results from one turn and receives a successful Anthropic response.

- severity: P2
  confidence: 0.65
  location: src/agent/loop.ts:75
  claim: Malformed tool-call JSON is silently converted to `{}`, which lets optional-argument or no-argument tools execute instead of returning a parse error.
  evidence: `parseArgs` catches `JSON.parse` failures and returns `{}` at src/agent/loop.ts:75; the result is passed to `tool.parameters.safeParse(...)` at src/agent/loop.ts:51. Tools such as `git_status` use `z.object({})`, and `list_files` has only optional parameters, so a malformed argument string for those tools can pass validation and run with defaults rather than producing the existing validation-error path at src/agent/loop.ts:52-54.
  how_to_disprove: Show every registered tool schema rejects `{}`, or change `parseArgs` to return an explicit parse failure that reaches `pushToolResult` without running the tool.

### comparison

- Claude P0 at src/llm/providers/anthropic.ts:37-39: confirmed. The provider violates the key contract by keeping a stable id but not emitting the name exactly once. OpenAI avoids this at src/llm/providers/openai.ts:37-46 by mapping index to id while allowing later deltas to omit the name; Codex avoids it at src/llm/providers/codex-oauth.ts:191-198 by yielding only the completed function call.
- Claude P1 at src/llm/providers/anthropic.ts:58: confirmed. The replay path can persist `content: ''` at src/agent/loop.ts:40, and Anthropic serialization unconditionally prepends an empty text block at src/llm/providers/anthropic.ts:58. Codex's adapter is a useful contrast because it skips empty assistant text at src/llm/providers/codex-oauth.ts:149.
- Claude P1 at src/agent/loop.ts:76: confirmed. `trimMessages` slices by count with no pairing logic, so a retained `role: 'tool'` message from src/agent/loop.ts:77 can lose the preceding assistant `toolCalls` from src/agent/loop.ts:40. This breaks OpenAI's `tool`-after-`tool_calls` requirement and Anthropic's `tool_result`-after-`tool_use` requirement.
- Claude P2 at src/agent/loop.ts:79,87: partially confirmed. The "replace all occurrences" concern is refuted by src/tools/replace_string.ts:8, which replaces one occurrence only after requiring `count === 1`. A narrower mismatch remains: `previewDiff` at src/agent/loop.ts:87 previews the first replacement even when the real tool would reject zero or duplicate matches and make no edit.
- Claude P2 at src/agent/loop.ts:59: mostly refuted for current hosts. Headless always resolves approval requests true/false at src/headless.ts:59-65, and the TUI resolves them on `y`/`n` at src/tui/components/input-bar.tsx:27-29. There is still no timeout at the `runTurn` boundary, but the existing first-party event consumers do not drop the resolver.
- Missed: Anthropic's adapter also splits multiple results for one tool-use turn into separate user messages at src/llm/providers/anthropic.ts:53-55, because the core loop stores each tool result independently at src/agent/loop.ts:77.
- Missed: `parseArgs` at src/agent/loop.ts:75 erases malformed JSON into `{}`, so some tools can run with defaults instead of reporting the malformed arguments.

---

## pi findings

- severity: P0
  confidence: 0.95
  location: src/llm/providers/anthropic.ts:38 (vs src/llm/stream.ts:29)
  claim: Independently confirmed — the Anthropic provider re-emits the full tool `name` on every `input_json_delta`, so `aggregateStream` concatenates it into a duplicated name that never resolves to a registered tool.
  evidence: `content_block_start` yields `{ id, name, arguments: '' }` once (anthropic.ts:33). Each `input_json_delta` then yields `name: toolNames.get(event.index)` (anthropic.ts:38) — the FULL name, e.g. `"read_file"`. The aggregator does `existing.function.name += chunk.toolCall?.name ?? ''` (stream.ts:29), so for a call with 2 arg deltas the name becomes `read_fileread_fileread_file`; `stream.ts:35` only filters out EMPTY names so the bogus name survives; `runTurn` then fails at loop.ts:46-48 with `Unknown tool: read_fileread_fileread_file`. No-arg tools (no `input_json_delta`) are the only survivors. `openai.ts:45-46` avoids it by mapping index→id and letting later deltas omit `name`.
  how_to_disprove: Show an Anthropic stream where argument-bearing tool calls emit no `input_json_delta`, OR an integration test where a multi-delta Anthropic tool call aggregates to exactly one bare tool name.

- severity: P1
  confidence: 0.8
  location: src/llm/providers/anthropic.ts:58 (fed by src/agent/loop.ts:40)
  claim: Independently confirmed — a tool-only assistant turn is replayed with a leading empty `{type:'text', text:''}` block, which Anthropic rejects.
  evidence: loop.ts:40 stores `content: aggregated.content` which is `''` when the model emitted only tool calls. `toAnthropicMessage` unconditionally prepends `{ type: 'text', text: message.content }` before the `tool_use` blocks (anthropic.ts:58). Contrast: codex-oauth.ts:152-153 only pushes assistant text `if (message.content)`.
  how_to_disprove: Show Anthropic accepts `{type:'text', text:''}` in an assistant content array, or that `aggregated.content` is never empty when `toolCalls` is non-empty.

- severity: P1
  confidence: 0.8
  location: src/agent/loop.ts:76
  claim: Independently confirmed — `trimMessages` slices the last 40 messages by count with no tool_call/tool_result pairing, so the window can begin with an orphaned `tool` result whose preceding assistant `tool_calls`/`tool_use` was dropped.
  evidence: `messages.slice(-40)` (loop.ts:76) is pair-unaware. A retained `role:'tool'` message (pushed at loop.ts:77) serializes to an Anthropic `tool_result` with no preceding `tool_use` (anthropic.ts:54-55) or an OpenAI `tool` message with no preceding `tool_calls` (openai.ts:59); both APIs reject a leading orphan. The system message is prepended outside the slice (loop.ts:37) so it cannot repair the pairing.
  how_to_disprove: Show the 40-window can never split an assistant(tool_calls)+tool(result) pair, or that either provider tolerates a leading orphan tool result.

- severity: P2
  confidence: 0.9
  location: src/llm/providers/anthropic.ts:41-44
  claim: NEW — neither prior reviewer caught this. Anthropic `promptTokens`/`totalTokens` are always reported as if input were 0, because `input_tokens` is read off `message_delta`, where it is `null` at runtime; the real `input_tokens` arrives only on `message_start`, which the provider never handles.
  evidence: anthropic.ts:42 does `const input = event.usage.input_tokens ?? 0` inside the `message_delta` branch only. The installed SDK's own `MessageStream` (node_modules/@anthropic-ai/sdk/lib/MessageStream.mjs:433) seeds `input_tokens` from `message_start`, and at lines 453-455 only copies `message_delta.usage.input_tokens` onto the snapshot when `!= null` — i.e. the SDK itself assumes the delta's `input_tokens` is null. So at runtime `event.usage.input_tokens ?? 0` is `0`, yielding `promptTokens: 0` and `totalTokens === completionTokens` for every Anthropic turn. Consumed at headless.ts:72 (`(0 in / M out)`) and app.tsx usage event. The asymmetry is visible in the sibling provider: codex-oauth.ts:201 reads `input_tokens` from `response.completed` and gets the right value.
  how_to_disprove: Capture a live Anthropic stream where `message_delta.usage.input_tokens` is a non-null number (then the `?? 0` is harmless); or show the API populates it on the delta in current versions.

- severity: P2
  confidence: 0.7
  location: src/agent/loop.ts:36-70 (esp. :38 and :66)
  claim: NEW (partial-state variant) — `runTurn` has no internal `try/catch` around provider streaming or tool execution, so a throw bypasses the `onEvent` `error`/`done` channel and leaves a partially-persisted turn in session storage.
  evidence: The only try/catch in loop.ts are parseArgs (:75) and previewDiff (:83). The `await aggregateStream(...)` (:38) and `await tool.run(...)` (:66) are unwrapped. The assistant message is already pushed and appended at loop.ts:41-42 before any tool runs, so a throw mid-loop persists an assistant(tool_calls) whose Nth result was never written — which on resume replay also feeds the orphan-tool_result problem above. The two first-party hosts recover via promise rejection (TUI app.tsx:79 `.catch` → `add-error`; headless rethrows by contract), so this is NOT a hard hang — the gap is that the error is funneled through promise rejection instead of the agent event stream, and partial state is not rolled back.
  how_to_disprove: Show a host that waits only on the `done`/`error` events (not on runTurn's promise) and would hang — or that the session is rolled back on throw.

- severity: P2
  confidence: 0.7
  location: src/agent/loop.ts:75 → :51
  claim: Independently confirmed (codex's finding) — `parseArgs` swallows malformed JSON into `{}`, so optional-arg / no-arg tools can execute with defaults instead of returning a parse error.
  evidence: `parseArgs` returns `{}` on JSON.parse failure (loop.ts:75); that `{}` is fed to `tool.parameters.safeParse(...)` (loop.ts:51). Tools whose schema is `z.object({})` or has only optional fields pass and run with defaults rather than hitting the validation-error path at loop.ts:52-54.
  how_to_disprove: Show every registered tool schema rejects `{}`, or change `parseArgs` to surface a parse failure that reaches `pushToolResult` without running the tool.

- severity: P2
  confidence: 0.6
  location: src/agent/loop.ts:59
  claim: Independently confirmed (claude's finding, tempered by codex) — approval is an unbounded promise at the runTurn boundary; there is no timeout, only host discipline.
  evidence: loop.ts:59 `await new Promise<boolean>((resolve) => options.onEvent({ type:'approval-request', ..., resolve }))` has no timeout/default. Both first-party hosts do resolve it (headless.ts:59-65 always calls `resolve(true|false)`; TUI input-bar.tsx:27-29 resolves on `y`/`n`). So not currently a hang; defense-in-depth only. Edge: TUI Ctrl+C (input-bar.tsx:26) exits without resolving — moot because the process exits.
  how_to_disprove: Show every `onEvent` host guarantees `resolve` is always called, or that a default timeout exists.

### comparison

Claude's findings:
- P0 (anthropic.ts:38, dup tool name): CONFIRMED. The contract is violated precisely as described — stable `id` but `name` emitted on every `input_json_delta` (anthropic.ts:38) while `aggregateStream` concatenates `name` (stream.ts:29). `openai.ts:45-46` and `codex-oauth.ts` (yields the whole call once at `response.output_item.done`, see codex-oauth.ts:189-191) both avoid it. (Minor: claude cited :37-39; the offending yield is at :38 and the first emit at :33 — substance unaffected.)
- P1 (anthropic.ts:58, empty text block): CONFIRMED. loop.ts:40 stores `content: ''` for tool-only turns; anthropic.ts:58 prepends an empty text block unconditionally. codex-oauth.ts:152-153 is the correct contrast.
- P1 (loop.ts:76, orphaned tool result): CONFIRMED. Count-based slice with no pairing; breaks both Anthropic `tool_result`-after-`tool_use` and OpenAI `tool`-after-`tool_calls`. Note the system message prepended at loop.ts:37 is outside the slice and cannot repair it.
- P2 (loop.ts:79,87, replaceLiteralOnce): PARTIALLY REFUTED. The implied "real tool replaces all occurrences" is wrong — `replace_string.ts:8` requires `count === 1` and does a single literal replace, matching `replaceLiteralOnce`'s first-occurrence semantics in the happy path. The narrower, valid mismatch (also called out by codex): `previewDiff` (loop.ts:87) previews a replacement WITHOUT the `count === 1` check, so the human can approve a diff for a 0- or 2+-match input that the real tool will reject with no edit. Also both `String.replace` (loop.ts:79) and `split` (replace_string.ts:8) treat the needle as a literal string, so there's no regex-escaping divergence.
- P2 (loop.ts:59, approval timeout): CONFIRMED as defense-in-depth — no timeout exists, but current hosts resolve (see finding above).

Codex's findings:
- P0 (anthropic.ts:38, dup name): CONFIRMED — same root as claude's P0.
- P1 (anthropic.ts:58, empty text block): CONFIRMED — same as claude's P1; the codex-oauth.ts:149 contrast is apt.
- P1 (anthropic.ts:54-55, multiple tool results split into separate user messages): OVERSTATED / PARTIALLY REFUTED. The Anthropic Messages API does not mandate batching all `tool_result` blocks for one assistant turn into a single user message — consecutive user messages each carrying `tool_result`(s) are accepted as long as every `tool_use` is answered once and results follow the assistant turn. The documented examples batch for convention, not as a hard rule. The genuine invariant here is pair-completeness, which collapses into the trimMessages orphan problem above, not into a "split is rejected" failure. (Caveat: I could not run a live multi-tool Anthropic call to be 100% certain; a provider test that serializes two same-turn results and gets a 200 would fully settle it.)
- P2 (loop.ts:75, parseArgs → {}): CONFIRMED — see my P2 above.

What BOTH missed:
1. Anthropic usage accounting (P2, my finding at anthropic.ts:41-44): `promptTokens`/`totalTokens` are silently wrong because `input_tokens` is read from `message_delta` (null at runtime per the SDK's own `MessageStream` guard at lib/MessageStream.mjs:453-455) instead of `message_start`. Both reviewers read this exact file and this exact branch; neither flagged that the input-token source is wrong while the sibling codex provider reads it correctly (codex-oauth.ts:201).
2. No internal try/catch in `runTurn` (P2, my finding at loop.ts:36-70): a throw from the provider stream (:38) or `tool.run` (:66) skips the `error`/`done` event channel and persists a partial assistant turn (:41-42). Both reviewers analyzed loop.ts line-by-line and focused on logic/serialization bugs but not on failure/rollback paths.
3. (Lower-confidence, not filed as a separate finding) The codex split-results P1 and the claude trim-orphan P1 are two facets of ONE invariant — "tool_use/tool_result pair integrity" — yet both were filed as independent provider-shape issues; the shared root is that loop.ts stores each tool result as its own message (loop.ts:77) and trims by count (loop.ts:76), so any boundary (trim OR a mid-turn crash) can sever a pair for either provider.

---

## synthesis

Three independent reviewers (claude/opus, codex/gpt-5.5, pi/glm-5.2). Verdicts below are the
orchestrator's after central verification (reading the code + the installed Anthropic SDK).

| # | Sev | Agreement (conf) | Location | Claim | Verdict |
|---|-----|------------------|----------|-------|---------|
| 1 | **P0** | claude .9 · codex .95 · pi .95 | anthropic.ts:38 | Tool `name` re-emitted on every `input_json_delta`; aggregator concatenates → `Unknown tool: read_fileread_file…` | **REAL** — verified by code logic (stream.ts:29 concatenates, :35 only drops empty). All argument-bearing tool calls break. |
| 2 | **P1** | claude .8 · codex .85 · pi .8 | anthropic.ts:58 | Tool-only assistant turn serialized with empty `{type:'text',text:''}` block → Anthropic 400 | **REAL** — verified vs codex-oauth.ts:152 which guards `if (message.content)`. |
| 3 | **P1** | claude .65 · codex ✓ · pi .8 | loop.ts:76 | `trimMessages` slices by count, can orphan a tool_result (breaks Anthropic + OpenAI) | **REAL** — count-based slice is pair-unaware. |
| 4 | P2* | codex .7 · pi refutes · claude — | anthropic.ts:53-55 | Multiple same-turn tool_results sent as separate user messages | **CONTESTED** — SDK enforces no role-alternation; Anthropic merges consecutive same-role msgs, so likely accepted. Real invariant = #3 (pair integrity). Fix = batch anyway (safe superset). Needs a live call to settle. |
| 5 | P2 | pi .9 (solo) | anthropic.ts:41-44 | `promptTokens`/`totalTokens` always count input as 0 | **REAL** — verified vs SDK MessageStream.mjs:453: `input_tokens` is seeded on `message_start` (unhandled here) and is null on `message_delta`. |
| 6 | P2 | codex .65 · pi .7 | loop.ts:75 | `parseArgs` swallows malformed JSON → `{}`, lets no-arg/optional tools run instead of erroring | **REAL (minor)** — only bites tools whose schema accepts `{}`. |
| 7 | P2 | pi .7 (solo) | loop.ts:36-70 | No try/catch around stream/tool.run; throw persists a partial turn, bypasses event channel | **REAL (minor)** — hosts recover via promise rejection; gap is no rollback + error not on event stream. |
| 8 | P2 | claude→codex→pi (downgraded ~.4) | loop.ts:87 | Approval preview shows an edit even when `replace_string` would reject count≠1 | **REAL (cosmetic)** — tool fails safe; only the preview misleads. Original "replace-all" framing was wrong. |
| 9 | P2 | claude/codex/pi all tempered (~.5) | loop.ts:59 | Approval promise has no timeout/default | **LOW** — both first-party hosts always resolve (headless.ts:59, input-bar.tsx:27). Defense-in-depth only. |

### Recommended fix order
1. **#1 (P0)** — drop `name` from the `input_json_delta` yield in anthropic.ts:38 (emit name once at content_block_start, like openai). One-line fix; unblocks the entire Anthropic provider.
2. **#2 (P1)** — guard the empty text block in toAnthropicMessage (anthropic.ts:58): only include the text block `if (message.content)`.
3. **#3 (P1)** — make `trimMessages` pair-aware: never start the window on an orphan tool result (drop a leading tool message, or trim to a safe boundary).
4. **#5 (P2)** — read `input_tokens` from `message_start` in anthropic normalize().
5. **#6, #7, #8** — small hardening (parseArgs surfaces parse errors; runTurn try/catch + rollback; previewDiff respects count===1). #4 folds into #3; batch tool_results when fixing #2/#3. #9 optional.

Every fix above is unit-testable without a live API by feeding synthetic events through
`normalize()` + `aggregateStream` — which is also the test gap that let #1/#2/#5 ship
(anthropic.ts has no test; openai.ts does).
