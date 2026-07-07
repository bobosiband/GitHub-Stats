/**
 * GET /health — reports DB connectivity and the most recent snapshot time.
 */
export default async function healthRoutes(fastify) {
  fastify.get('/health', async () => {
    let db = 'up';
    let lastSyncAt = null;
    try {
      const latest = await fastify.prisma.statSnapshot.findFirst({
        orderBy: { capturedAt: 'desc' },
        select: { capturedAt: true },
      });
      lastSyncAt = latest?.capturedAt ?? null;
    } catch {
      db = 'down';
    }

    return {
      status: db === 'up' ? 'ok' : 'degraded',
      db,
      lastSyncAt,
      time: new Date().toISOString(),
    };
  });
}
