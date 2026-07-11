import type { RiskLevel } from '../tools/types.js';

/**
 * Best-effort deny-list classifier for shell commands. This is NOT a security
 * boundary — it's a prompt to the human. Patterns are shallow regex matching and
 * can be bypassed (quoting, eval, $VAR indirection, env-prefixed commands, etc.).
 * Treat the result as advisory only.
 */
export function classifyCommand(command: string): RiskLevel {
  const dangerous = [
    /rm\s+-r/i,
    /rm\s+.*--recursive/i,
    /rm\s+.*--force/i,
    /find\b.*\b-delete\b/i,
    /sudo\b/i,
    /chmod\s+-R/i,
    /curl\s+.*\|\s*(ba)?sh/i,
    /~\/(\.ssh|\.aws|\.config)/i,
  ];
  if (dangerous.some((pattern) => pattern.test(command))) return 'dangerous';
  const network = [
    /\bcurl\b/i, /\bwget\b/i, /\bssh\b/i, /\bscp\b/i, /\brsync\b/i,
    /\bnc\b/i, /\bnetcat\b/i,
    // Package managers and their common aliases fetch code even when the
    // command is not spelled `install` (for example `npm i` or `pnpm add`).
    /\b(?:npm\s+(?:i|install|ci|update|upgrade)|npx\b)/i,
    /\b(?:pnpm\s+(?:i|add|install|update|upgrade)|pnpx\b)/i,
    /\b(?:yarn\s+(?:add|install|upgrade|global\s+add)|yarn dlx\b)/i,
    /\b(?:bun\s+(?:add|install|i|update)|bunx\b)/i,
    /\b(?:pip3?|pipx)\s+install\b/i,
    /\buv\s+(?:pip\s+install|add|tool\s+install)\b/i,
    /\b(?:conda|mamba|pixi)\s+(?:install|add|update)\b/i,
    /\b(?:poetry|composer)\s+(?:add|install|require)\b/i,
    // Unknown tools with a conventional package-manager suffix are advisory
    // network candidates too; this intentionally errs toward a prompt.
    /\b[a-z][a-z0-9_-]*(?:pm|pkg)\s+(?:i|add|install|update)\b/i,
    /\b(?:brew|apt(?:-get)?|apk|dnf|yum|pacman)\s+(?:install|upgrade|update)\b/i,
    /\b(?:cargo|gem|go|dotnet)\s+install\b/i,
    /\bgit\s+(?:clone|pull|push|fetch|submodule\s+update)\b/i,
    /\bdocker\s+pull\b/i,
    /\b(?:httpie|http|aria2c|ftp|sftp)\b/i,
    /https?:\/\//i,
  ];
  if (network.some((pattern) => pattern.test(command))) return 'network';
  return 'execute';
}
