import { buildApp } from './app.js';
import { config } from './config.js';
import { ensureTitles } from './services/titles/engine.js';
import { ensureGlobalCohort } from './services/global.js';
import { registerSyncJob } from './jobs/syncJob.js';

/** Entrypoint: build the app, seed title definitions, schedule the sync, and listen. */
const app = await buildApp();

// Make sure the Title table reflects the current definitions on every boot.
await ensureTitles(app.prisma);
// Guarantee the singleton global cohort exists.
await ensureGlobalCohort(app.prisma);

let job = null;
if (config.ENABLE_CRON) {
  job = registerSyncJob({
    runner: app.syncRunner,
    cronExpr: config.SYNC_CRON,
    logger: app.log,
  });
  app.log.info({ cron: config.SYNC_CRON }, 'sync job scheduled');
} else {
  app.log.info('cron disabled (ENABLE_CRON=false)');
}

const shutdown = async (signal) => {
  app.log.info({ signal }, 'shutting down');
  try {
    job?.task?.stop();
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'error during shutdown');
    process.exit(1);
  }
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

try {
  await app.listen({ port: config.PORT, host: config.HOST });
} catch (err) {
  app.log.error({ err }, 'failed to start server');
  process.exit(1);
}
