export type PermissionMode = 'suggest' | 'on-request' | 'auto';
export interface PermissionConfig {
  mode: PermissionMode;
  read: 'allow' | 'ask';
  write: 'allow' | 'ask';
  execute: 'allow' | 'ask';
  network: 'allow' | 'ask';
}
