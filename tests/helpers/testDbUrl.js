/** Connection string for the throwaway Postgres test database. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://gitrank:gitrank@localhost:5432/gitrank_test?schema=public';
