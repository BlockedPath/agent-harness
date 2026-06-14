import type { PermissionConfig } from './types.js';
import type { RiskLevel } from '../tools/types.js';

export function requiresApproval(risk: RiskLevel, config: PermissionConfig): boolean {
  if (config.mode === 'suggest') return true;
  if (config.mode === 'auto') return risk === 'dangerous';
  if (risk === 'dangerous') return true;
  return config[risk as keyof Pick<PermissionConfig, 'read' | 'write' | 'execute' | 'network'>] === 'ask';
}
