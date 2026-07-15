import { describe, it, expect, beforeEach, afterAll, beforeAll } from 'vitest';
import { buildTestApp } from '../helpers/app.js';
import {
  resetDb,
  disconnectDb,
  makeMember,
} from '../helpers/db.js';

let app;

beforeAll(async () => {
  app = await buildTestApp();
});
beforeEach(resetDb);
afterAll(async () => {
  await app.close();
  await disconnectDb();
});

describe('GET /members', () => {
  it('returns every member, sorted alphabetically, with only the three public fields', async () => {
    await makeMember({
      githubUsername: 'zeta-dev',
      zid: 'z3000001',
      displayName: 'Zeta Dev',
      avatarUrl: 'https://example.com/zeta.png',
    });
    await makeMember({
      githubUsername: 'alpha-dev',
      zid: 'z3000002',
      displayName: 'Alpha Dev',
      avatarUrl: 'https://example.com/alpha.png',
    });
    await makeMember({
      githubUsername: 'middlemember',
      zid: 'z3000003',
      displayName: 'Middle Member',
      avatarUrl: null,
    });
    // displayName null → sort falls back to githubUsername.
    await makeMember({
      githubUsername: 'bravo-nodisplay',
      zid: 'z3000004',
      displayName: null,
      avatarUrl: null,
    });

    const res = await app.inject({ method: 'GET', url: '/members' });
    expect(res.statusCode).toBe(200);
    const { members } = res.json();

    expect(members).toHaveLength(4);
    expect(members.map((m) => m.githubUsername)).toEqual([
      'alpha-dev',
      'bravo-nodisplay',
      'middlemember',
      'zeta-dev',
    ]);
    for (const m of members) {
      expect(Object.keys(m).sort()).toEqual(['avatarUrl', 'displayName', 'githubUsername']);
    }
  });

  it('returns an empty list when there are no members', async () => {
    const res = await app.inject({ method: 'GET', url: '/members' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ members: [] });
  });

  it('is case-insensitive in its sort order', async () => {
    await makeMember({ githubUsername: 'bee', zid: 'z3000010', displayName: 'bee' });
    await makeMember({ githubUsername: 'ant', zid: 'z3000011', displayName: 'Ant' });

    const res = await app.inject({ method: 'GET', url: '/members' });
    const names = res.json().members.map((m) => m.displayName);
    expect(names).toEqual(['Ant', 'bee']);
  });
});
