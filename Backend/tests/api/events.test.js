import http from 'node:http';
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import { resetDb, disconnectDb } from '../helpers/db.js';
import {
  broadcast,
  reset as resetEvents,
  subscriberCount,
} from '../../src/services/events.js';

let app;
let baseUrl;

beforeAll(async () => {
  app = await buildTestApp();
  await app.listen({ host: '127.0.0.1', port: 0 });
  const address = app.server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  resetEvents();
  await resetDb();
});
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

/**
 * Connect to /events over a raw socket and yield SSE frames. `stop()` closes
 * the socket. Returns the response object so tests can peek at headers.
 */
async function openStream(path = '/events') {
  return new Promise((resolve, reject) => {
    const req = http.get(`${baseUrl}${path}`, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c.toString('utf8')));
      resolve({
        res,
        req,
        chunks,
        text: () => chunks.join(''),
        stop: () => new Promise((r) => { req.destroy(); res.on('close', r); }),
      });
    });
    req.on('error', reject);
  });
}

/** Wait until `pred(streamText)` returns truthy, or timeout. */
async function waitFor(streamHandle, pred, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (pred(streamHandle.text())) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor timeout — stream so far:\n${streamHandle.text()}`);
}

describe('GET /events (SSE)', () => {
  it('sets SSE headers and sends the connection preamble', async () => {
    const h = await openStream();
    try {
      expect(h.res.statusCode).toBe(200);
      expect(h.res.headers['content-type']).toMatch(/text\/event-stream/);
      expect(h.res.headers['cache-control']).toMatch(/no-cache/);
      await waitFor(h, (t) => t.includes('retry: 5000') && t.includes(': connected'));
    } finally {
      await h.stop();
    }
  });

  it('delivers a broadcast event to a connected subscriber', async () => {
    const h = await openStream();
    try {
      await waitFor(h, (t) => t.includes(': connected'));
      expect(subscriberCount()).toBe(1);

      broadcast('sync.completed', {
        cohorts: [{ slug: 'global', snapshotsCreated: 3 }],
        finishedAt: '2026-07-09T00:00:00.000Z',
      });

      await waitFor(h, (t) => t.includes('event: sync.completed'));
      const frame = h.text();
      expect(frame).toContain('event: sync.completed');
      expect(frame).toMatch(/data: \{.*"slug":"global".*"snapshotsCreated":3.*\}/);
    } finally {
      await h.stop();
    }
  });

  it('cleans up the subscriber set on client disconnect', async () => {
    const h = await openStream();
    await waitFor(h, (t) => t.includes(': connected'));
    expect(subscriberCount()).toBe(1);
    await h.stop();
    // Give the close handler a tick to run.
    await new Promise((r) => setTimeout(r, 50));
    expect(subscriberCount()).toBe(0);
  });

  it('supports multiple subscribers receiving the same event', async () => {
    const a = await openStream();
    const b = await openStream();
    try {
      await waitFor(a, (t) => t.includes(': connected'));
      await waitFor(b, (t) => t.includes(': connected'));
      expect(subscriberCount()).toBe(2);

      broadcast('titles.changed', { slug: 'devsoc-2025', changes: 3 });

      await waitFor(a, (t) => t.includes('event: titles.changed'));
      await waitFor(b, (t) => t.includes('event: titles.changed'));
    } finally {
      await a.stop();
      await b.stop();
    }
  });
});

describe('events broadcaster', () => {
  it('broadcast is a safe no-op when no subscribers are connected', () => {
    // Shouldn't throw and shouldn't add anything.
    broadcast('anything', { x: 1 });
    expect(subscriberCount()).toBe(0);
  });
});
