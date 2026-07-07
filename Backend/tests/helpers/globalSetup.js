import { execSync } from 'node:child_process';
import { TEST_DATABASE_URL } from './testDbUrl.js';

/**
 * Ensure the test database schema is up to date once per `vitest run`.
 * `migrate deploy` is idempotent and non-destructive — it applies any pending
 * migrations and no-ops if the schema is already current. Per-test isolation is
 * handled by `resetDb()` (TRUNCATE), so we never need a destructive reset here.
 */
export async function setup() {
  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}
