import { z } from 'zod';

export const providerConfigSchema = z.object({
  apiKeyEnv: z.string().optional(),
  baseUrl: z.string().optional(),
  auth: z.enum(['api-key', 'codex-oauth']).default('api-key'),
  oauthTokenEnv: z.string().optional(),
  oauthCredentialsPath: z.string().optional(),
  oauthSourceCredentialsPath: z.string().optional(),
});
export const permissionSchema = z.object({
  mode: z.enum(['suggest', 'on-request', 'auto']).default('on-request'),
  read: z.enum(['allow', 'ask']).default('allow'),
  write: z.enum(['allow', 'ask']).default('ask'),
  execute: z.enum(['allow', 'ask']).default('ask'),
  network: z.enum(['allow', 'ask']).default('ask'),
});
export const configSchema = z.object({
  defaultProvider: z.string(),
  defaultModel: z.string(),
  permissions: permissionSchema.default({ mode: 'on-request', read: 'allow', write: 'ask', execute: 'ask', network: 'ask' }),
  providers: z.record(z.string(), providerConfigSchema),
});
export type Config = z.infer<typeof configSchema>;
