import type { RiskLevel } from '../tools/types.js';

export function classifyCommand(command: string): RiskLevel {
  const dangerous = [/rm\s+-rf/i, /sudo\b/i, /chmod\s+-R/i, /curl\s+.*\|\s*(ba)?sh/i, /~\/(\.ssh|\.aws|\.config)/i];
  if (dangerous.some((pattern) => pattern.test(command))) return 'dangerous';
  const network = [/\bcurl\b/i, /\bwget\b/i, /\bnpm\s+install\b/i, /\bpnpm\s+install\b/i, /\byarn\s+add\b/i, /\bpip\s+install\b/i, /\bbrew\s+install\b/i, /\bgit\s+push\b/i, /\bgit\s+fetch\b/i, /https?:\/\//i];
  if (network.some((pattern) => pattern.test(command))) return 'network';
  return 'execute';
}
