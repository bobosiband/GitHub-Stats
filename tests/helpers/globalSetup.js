import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './testDbUrl.js';

/**
 * Provision a fresh schema in the test database once per `vitest run`.
 * `db push --force-reset` drops and recreates everything so each run starts clean.
 */
export async function setup() {
  execSync('npx prisma db push --force-reset --skip-generate', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
