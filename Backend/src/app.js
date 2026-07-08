import Fastify from 'fastify';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';

import { config as defaultConfig } from './config.js';
import { openapiDocument } from './docs/openapi.js';
import prismaPlugin from './plugins/prisma.js';
import errorHandlerPlugin from './plugins/errorHandler.js';
import authPlugin from './plugins/auth.js';
import securityPlugin from './plugins/security.js';

import { createGithubClient } from './services/github/client.js';
import { createGithubService } from './services/github/fetchUserStats.js';
import { createSyncRunner } from './jobs/syncJob.js';

import healthRoutes from './routes/health.js';
import cohortRoutes from './routes/cohorts.js';
import leaderboardRoutes from './routes/leaderboard.js';
import titleRoutes from './routes/titles.js';
import memberRoutes from './routes/members.js';
import historyRoutes from './routes/history.js';
import adminRoutes from './routes/admin.js';

/**
 * Build a configured Fastify app WITHOUT calling `.listen()`. This is the unit
 * of composition used by both `server.js` and the test suite.
 *
 * @param {object} [opts]
 * @param {import('@prisma/client').PrismaClient} [opts.prisma]  inject a client (tests)
 * @param {Function} [opts.fetchUserStats]    inject a stats fetcher (tests / mocks)
 * @param {Function} [opts.verifyGithubUser]  inject a user verifier (tests / mocks)
 * @param {object}   [opts.config]            override validated config
 * @param {boolean|object} [opts.logger]      Fastify logger option
 */
export async function buildApp(opts = {}) {
  const config = opts.config ?? defaultConfig;

  const app = Fastify({
    logger: opts.logger ?? (config.NODE_ENV === 'test' ? false : { level: config.LOG_LEVEL }),
  });

  // Real github service is the default; tests inject fakes to avoid the network.
  // The client is cheap to construct and never touches the network until called.
  const github = createGithubService(createGithubClient({ token: config.GITHUB_TOKEN }));
  const fetchUserStats = opts.fetchUserStats ?? github.fetchUserStats;
  const verifyGithubUser = opts.verifyGithubUser ?? github.verifyGithubUser;

  app.decorate('config', config);
  app.decorate('fetchUserStats', fetchUserStats);
  app.decorate('verifyGithubUser', verifyGithubUser);

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, {
    corsOrigins: config.CORS_ORIGIN,
    globalMax: opts.rateLimitGlobalMax,
    globalWindow: opts.rateLimitGlobalWindow,
    joinMax: opts.rateLimitJoinMax,
    joinWindow: opts.rateLimitJoinWindow,
  });
  await app.register(prismaPlugin, { prisma: opts.prisma });
  await app.register(authPlugin, { adminToken: config.ADMIN_TOKEN });

  // Build the sync runner once and share it between node-cron (server.js) and
  // POST /admin/sync-all so both paths respect the same in-process lock.
  const syncRunner = createSyncRunner({
    prisma: app.prisma,
    fetchUserStats,
    logger: app.log,
  });
  app.decorate('syncRunner', syncRunner);

  // API docs: serve the OpenAPI spec (static, decoupled from route validation) and
  // an interactive Swagger UI at /docs. Raw spec is available at GET /openapi.json
  // and /docs/json.
  await app.register(fastifySwagger, {
    mode: 'static',
    specification: { document: openapiDocument },
  });
  await app.register(fastifySwaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });
  app.get('/openapi.json', { schema: { hide: true } }, () => app.swagger());

  await app.register(healthRoutes);
  await app.register(cohortRoutes, { prefix: '/cohorts' });
  await app.register(leaderboardRoutes, { prefix: '/cohorts' });
  await app.register(titleRoutes, { prefix: '/cohorts' });
  await app.register(memberRoutes, { prefix: '/members' });
  await app.register(historyRoutes, { prefix: '/members' });
  await app.register(adminRoutes, { prefix: '/admin' });

  return app;
}

export default buildApp;
