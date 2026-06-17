# CODEX P0 Findings

## Bug #4 - OpenAI streaming tool-call aggregation drops argument fragments

### Confirmed root cause

- `src/llm/providers/openai.ts:37-39` forwards streamed OpenAI tool-call deltas as `{ id: call.id, name: call.function?.name, arguments: call.function?.arguments }` and drops `call.index`.
- `src/llm/stream.ts:26-31` groups tool-call chunks only by `chunk.toolCall.id`; if `id` is absent, it creates a fresh `tool-${anonymousIndex++}` for that single chunk.
- OpenAI Chat Completions streaming commonly sends `id` and `function.name` only on the first delta for a tool call, then sends later argument fragments keyed by the same `index` but with `id`/`name` omitted. Those later chunks become fresh anonymous calls in `aggregateStream`.
- `src/llm/stream.ts:35` filters out calls without a function name, so those anonymous argument-only chunks are dropped. The surviving tool call keeps only the first argument fragment, producing invalid or incomplete JSON.
- The current `StreamChunk` contract at `src/llm/types.ts:24-28` has no `index` field, so fixing this in the aggregator would require widening the provider-neutral stream contract for an OpenAI-specific delta concept.

### Recommended precise fix approach

Fix this in the OpenAI adapter, not in `aggregateStream`.

Rationale:

- `aggregateStream` already works when providers emit a stable tool-call id across deltas.
- Anthropic already normalizes provider-specific indexes to stable ids in its adapter (`src/llm/providers/anthropic.ts:27-39`), so OpenAI should follow the same boundary.
- Keeping `index` out of `StreamChunk` avoids leaking OpenAI-specific streaming mechanics into all providers.

Implementation shape in `src/llm/providers/openai.ts`:

- Inside `normalize()`, create `const toolIds = new Map<number, string>();`.
- For each `call` in `delta?.tool_calls ?? []`:
  - Read `const index = call.index;`.
  - If `call.id` is present and `index` is a number, store `toolIds.set(index, call.id)`.
  - Compute a stable id:
    - If `call.id` exists, use it.
    - Else if `index` is a number and `toolIds` has it, use the stored id.
    - Else if `index` is a number, use a stable fallback like `openai-tool-${index}` for streams that omit ids entirely.
    - Else leave `id` undefined only as a last-resort malformed-provider case.
  - Yield the tool chunk with that stable id and the current `name`/`arguments` fragments.
- Do not concatenate names in the adapter. Let `aggregateStream` continue appending name and argument fragments. Since OpenAI sends the name only once, this yields the right final name.
- Multiple parallel tool calls are handled because OpenAI indexes are distinct per streamed tool call. Interleaved chunks for index `0` and index `1` resolve to different stable ids.
- Interleaved content and usage need no special changes: `aggregateStream` already appends content in `src/llm/stream.ts:16-20` and records usage in `src/llm/stream.ts:22-24`.

### Exact regression test

Add `src/llm/providers/openai.test.ts` with a mocked OpenAI client and aggregate the provider stream. The test should fail on the current code because the second argument fragments are dropped.

Test name:

```ts
it('keeps OpenAI tool-call argument deltas keyed by index when later chunks omit id and name', async () => { ... });
```

Test setup:

- Mock `openai` so `new OpenAI().chat.completions.create()` returns an async iterable yielding:
  1. A content delta: `{ choices: [{ delta: { content: 'before ' } }] }`
  2. First tool-call deltas for two parallel calls:
     - `{ index: 0, id: 'call_a', function: { name: 'read_file', arguments: '{"path"' } }`
     - `{ index: 1, id: 'call_b', function: { name: 'list_files', arguments: '{"path"' } }`
  3. Another content delta: `{ choices: [{ delta: { content: 'after' } }] }`
  4. Later argument-only deltas:
     - `{ index: 0, function: { arguments: ':"a.ts"}' } }`
     - `{ index: 1, function: { arguments: ':"src"}' } }`
  5. A usage chunk: `{ choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } }`
- Instantiate `new OpenAiProvider({ apiKey: 'test' })`.
- Call `provider.stream(...)`, then pass the returned iterable to `aggregateStream`.
- Assert:
  - `result.content === 'before after'`
  - `result.usage?.totalTokens === 7`
  - `result.toolCalls` has length `2`
  - call `call_a` has `function.name === 'read_file'` and `function.arguments === '{"path":"a.ts"}'`
  - call `call_b` has `function.name === 'list_files'` and `function.arguments === '{"path":"src"}'`

This covers id+name only on the first delta, two parallel calls with distinct indexes, interleaved content, and usage chunks.

## Bug #6 - `apply_patch` cannot delete files

### Confirmed root cause

- `src/tools/apply_patch.ts:20` chooses `filePatch.newFileName ?? filePatch.oldFileName`. For a normal deletion patch, `newFileName` is `/dev/null`, so it selects `/dev/null`.
- `src/tools/apply_patch.ts:34-36` rejects `/dev/null` by returning `null`.
- `src/tools/apply_patch.ts:21` then returns `Patch file is missing a filename.`, so deletion patches never reach application.
- Even if the old filename were selected, `src/tools/apply_patch.ts:27-28` always creates the parent directory and writes `next`; there is no `fs.unlink` branch, so a deletion would not remove the file.

### Recommended precise fix approach

Add an explicit deletion branch in `src/tools/apply_patch.ts`.

Implementation shape:

- Introduce helpers:
  - `isDevNull(fileName?: string): boolean` for `fileName === '/dev/null'`.
  - `isDeletionPatch(filePatch): boolean` for `isDevNull(filePatch.newFileName) && !isDevNull(filePatch.oldFileName)`.
  - `patchPathForDeletion(filePatch): string | null` that normalizes `oldFileName`.
  - `patchPathForWrite(filePatch): string | null` that normalizes `newFileName ?? oldFileName` but still rejects `/dev/null`.
- In the loop, before the existing write path:
  - If it is a deletion patch, normalize the old filename, resolve it through `resolveWorkspacePath`, and read existing content.
  - Run `applyPatch(oldContent, { ...filePatch, oldFileName: fileName, newFileName: fileName })` as validation only. For a valid deletion, `diff.applyPatch` should return the expected post-patch content, normally an empty string. If it returns `false`, fail before deleting.
  - Snapshot first with `await snapshotFile(ctx.workspaceRoot, ctx.sessionId, fileName)`.
  - Delete with `await fs.unlink(abs)`.
  - Continue to the next file patch.
- For non-deletion patches, keep the existing write path.

Partial/multi-file patch guard:

- The current implementation mutates each file as it iterates. In a multi-file patch, file 1 can be modified before file 2 fails, leaving a partial apply.
- For deletion support, do not make this worse. Prefer a two-phase approach for all patch files:
  1. Validation phase: parse all patches, normalize paths, resolve workspace boundaries, read old contents, run `applyPatch` for every file, and build an operation list (`write` or `delete`). If any operation fails, return an error before touching the filesystem.
  2. Apply phase: for each operation, snapshot the target file first, then `writeFile` or `unlink`.
- This guards mixed patches like "delete `a.txt`, modify `b.txt`" from deleting `a.txt` before discovering that `b.txt` has a mismatched hunk.
- If a deletion target is already missing, return an error during validation rather than treating missing content as empty. That avoids silently reporting success for a delete that did not happen.

### Exact regression test

Add tests to `src/patch/applier.test.ts`.

Test 1:

```ts
it('deletes a file for a unified diff deletion patch and snapshots it first', async () => { ... });
```

Setup and assertions:

- Create a temp workspace.
- Write `a.txt` with `one\ntwo\n`.
- Use this patch:

```diff
--- a/a.txt
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
```

- Run `applyPatchTool.run({ patch }, ctx(root))`.
- Assert `result.ok === true`.
- Assert `fs.existsSync(path.join(root, 'a.txt')) === false`.
- Assert a snapshot exists under `.harness/snapshots/test/` and contains `one\ntwo\n`. Since snapshot names include a timestamp, find files recursively under that directory and assert at least one file ending in `a.txt` has the original content.

Test 2:

```ts
it('does not partially apply a multi-file patch when a later file fails', async () => { ... });
```

Setup and assertions:

- Create `a.txt` with `delete me\n`.
- Create `b.txt` with `actual\n`.
- Use a single patch containing:
  - a valid deletion for `a.txt`
  - an invalid modification for `b.txt` whose hunk expects `expected\n`
- Run `applyPatchTool.run({ patch }, ctx(root))`.
- Assert `result.ok === false`.
- Assert `a.txt` still exists with `delete me\n`.
- Assert `b.txt` still contains `actual\n`.
- Assert no deletion snapshot was created for `a.txt` if validation fails before the apply phase. If the implementation snapshots during apply only after all validation passes, this should be true.

These tests verify deletion detection via `newFileName === '/dev/null'`, snapshot-before-delete behavior, and the no-partial-apply guard for mixed multi-file patches.
