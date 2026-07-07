// Runs before every test file's imports (vitest `setupFiles`), so that when
// `src/config.js` is imported it sees the test environment. Values set here take
// precedence over `.env` because dotenv never overrides an existing process.env.
import { TEST_DATABASE_URL } from './testDbUrl.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? 'test-token';
process.env.ADMIN_TOKEN = 'test-admin-token';
process.env.ENABLE_CRON = 'false';
process.env.LOG_LEVEL = 'silent';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';
