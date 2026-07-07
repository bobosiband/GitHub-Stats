import { buildApp } from '../../src/app.js';
import { getPrisma } from './db.js';

const notStubbed = (name) => async () => {
  throw new Error(`${name} was called but not stubbed in this test`);
};

/**
 * Build a ready Fastify app wired to the test database, with the GitHub layer
 * stubbed. Pass `fetchUserStats` / `verifyGithubUser` to control behaviour.
 */
export async function buildTestApp(opts = {}) {
  const app = await buildApp({
    prisma: getPrisma(),
    logger: false,
    fetchUserStats: opts.fetchUserStats ?? notStubbed('fetchUserStats'),
    verifyGithubUser: opts.verifyGithubUser ?? notStubbed('verifyGithubUser'),
  });
  await app.ready();
  return app;
}

/** The bearer token the test app expects (matches tests/helpers/setupEnv.js). */
export const ADMIN_TOKEN = 'test-admin-token';
export const adminHeaders = { authorization: `Bearer ${ADMIN_TOKEN}` };
