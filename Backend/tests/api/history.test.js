import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import {
  resetDb,
  disconnectDb,
  makeCohort,
  makeMember,
  makeMembership,
  makeSnapshot,
} from '../helpers/db.js';

let app;

beforeAll(async () => { app = await buildTestApp(); });
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

describe('GET /members/:username/history', () => {
  it('returns downsampled per-UTC-day snapshots oldest-first, slim columns only', async () => {
    const cohort = await makeCohort({ slug: 'hist' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z4000001' });
    await makeMembership(m.id, cohort.id);

    const day1 = new Date('2026-06-01T02:00:00Z');
    const day1Later = new Date('2026-06-01T23:00:00Z');
    const day2 = new Date('2026-06-02T05:00:00Z');
    // Two snapshots on day 1 → the later one wins after downsampling.
    await makeSnapshot(m.id, cohort.id, {
      capturedAt: day1,
      totalCommits: 5,
      totalContributions: 5,
    });
    await makeSnapshot(m.id, cohort.id, {
      capturedAt: day1Later,
      totalCommits: 12,
      totalContributions: 15,
    });
    await makeSnapshot(m.id, cohort.id, {
      capturedAt: day2,
      totalCommits: 20,
      totalContributions: 22,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/members/ada/history?cohort=hist&days=365',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.member.githubUsername).toBe('ada');
    expect(body.cohort.slug).toBe('hist');
    expect(body.history).toHaveLength(2);
    // Oldest-first.
    expect(new Date(body.history[0].capturedAt).getTime())
      .toBeLessThan(new Date(body.history[1].capturedAt).getTime());
    // Day-1's later row wins.
    expect(body.history[0].totalCommits).toBe(12);
    expect(body.history[1].totalCommits).toBe(20);
    // Slim rows only — no bulky fields.
    expect(body.history[0]).not.toHaveProperty('calendar');
    expect(body.history[0]).not.toHaveProperty('topLanguages');
  });

  it('honours the `days` window (defaults to 90)', async () => {
    const cohort = await makeCohort({ slug: 'hist-window' });
    const m = await makeMember({ githubUsername: 'grace', zid: 'z4000002' });
    await makeMembership(m.id, cohort.id);

    const now = Date.now();
    const inside = new Date(now - 5 * 24 * 60 * 60 * 1000);
    const outside = new Date(now - 200 * 24 * 60 * 60 * 1000);
    await makeSnapshot(m.id, cohort.id, { capturedAt: outside, totalCommits: 999 });
    await makeSnapshot(m.id, cohort.id, { capturedAt: inside, totalCommits: 5 });

    const res = await app.inject({
      method: 'GET',
      url: '/members/grace/history?cohort=hist-window',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.history).toHaveLength(1);
    expect(body.history[0].totalCommits).toBe(5);
  });

  it('400s when the `cohort` param is missing', async () => {
    await makeMember({ githubUsername: 'noquery', zid: 'z4000003' });
    const res = await app.inject({ method: 'GET', url: '/members/noquery/history' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('400s when `days` is out of range', async () => {
    const cohort = await makeCohort({ slug: 'hist-bad-days' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z4000004' });
    await makeMembership(m.id, cohort.id);
    const res = await app.inject({
      method: 'GET',
      url: '/members/ada/history?cohort=hist-bad-days&days=999',
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown member', async () => {
    await makeCohort({ slug: 'hist-unknown-m' });
    const res = await app.inject({
      method: 'GET',
      url: '/members/nobody/history?cohort=hist-unknown-m',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown cohort', async () => {
    await makeMember({ githubUsername: 'ada', zid: 'z4000005' });
    const res = await app.inject({
      method: 'GET',
      url: '/members/ada/history?cohort=does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('GET /members/:username/calendar', () => {
  it('returns the calendar from the latest snapshot, normalised to {date, count}', async () => {
    const cohort = await makeCohort({ slug: 'cal' });
    const m = await makeMember({ githubUsername: 'ada', zid: 'z4100001' });
    await makeMembership(m.id, cohort.id);

    // Older snapshot with a stale calendar.
    await makeSnapshot(m.id, cohort.id, {
      capturedAt: new Date('2026-05-01T00:00:00Z'),
      calendar: [{ date: '2026-04-30', count: 1 }],
    });
    // Newer snapshot whose calendar we should get back (with a malformed entry
    // to prove the normaliser drops it).
    await makeSnapshot(m.id, cohort.id, {
      capturedAt: new Date('2026-06-01T00:00:00Z'),
      calendar: [
        { date: '2026-05-30', count: 4 },
        { date: '2026-05-31', count: '2' },     // stringy count coerces to number
        { count: 9 },                            // no date → dropped
        null,                                    // dropped
        { date: '2026-06-01', count: 0 },
      ],
    });

    const res = await app.inject({ method: 'GET', url: '/members/ada/calendar?cohort=cal' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.member.githubUsername).toBe('ada');
    expect(body.cohort.slug).toBe('cal');
    expect(new Date(body.capturedAt).toISOString()).toBe('2026-06-01T00:00:00.000Z');
    expect(body.calendar).toEqual([
      { date: '2026-05-30', count: 4 },
      { date: '2026-05-31', count: 2 },
      { date: '2026-06-01', count: 0 },
    ]);
  });

  it('returns capturedAt:null + empty calendar (200) when no snapshot exists', async () => {
    const cohort = await makeCohort({ slug: 'cal-empty' });
    const m = await makeMember({ githubUsername: 'newbie', zid: 'z4100002' });
    await makeMembership(m.id, cohort.id);

    const res = await app.inject({
      method: 'GET',
      url: '/members/newbie/calendar?cohort=cal-empty',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ capturedAt: null, calendar: [] });
  });

  it('400s when the `cohort` param is missing', async () => {
    await makeMember({ githubUsername: 'noquery', zid: 'z4100003' });
    const res = await app.inject({ method: 'GET', url: '/members/noquery/calendar' });
    expect(res.statusCode).toBe(400);
  });

  it('404s for an unknown member', async () => {
    await makeCohort({ slug: 'cal-unknown-m' });
    const res = await app.inject({
      method: 'GET',
      url: '/members/nobody/calendar?cohort=cal-unknown-m',
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s for an unknown cohort', async () => {
    await makeMember({ githubUsername: 'ada', zid: 'z4100004' });
    const res = await app.inject({
      method: 'GET',
      url: '/members/ada/calendar?cohort=does-not-exist',
    });
    expect(res.statusCode).toBe(404);
  });
});
