import type { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return zodToJsonSchema(schema as never) as Record<string, unknown>;
}
