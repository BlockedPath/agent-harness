# Sandbox Security Review (relay)

## RELAY PROTOCOL
Scope: `src/sandbox/executor.ts`, `src/sandbox/profiles.ts`, `src/sandbox/workspace-boundary.ts`.
Focus: can a command run by the agent escape the sandbox, exfiltrate secrets (files or env),
escape the workspace path boundary, or hang/leak processes? Shared file: SANDBOX_REVIEW.md.

The ORCHESTRATOR drives every hop — do NOT forward to another agent. When prompted:
1. Independently review the scope (don't just trust prior sections).
2. Append a `## <yourname> findings` section using the STRUCTURED FINDING SCHEMA below.
3. Add a `### comparison` block: which prior findings you confirm, which you refute + why,
   what was missed.
4. STOP. The orchestrator handles the next step.

## STRUCTURED FINDING SCHEMA (required for every finding)
```
- severity: P0 | P1 | P2
  confidence: 0.0–1.0
  location: path:line
  claim: one sentence
  evidence: exact code or a concrete repro/trigger
  how_to_disprove: what would show this is NOT a bug
```

---

## codex findings

- severity: P0
  confidence: 0.95
  location: src/sandbox/executor.ts:37
  claim: The executor fails open to an unsandboxed `/bin/sh` whenever the platform is not darwin, `sandbox-exec` is missing, or the requested mode is `dangerous`.
  evidence: `profile` is `null` off darwin at `src/sandbox/executor.ts:37`; `useSandbox` is false when `profile` is null or `/usr/bin/sandbox-exec` is unavailable at `src/sandbox/executor.ts:38`; the command then becomes plain `/bin/sh -c` at `src/sandbox/executor.ts:39-40`; `buildProfile` intentionally returns `null` for `dangerous` at `src/sandbox/profiles.ts:30`. A concrete trigger is `runSandboxed({ cwd: workspaceRoot, workspaceRoot, mode: 'dangerous', command: 'cat ~/.ssh/id_rsa' })`, which runs without a seatbelt profile.
  how_to_disprove: Show that every production caller rejects non-darwin, missing `sandbox-exec`, and `dangerous` mode before `runSandboxed`, or that another OS-level sandbox is applied to the fallback `/bin/sh`.

- severity: P0
  confidence: 0.9
  location: src/sandbox/profiles.ts:35
  claim: The macOS sandbox still permits broad file-secret exfiltration because both read-only and workspace-write profiles allow all file reads and deny only a small credential-store list.
  evidence: The read-only profile emits `(allow file-read*)` at `src/sandbox/profiles.ts:35`, and the workspace-write profile emits the same broad read allow at `src/sandbox/profiles.ts:43`; `denySecretReads` only blocks `.ssh`, `.aws`, `.gnupg`, `.config/gcloud`, `.docker`, `.codex`, `.netrc`, `.npmrc`, and `.harness/auth` at `src/sandbox/profiles.ts:16-24`. A concrete trigger in `workspace-write` mode is `cat ~/.git-credentials ~/.kube/config ~/.pypirc 2>/dev/null`, which is not covered by the deny list and streams matching contents back through tool stdout.
  how_to_disprove: Demonstrate that seatbelt has a separate default deny for those paths despite `(allow file-read*)`, or expand tests to prove representative secret files such as `~/.git-credentials`, `~/.kube/config`, and `~/.pypirc` are denied.

- severity: P1
  confidence: 0.85
  location: src/sandbox/executor.ts:21
  claim: Environment secret filtering is deny-list based and misses common secret-bearing variables.
  evidence: `SENSITIVE_ENV` only removes names matching `(API_KEY|_KEY$|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_AUTH$|SESSION)` at `src/sandbox/executor.ts:21`; `sanitizeEnv` copies every non-matching key/value into the child env at `src/sandbox/executor.ts:23-29`. Concrete misses include `DATABASE_URL`, `REDIS_URL`, `GITHUB_PAT`, and `SLACK_WEBHOOK_URL`; `runSandboxed({ ..., command: 'printf %s \"$DATABASE_URL\"' })` would expose `DATABASE_URL` if present.
  how_to_disprove: Show that the runtime never contains secrets outside this regex, or replace the deny list with an allow list and prove only required non-secret variables are passed.

- severity: P1
  confidence: 0.8
  location: src/sandbox/executor.ts:55
  claim: Timeout cleanup can still leak descendant processes that create a new process group or session before the executor settles.
  evidence: Timeout cleanup signals only `-child.pid` at `src/sandbox/executor.ts:55-68`, and normal completion clears both timers at `src/sandbox/executor.ts:58-63`. A concrete trigger is a command that spawns a detached grandchild with closed stdio, for example `python3 -c 'import subprocess; subprocess.Popen(["sleep","999"], start_new_session=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)'`; the shell exits, `close` settles at `src/sandbox/executor.ts:75`, timers are cleared, and the new-session `sleep` is no longer in `child.pid`'s process group.
  how_to_disprove: Show that the sandbox forbids `setsid`/new-session process creation for every mode and platform, or add a process-supervision mechanism that tracks and kills descendants outside the original process group.

### comparison

No prior completed agent findings were present; `pi` and `omp` are still pending placeholders. I independently confirm the main unresolved risks are fail-open sandboxing, broad file reads, residual env-secret exposure, and process leakage. I did not find a concrete workspace path-boundary escape in `src/sandbox/workspace-boundary.ts`: `assertInsideWorkspace` realpaths both the workspace root and target (`src/sandbox/workspace-boundary.ts:5-7`), and `resolveWorkspacePath` normalizes `..` segments before checking (`src/sandbox/workspace-boundary.ts:12-15`).

## pi findings

- severity: P0
  confidence: 0.9
  location: src/sandbox/profiles.ts:9,16
  claim: `(allow process-exec)` is unscoped in both profiles — a sandboxed command can exec ANY binary on the system, which amplifies the broad `(allow file-read*)` into interpreter-powered secret exfiltration.
  evidence: Both profiles emit `(allow process-exec)` at `profiles.ts:9` and `profiles.ts:16` with no `(subpath …)` restriction. A command like `python3 -c "print(open(expanduser('~/.git-credentials')).read())"` runs without seatbelt blocking the interpreter launch; the read is allowed by `(allow file-read*)` at `profiles.ts:10`/`:17`, and the output streams back through stdout into the tool-result message. The deny-list in `denySecretReads` (`profiles.ts:27-36`) blocks 9 paths — none of which are `.git-credentials`, `.kube/config`, `.pypirc`, `.pgpass`, `.my.cnf`, or `~/.config/gh/hosts.yml`. An interpreter-based read bypasses any future path-pattern restrictions since it can glob, loop, or time-read.
  how_to_disprove: Show that seatbelt restricts `process-exec` to a specific allow-list of interpreters (e.g. only `/bin/sh`, `/usr/bin/sandbox-exec`), or demonstrate that `(allow file-read*)` combined with interpreter access is blocked by a higher-level seatbelt directive not visible in the profile string.

- severity: P0
  confidence: 0.85
  location: src/sandbox/executor.ts:21
  claim: `sanitizeEnv` correctly strips `TOKEN`/`SECRET`/`KEY`/`PASSWORD` names, but misses URL-embedded credentials — connection-string env vars like `DATABASE_URL`, `REDIS_URL`, `MONGODB_URI` pass through unfiltered and expose embedded `user:password@host` to tool stdout.
  evidence: `SENSITIVE_ENV` regex at `executor.ts:21` matches `(API_KEY|_KEY$|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|_AUTH$|SESSION)` — none match `*_URL` or `*_URI`. `sanitizeEnv` at `executor.ts:23-28` copies every non-matching key/value into the child env. A concrete trigger is `echo "$DATABASE_URL"` inside any sandboxed command, which prints e.g. `postgresql://admin:s3cret@db.internal:5432/mydb` into stdout — captured at `executor.ts:47-53` and returned as the tool result without filtering.
  how_to_disprove: Show that `DATABASE_URL`-style vars are never present in `process.env` at runtime, or demonstrate that the model cannot issue a command that echoes env vars (e.g. because all `run_command` invocations are blocked).

- severity: P1
  confidence: 0.75
  location: src/sandbox/profiles.ts:33,41
  claim: The `read-only` sandbox mode is effectively dead code but would inherit the same global-read + unscoped-exec holes if ever wired up; it's also missing from the `run_command` mode selector, so the `workspace-write` profile is used for ALL non-dangerous/non-network commands including read-only operations like `git status`.
  evidence: `run_command.ts:7` selects `mode` from `classifyCommand`: `dangerous` or `network` → `'dangerous'`, everything else → `'workspace-write'`. The `'read-only'` branch in `buildProfile` at `profiles.ts:32-38` is never reached from any production code path. Tools like `git_status.ts:5` and `git_diff.ts:5` call `runSandboxed` with `mode: 'read-only'` directly — but they also bake their own `command` strings, bypassing `run_command`'s classification entirely. This means `git_status`/`git_diff` get read-only sandboxing while `run_command` with `git status` gets workspace-write — inconsistent security posture for equivalent operations.
  evidence: Actually, looking at `git_status.ts:5` and `git_diff.ts:5` — they hardcode `mode: 'read-only'` directly in their `runSandboxed` call. So the read-only profile IS used. But `run_command.ts:7` never selects it, meaning user-approved `run_command('git status')` gets write access while the dedicated `git_status` tool runs read-only. The inconsistency is worth noting: the model could exploit `run_command` to gain write access for a nominally read-only git operation.
  how_to_disprove: Show that `git_status.ts` and `git_diff.ts` use the same profile as `run_command`, or demonstrate that the `workspace-write` profile doesn't grant any additional capabilities over `read-only` for git operations.

- severity: P1
  confidence: 0.7
  location: src/sandbox/executor.ts:56-67
  claim: The `killTree` escalation (SIGTERM → 2s → SIGKILL) can still miss children that create a new session via `setsid()` or `start_new_session=True`, because `process.kill(-child.pid, signal)` only signals the child's process group — a grandchild in a new session escapes the group signal entirely.
  evidence: `killTree` at `executor.ts:56-58` calls `process.kill(-child.pid, signal)` which signals process group `child.pid`. `detached: true` at `executor.ts:46` makes the immediate child a process-group leader. But if that child spawns a grandchild with `start_new_session=True` (Python: `subprocess.Popen(…, start_new_session=True)`) or calls `setsid()`, the grandchild becomes the leader of a NEW process group. The timer fires at `executor.ts:66`, `killTree('SIGTERM')` signals only the original group, the grandchild (in its own group) receives nothing, and after 2s `killTree('SIGKILL')` (`:67`) also misses it. The shell and the immediate child exit → `close` fires → `settle` resolves → the process-leak grandchild continues running indefinitely.
  how_to_disprove: Prove that seatbelt's `(deny default)` blocks `setsid` syscalls or `start_new_session` creation for all modes, or show a process-supervision mechanism (cgroups, polling `/proc`) that catches and kills descendants outside the original process group.

- severity: P1
  confidence: 0.8
  location: src/sandbox/executor.ts:25
  claim: `sanitizeEnv` passes through `LD_PRELOAD`, `DYLD_INSERT_LIBRARIES`, `DYLD_LIBRARY_PATH`, `LD_LIBRARY_PATH`, and similar library-injection vectors — allowing a sandboxed command to inject arbitrary code into the spawned `/bin/sh` or `sandbox-exec` process before the seatbelt profile takes effect.
  evidence: `SENSITIVE_ENV` at `executor.ts:21` matches secrets only. `sanitizeEnv` at `executor.ts:23-28` copies ALL non-matching env vars including `DYLD_INSERT_LIBRARIES`, `LD_PRELOAD`, `LD_LIBRARY_PATH`, `DYLD_LIBRARY_PATH`, `DYLD_FRAMEWORK_PATH`. If any of these are set in the parent process (unlikely but possible in compromised dev environments, CI with preload hacks, or `~/.zshrc`-sourced profiles), the injected library loads INTO the sandbox process (`/bin/sh` or `sandbox-exec`) BEFORE seatbelt applies. The library then runs with the sandboxed process's permissions, which include `(allow file-read*)` — it can exfiltrate files before seatbelt restricts anything, or even patch the seatbelt syscall filter.
  how_to_disprove: Demonstrate that seatbelt profiles are applied by the kernel before `dyld` loads any libraries (kernel-level interception of `execve`), or show that these env vars are universally unset in all supported execution environments.

- severity: P2
  confidence: 0.65
  location: src/sandbox/workspace-boundary.ts:5-8
  claim: `assertInsideWorkspace` uses `existsSync` + `realpathSync` on the full path, creating a TOCTOU window where a symlink created between the check and the caller's subsequent I/O operation could point outside the workspace after the boundary check passes.
  evidence: `realpathForBoundary` at `workspace-boundary.ts:18-22` calls `fs.existsSync(absPath)` then `fs.realpathSync(absPath)` — two non-atomic operations. If the path exists at check time (a regular file inside workspace), the realpath resolves inside, and the check passes. Then if an attacker replaces it with a symlink to `/etc/passwd` before the caller's `fs.readFile`, the tool reads the symlink target. The boundary check itself is not bypassed — the check passed legitimately on the original file — but the TOCTOU between check and use means the check doesn't guarantee safety at use time. This is inherent to all path-based security checks; `openat` + `O_NOFOLLOW` or `realpath` + `open` on the resolved path would close it.
  how_to_disprove: Show that all callers of `resolveWorkspacePath` use `O_NOFOLLOW` or `realpath` the file descriptor, or demonstrate that no concurrent process can modify paths inside the workspace (single-user guarantee).

- severity: P2
  confidence: 0.5
  location: src/sandbox/executor.ts:56-58
  claim: PID reuse race — if the original child exits and its PID is reassigned to an unrelated process before `killTree` fires, `process.kill(-child.pid, signal)` signals the wrong process group.
  evidence: Between `child.on('close', …)` and the timer's `killTree('SIGTERM')`, there's a window where: child exits → PID freed → OS reuses PID for unrelated process → `killTree` fires → `process.kill(-reusedPid, SIGTERM)` signals the new process group. The `settled` guard (`executor.ts:60`) prevents double-resolve but doesn't prevent the kill from targeting the wrong PGID. On macOS, PID reuse is slow (wraps at 99998), making this very unlikely. On Linux with fast PID wrap, it's more plausible under heavy process churn.
  how_to_disprove: Show that `settled` always fires before PID reuse is possible (the JS event loop doesn't yield between `close` and `settle`), or demonstrate that the OS guarantees PIDs aren't reused within the 60s timeout window.

### comparison

**Confirming codex's findings:**

- **P0 executor.ts:37 (fail-open to unsandboxed /bin/sh)** — CONFIRMED. Three distinct paths to unsandboxed execution: non-darwin (`executor.ts:37`), missing `sandbox-exec` (`executor.ts:38`), and `dangerous` mode (`profiles.ts:30` returning null). All real; the `dangerous` mode is intentionally unsandboxed but the non-darwin and missing-binary paths are silent fallbacks. I verified that `run_command.ts:7` maps `dangerous` and `network` classifications to `mode: 'dangerous'`, meaning `curl`, `wget`, `npm install`, etc. all run completely unsandboxed — the `dangerous` path isn't just theoretical.

- **P0 profiles.ts:35 (broad file-read + deny-list misses secrets)** — CONFIRMED. `(allow file-read*)` at `profiles.ts:10,17` is unscoped. `denySecretReads` at `profiles.ts:27-36` covers 9 paths using `subpath` and `literal` rules, placed AFTER the broad allow (last-match-wins). I verified the ordering is correct. But the set is small: misses `.git-credentials`, `.kube/config`, `.pypirc`, `.pgpass`, `.my.cnf`, `~/.config/gh/hosts.yml`, `~/.terraform.d/`, `~/.cargo/credentials.toml`, `~/.boto`, `~/.s3cfg`, and `.env` files (though `.env` inside the workspace is arguably legitimate for the agent to read). The seatbelt `(allow file-read*)` plus unscoped `(allow process-exec)` means any secret file readable by the user is readable by a sandboxed command.

- **P1 executor.ts:21 (env deny-list misses connection strings)** — CONFIRMED AND EXTENDED. Codex correctly identified that `SENSITIVE_ENV` at `executor.ts:21` is a deny-list regex missing `DATABASE_URL`, `REDIS_URL`, etc. I additionally note that the regex is case-insensitive (good) but the pattern `TOKEN` catches `NPM_TOKEN`, `GITHUB_TOKEN` while missing `GITHUB_PAT`. The URL-embedded credential problem is systematic: any `*_URL`/`*_URI` var can carry `scheme://user:password@host` credentials. I'd upgrade the severity beyond codex's P1 assessment — `DATABASE_URL` with embedded credentials is a standard 12-factor pattern, making this a common real-world exposure, not a theoretical edge case. Also: `sanitizeEnv` passes through `LD_PRELOAD`/`DYLD_*` library-injection vectors (my P1 finding above), which codex didn't flag.

- **P1 executor.ts:55-68 (timeout can miss new-session grandchild processes)** — CONFIRMED with nuance. Codex described the mechanism correctly: `setsid`/`start_new_session=True` escapes process-group signaling. The current code has `detached: true` and `process.kill(-child.pid, ...)` which mitigates simple cases but doesn't solve the new-session case. The SIGTERM → 2s → SIGKILL escalation prevents hangs from SIGTERM-ignoring children, but a new-session grandchild receives neither signal. I verified the escalation chain at `executor.ts:64-67`. The risk is real but the exploit requires the model to craft a specific command with session-creation, which is unlikely to be accidental — it would need to be an intentionally adversarial prompt.

**What codex missed (new findings in my section above):**

- **P0: unscoped `(allow process-exec)` amplifies file-read into interpreter-powered exfiltration** — interpreters like `python3`, `ruby`, `node`, `perl` are all within `PATH` inside the sandbox; they can read files byte-by-byte, glob, or encode output to bypass any future stdout scanning. This is the mechanism that makes the broad file-read practically exploitable.

- **P0/P1: `read-only` profile is used inconsistently** — `git_status.ts` and `git_diff.ts` use `read-only` directly, but `run_command.ts` never selects it, giving `run_command('git status')` write access via `workspace-write`. The model can escalate from read to write by choosing `run_command` instead of the dedicated git tools.

- **P1: `LD_PRELOAD`/`DYLD_INSERT_LIBRARIES` pass through `sanitizeEnv`** — library injection vectors that could compromise the sandbox before seatbelt applies. Unlikely to be set in normal environments, but a defense-in-depth gap.

- **P2: TOCTOU between boundary check and I/O operations** — `assertInsideWorkspace` is non-atomic with the subsequent `readFile`/`writeFile` in tool implementations. Inherent to filesystem-level checks but worth documenting.

- **P2: PID reuse race in `killTree`** — the `settled` guard prevents double-resolve but doesn't prevent the kill from targeting a reused PID.

**Disagreeing with codex:**

- None. All four of codex's findings are valid against the current code. The code has been updated since codex's analysis (notably: `detached: true`, `settled` guard, `child.on('error')`, SIGTERM→SIGKILL escalation, and `sanitizeEnv` are all present), but the underlying gaps remain. The updates improved robustness without closing the core sandbox-security holes.

## omp findings
_DROPPED — omp (GLM-5.2) hit a sustained upstream Anthropic rate_limit_error and never
appended. Relay proceeded with 2/3 finders (no silent cap). Re-run when quota recovers._

---

## SYNTHESIS (orchestrator triage)

Deduped + ranked. Routing per skill: conf ≥0.8 → fix queue; 0.4–0.8 → verify first; any P0 → adversarial verify regardless.

| # | sev | conf | location | claim | routing |
|---|-----|------|----------|-------|---------|
| 1 | P0 | 0.95 | executor.ts:37 | Fails open to plain `/bin/sh` off-darwin, on missing `sandbox-exec`, or in `dangerous` mode | verify (by-design? document) |
| 2 | P0 | 0.90 | profiles.ts:10,17 | `(allow file-read*)` + incomplete deny-list → secret files readable (`.git-credentials`, `.kube/config`, `.pypirc`, `.pgpass`, `.my.cnf`, `gh/hosts.yml`, …) | **verify → fix** |
| 3 | P0 | 0.90 | profiles.ts:9,16 | Unscoped `(allow process-exec)` lets interpreters (`python3`/`node`) read+exfil, defeating any path-pattern hardening | **verify → fix** |
| 4 | P0/P1 | 0.85 | executor.ts:21 | Env filter misses URL-embedded creds (`DATABASE_URL`/`REDIS_URL`/`MONGODB_URI`) and `GITHUB_PAT` | fix queue |
| 5 | P1 | 0.80 | executor.ts:21 | `sanitizeEnv` passes `LD_PRELOAD`/`DYLD_*` library-injection vars | fix queue |
| 6 | P1 | 0.80 | executor.ts:56 | Timeout misses new-session grandchildren (`setsid`/`start_new_session`) | fix queue |
| 7 | P1 | 0.75 | run_command.ts:7 | `read-only` profile never selected; `run_command('git status')` gets write while `git_status` tool gets read-only | verify first |
| 8 | P2 | 0.65 | workspace-boundary.ts:18 | TOCTOU between boundary check and use | verify first |
| 9 | P2 | 0.50 | executor.ts:56 | PID-reuse race in `killTree` | drop unless corroborated |

Consensus: codex + pi both independently flagged #1, #2, #4, #6. pi added #3, #5, #7, #8, #9; codex confirmed none contradicted. Top cluster to act on: **#2 + #3** (broad read made practically exploitable by unscoped exec). These are real gaps in our own merged sandbox hardening — the deny-list approach is too narrow.

### verify-reachability (codex)

verdict: STANDS

Concrete evidence:

- `cat ~/.git-credentials` is not classified as `dangerous` or `network`: the dangerous home-path rule only matches `~/(.ssh|.aws|.config)` at `src/policy/classifier.ts:18`, and no network rule at `src/policy/classifier.ts:21-40` matches `cat`; therefore `classifyCommand` returns `execute` at `src/policy/classifier.ts:41`.
- `run_command` maps any non-`dangerous`/non-`network` classification to `workspace-write` and calls `runSandboxed` with the original command: `const mode = risk === 'dangerous' || risk === 'network' ? 'dangerous' : 'workspace-write'` and `runSandboxed({ command: input.command, ... mode ... })` at `src/tools/run_command.ts:7`.
- `runSandboxed` builds the macOS profile from that `workspace-write` mode at `src/sandbox/executor.ts:37`, then runs either `sandbox-exec ... /bin/sh -c options.command` or fallback `/bin/sh -c options.command` at `src/sandbox/executor.ts:39-40` and `src/sandbox/executor.ts:45`.
- The `workspace-write` profile broadly allows reads via `(allow file-read*)` at `src/sandbox/profiles.ts:43`; the deny list at `src/sandbox/profiles.ts:16-24` does not include `~/.git-credentials`.
- stdout is captured from the child at `src/sandbox/executor.ts:70`, returned in `RunResult.stdout`, and included verbatim in the tool result as `stdout:\n${result.stdout}` at `src/tools/run_command.ts:7`, which is then sent back to the model by the normal tool-result path (`src/agent/loop.ts:66-68`).
- There is a policy gate, but it does not refute reachability: `loop.ts` asks approval based on the parsed `execute` risk at `src/agent/loop.ts:57-59`; defaults set `execute: 'ask'` at `src/config/loader.ts:12`, while `auto` mode only requires approval for `dangerous` at `src/policy/approval.ts:5-8`. Once execution is allowed or approved, no sandbox/profile rule blocks reading `~/.git-credentials`.

### verify-seatbelt (pi)

**VERDICT: STANDS** — attempted four refutation angles; each failed.

---

**Attempt 1 — do any existing deny rules accidentally cover `~/.git-credentials` or
`~/.kube/config`?**

`denySecretReads` at `src/sandbox/profiles.ts:17-25` emits exactly nine deny rules:

```
(deny file-read* (subpath "${home}/.ssh"))
(deny file-read* (subpath "${home}/.aws"))
(deny file-read* (subpath "${home}/.gnupg"))
(deny file-read* (subpath "${home}/.config/gcloud"))
(deny file-read* (subpath "${home}/.docker"))
(deny file-read* (subpath "${home}/.codex"))
(deny file-read* (literal "${home}/.netrc"))
(deny file-read* (literal "${home}/.npmrc"))
(deny file-read* (subpath "${root}/.harness/auth"))
```

`~/.git-credentials` is not under any of these paths. `~/.kube/config` lives under
`~/.kube/` — not listed. **Zero overlap.**

---

**Attempt 2 — does seatbelt rule ordering or a built-in macOS default block these
paths regardless?**

The generated profile at `src/sandbox/profiles.ts:32-47` (workspace-write mode):

```
(version 1)
(deny default)                  ← baseline: everything denied
(allow process-exec)             ← explicit allow #1
(allow file-read*)               ← explicit allow #2 — UNSCOPED
(deny file-read* (subpath …))    ← denies #1–#9 from denySecretReads
(allow file-write* (subpath …))  ← scoped write
(deny file-write* (subpath …))   ← deny snapshots
(deny network*)
```

Seatbelt evaluation is **last-match-wins** (per Apple Sandbox Guide). For a read of
`~/.git-credentials`:

1. `(deny default)` matches → denied
2. `(allow file-read*)` matches → **allowed** (overrides baseline)
3. None of the nine deny rules match `.git-credentials`
4. Final: ALLOWED. Last matching rule is `(allow file-read*)` at `profiles.ts:43`.

There is **no built-in macOS seatbelt fallback** that overrides user-written allow
rules. SIP protects `/System` and signed Apple binaries — not user home-directory
dotfiles. The profile string IS the sandbox; no hidden layer beneath it.

---

**Attempt 3 — could `(allow process-exec)` be implicitly path-restricted by macOS
seatbelt semantics?**

`profiles.ts:9` and `profiles.ts:16` both emit `(allow process-exec)` with **no filter**:

```
(allow process-exec)
```

Per the Apple Sandbox Profile Language reference, `process-exec` CAN take a path
restriction — `(allow process-exec (subpath "/usr/bin"))` — but when emitted without
one (as here), it is **global**: any binary reachable via `execve()`/`posix_spawn()` is
allowed. This is documented behavior. The rule is necessary (without it, `/bin/sh`
can't exec the command), but the absence of a `(subpath …)` constraint is a design
choice, not a seatbelt limitation.

---

**Attempt 4 — could something outside the profile (sandbox-exec flags, TCC, SIP)
prevent interpreter-based exfiltration?**

- `executor.ts:39-40`: invocation is `sandbox-exec -p <profile> /bin/sh -c <command>` —
  no extra hardening flags. `sandbox-exec` applies the profile as-written.
- **SIP**: protects system integrity (read-only system volume, code signing). Does
  not prevent a user-mode process from reading `~/.git-credentials`.
- **TCC** (Transparency, Consent, and Control): governs camera/mic/accessibility/full-
  disk-access for GUI apps. Does not apply to CLI tools under `sandbox-exec`.
- **No implicit restrictions**: the profile text IS the policy. What you write is what
  the kernel enforces.

---

**Conclusion:** Both prongs of the finding are correct.

- **File-read prong:** `(allow file-read*)` at `profiles.ts:10,17` is unscoped. The
  9-path deny-list at `profiles.ts:17-25` misses `.git-credentials` and `.kube/config`.
  Under seatbelt last-match-wins, both paths are readable.
- **Process-exec prong:** `(allow process-exec)` at `profiles.ts:9,16` is unscoped —
  any system binary (`python3`, `node`, `ruby`, `perl`) can be exec'd. Combined with
  the broad file-read, interpreters can read unblocked secrets and print them to the
  captured stdout.

**Evidence:** `profiles.ts:9-10` and `profiles.ts:16-17` (unscoped allows),
`profiles.ts:17-25` (full deny-list enumeration — no `.git-credentials` or `.kube`),
and seatbelt's documented last-match-wins evaluation order (deny rules ARE placed
after the broad allow — ordering is correct — but they don't enumerate the target paths).
