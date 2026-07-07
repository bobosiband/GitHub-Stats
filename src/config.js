import 'dotenv/config';
import { z } from 'zod';

/**
 * A relaxed boolean coercion: accepts true/false, "true"/"false", "1"/"0".
 */
const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  GITHUB_TOKEN: z.string().min(1, 'GITHUB_TOKEN is required'),
  ADMIN_TOKEN: z.string().min(1, 'ADMIN_TOKEN is required'),
  SYNC_CRON: z.string().default('0 */3 * * *'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  ENABLE_CRON: booleanish.default(true),
  NODE_ENV: z.string().default('development'),
});

/**
 * @typedef {z.infer<typeof envSchema>} Config
 */

/**
 * Parse and validate environment variables.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {Config}
 */
export function loadConfig(env = process.env) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    console.error(`Invalid environment configuration:\n${issues}`);
    throw new Error('Invalid environment configuration');
  }
  return parsed.data;
}

/** Singleton config, validated at import time. */
export const config = loadConfig();
