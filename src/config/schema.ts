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
export const compactionSchema = z.object({
  auto: z.boolean().default(false),
  messageThreshold: z.number().int().positive().default(60),
  keepRecent: z.number().int().positive().default(20),
}).refine((value) => value.messageThreshold > value.keepRecent, {
  message: 'compaction.messageThreshold must be greater than keepRecent so a triggered compaction always has older messages to summarize',
});
export const configSchema = z.object({
  defaultProvider: z.string(),
  defaultModel: z.string(),
  permissions: permissionSchema.default({ mode: 'on-request', read: 'allow', write: 'ask', execute: 'ask', network: 'ask' }),
  compaction: compactionSchema.default({ auto: false, messageThreshold: 60, keepRecent: 20 }),
  tools: z.object({ allow: z.array(z.string()).optional(), deny: z.array(z.string()).default([]) }).default({ deny: [] }),
  providers: z.record(z.string(), providerConfigSchema),
});
export type Config = z.infer<typeof configSchema>;
