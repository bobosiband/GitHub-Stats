/**
 * Regression tests for the pure heatmap math (bug A2).
 *
 * Runs on Node's built-in test runner — no additional dev deps required:
 *
 *   node --test Frontend/tests/heatmap.test.js
 *   (or `npm run test:heatmap` from Frontend/)
 *
 * Covers the shape/layout invariants that the earlier CSS-grid bug quietly
 * broke: 53 columns × 7 rows, column-major flat order, quartile bucketing that
 * actually paints green for a low-activity user, and no all-grey grid when the
 * anchor is set to the snapshot's own capturedAt.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrid, bucketerFor, WEEKS, ROWS } from '../src/lib/heatmap.js';

describe('buildGrid — layout invariants', () => {
  test('returns exactly WEEKS × 7 cells', () => {
    const cells = buildGrid([], new Date('2026-07-13T00:00:00Z'));
    assert.equal(cells.length, WEEKS * ROWS);
    assert.equal(WEEKS, 53);
    assert.equal(ROWS, 7);
  });

  test('column-major: first 7 cells are consecutive days (a column)', () => {
    const cells = buildGrid([], new Date('2026-07-13T00:00:00Z'));
    for (let i = 1; i < ROWS; i++) {
      const prev = new Date(cells[i - 1].date);
      const cur = new Date(cells[i].date);
      const diffDays = (cur.getTime() - prev.getTime()) / (24 * 60 * 60 * 1000);
      assert.equal(diffDays, 1, `expected consecutive days within a column, got ${cells[i - 1].date} → ${cells[i].date}`);
    }
  });

  test('week-to-week: same day-of-week across consecutive columns is 7 days apart', () => {
    const cells = buildGrid([], new Date('2026-07-13T00:00:00Z'));
    const col0Row3 = new Date(cells[3].date);
    const col1Row3 = new Date(cells[ROWS + 3].date);
    const diffDays = (col1Row3.getTime() - col0Row3.getTime()) / (24 * 60 * 60 * 1000);
    assert.equal(diffDays, 7);
  });

  test('a member with real activity gets green cells (no all-grey grid — bug A2)', () => {
    const anchor = new Date('2026-07-13T00:00:00Z');
    // 90 days of consistent activity ending at anchor.
    const calendar = [];
    for (let i = 0; i < 90; i++) {
      const d = new Date(anchor);
      d.setUTCDate(anchor.getUTCDate() - i);
      calendar.push({ date: d.toISOString().slice(0, 10), count: 3 + (i % 5) });
    }
    const cells = buildGrid(calendar, anchor);
    const nonZeroCells = cells.filter((c) => c.count > 0);
    assert.ok(nonZeroCells.length >= 80, `expected many nonzero cells, got ${nonZeroCells.length}`);
    // Buckets should span above 1 — a low-activity member's mid days should
    // hit bucket 2+ under quartile scaling.
    const buckets = new Set(nonZeroCells.map((c) => c.bucket));
    assert.ok(buckets.size >= 3, `expected varied intensity buckets, got ${[...buckets].sort()}`);
  });

  test('anchoring: the last non-future cell is the anchor date', () => {
    const anchor = new Date('2026-07-13T00:00:00Z'); // a Monday
    const cells = buildGrid([], anchor);
    const lastVisible = [...cells].reverse().find((c) => !c.future);
    assert.equal(lastVisible.date, '2026-07-13');
  });

  test('future days in the current week render as bucket 0 (grey)', () => {
    const anchor = new Date('2026-07-13T00:00:00Z'); // Monday
    const cells = buildGrid([{ date: '2026-07-14', count: 999 }], anchor);
    // 2026-07-14 is tomorrow → future.
    const tomorrow = cells.find((c) => c.date === '2026-07-14');
    assert.ok(tomorrow, 'tomorrow should be present in the grid');
    assert.equal(tomorrow.future, true);
    assert.equal(tomorrow.bucket, 0);
  });
});

describe('bucketerFor — quartile buckets', () => {
  test('zero always returns bucket 0', () => {
    const b = bucketerFor([1, 5, 10, 20]);
    assert.equal(b(0), 0);
    assert.equal(b(-5), 0);
  });

  test('empty distribution: any nonzero → max bucket', () => {
    const b = bucketerFor([]);
    assert.equal(b(0), 0);
    assert.equal(b(1), 4);
  });

  test('buckets rise monotonically with the input count', () => {
    // 100 evenly-spaced nonzero counts → 4 buckets, boundaries near 25/50/75.
    const dist = Array.from({ length: 100 }, (_, i) => i + 1);
    const b = bucketerFor(dist);
    // Every quartile of the distribution must include at least one member
    // that falls in each of buckets 1..4.
    const samples = [10, 40, 60, 90].map(b);
    assert.deepEqual(samples, [1, 2, 3, 4], `sampled quartiles: ${samples}`);
    // Monotonicity: higher counts never regress to lower buckets.
    let last = 0;
    for (const c of dist) {
      const bkt = b(c);
      assert.ok(bkt >= last, `regression: b(${c})=${bkt} after prior=${last}`);
      last = bkt;
    }
  });

  test('a low-activity member still gets varied buckets (bug A2 regression)', () => {
    // Member's max daily is 3. The old hardcoded (1/4/8/16) buckets would put
    // everything at bucket 1 — quartile scaling must span 1..4.
    const b = bucketerFor([1, 1, 1, 2, 2, 3, 3, 3]);
    assert.ok(b(1) >= 1);
    assert.ok(b(3) >= 3, `expected max value to hit high bucket, got ${b(3)}`);
  });
});
