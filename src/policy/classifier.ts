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
    /\bcurl\b/i,
    /\bwget\b/i,
    /\bssh\b/i,
    /\bscp\b/i,
    /\brsync\b/i,
    /\bnc\b/i,
    /\bnetcat\b/i,
    /\bnpm\s+install\b/i,
    /\bpnpm\s+install\b/i,
    /\byarn\s+add\b/i,
    /\bpip\s+install\b/i,
    /\bbrew\s+install\b/i,
    /\bgit\s+clone\b/i,
    /\bgit\s+push\b/i,
    /\bgit\s+fetch\b/i,
    /\bdocker\s+pull\b/i,
    /https?:\/\//i,
  ];
  if (network.some((pattern) => pattern.test(command))) return 'network';
  return 'execute';
}
