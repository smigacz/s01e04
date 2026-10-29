import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readNight } from '../src/digest/reader.js';

const night = '2026-10-28';
const event = {
  at: '2026-10-28T23:00:00+01:00', job: 'job', status: 'ok', owner: 'rook',
};

describe('night reader', () => {
  let runsDir: string;
  beforeEach(async () => { runsDir = await mkdtemp(join(tmpdir(), 'rig-reader-')); });
  afterEach(async () => { await rm(runsDir, { recursive: true, force: true }); });

  async function writeLines(lines: unknown[]) {
    await writeFile(join(runsDir, `${night}.jsonl`), lines.map((line) => JSON.stringify(line)).join('\n'));
  }

  it('reads the immutable fixture: five sorted jobs, one bad line', async () => {
    const digest = await readNight('runs', night);
    expect(digest.missing).toBe(false);
    expect(digest.badLines).toBe(1);
    expect(digest.rows.map((row) => row.job)).toEqual([
      'digest/render', 'fixtures/refresh', 'lane/sync', 'notes/backup', 'rig/rotate-logs',
    ]);
    expect(digest.rows[0]).toEqual({
      job: 'digest/render', owner: null, runs: 1, retries: 0,
      lastStatus: 'ok', lastError: null,
      firstAt: '2026-10-29T05:41:09+01:00', lastAt: '2026-10-29T05:41:09+01:00',
    });
    expect(digest.rows[1]).toMatchObject({
      runs: 4, retries: 3, lastStatus: 'ok', lastError: 'upstream 503',
    });
    expect(digest.rows[2]).toMatchObject({
      runs: 8, retries: 1, lastStatus: 'ok', lastError: 'lock held',
      firstAt: '2026-10-28T23:00:06+01:00', lastAt: '2026-10-29T05:00:04+01:00',
    });
    expect(digest.rows[3]).toMatchObject({ lastStatus: 'fail', lastError: 'quota exceeded' });
  });

  it('distinguishes a missing night from an empty existing night', async () => {
    expect(await readNight(runsDir, night)).toEqual({ night, missing: true, rows: [], badLines: 0 });
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    expect(await readNight(runsDir, night)).toEqual({ night, missing: false, rows: [], badLines: 0 });
  });

  it('retains offsets and append order, latest owner and most recent supplied error', async () => {
    await writeLines([
      { ...event, at: '2026-10-29T01:30:00+02:00', status: 'retry', error: 'first' },
      { ...event, at: '2026-10-29T01:15:00+01:00', status: 'fail', error: 'latest' },
      { ...event, at: '2026-10-28T22:00:00Z', owner: null },
    ]);
    expect((await readNight(runsDir, night)).rows).toEqual([{
      job: 'job', owner: null, runs: 3, retries: 1, lastStatus: 'ok', lastError: 'latest',
      firstAt: '2026-10-29T01:30:00+02:00', lastAt: '2026-10-28T22:00:00Z',
    }]);
  });

  it('counts malformed JSON and invalid schemas without dropping later valid events', async () => {
    const invalid: unknown[] = [
      null, [], 1, 'text', {},
      { ...event, at: null }, { ...event, at: '2026-02-30T12:00:00Z' },
      { ...event, at: '2026-10-28T12:00:00' }, { ...event, at: '2026-10-28T24:00:00Z' },
      { ...event, at: `${event.at}\n` },
      { ...event, job: '' }, { ...event, job: '  ' }, { ...event, job: 7 },
      { ...event, status: 'unknown' }, { ...event, owner: 7 },
      { at: event.at, job: 'job', status: 'ok' },
      { ...event, error: 7 }, { ...event, error: null },
    ];
    await writeFile(join(runsDir, `${night}.jsonl`), [
      '{broken', '', ...invalid.map((line) => JSON.stringify(line)), JSON.stringify(event), '',
    ].join('\r\n'));
    const digest = await readNight(runsDir, night);
    expect(digest.badLines).toBe(invalid.length + 2);
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].runs).toBe(1);
  });

  it('handles special object keys as jobs and sorts independently of input order', async () => {
    await writeLines(['z', '__proto__', 'constructor', 'a'].map((job) => ({ ...event, job })));
    expect((await readNight(runsDir, night)).rows.map((row) => row.job)).toEqual([
      '__proto__', 'a', 'constructor', 'z',
    ]);
  });

  it.each([
    '../2026-10-28', '/2026-10-28', '2026-10-28/other', '2026-10-28.jsonl',
    '2026-10-28\n', '2026-02-29', '2026-04-31', '2026-00-01', '2026-01-00',
  ])('rejects invalid night %j before reading', async (invalidNight) => {
    await expect(readNight(runsDir, invalidNight)).rejects.toBeInstanceOf(RangeError);
  });

  it('accepts leap days and does not count a final newline as a bad line', async () => {
    await writeFile(join(runsDir, '2024-02-29.jsonl'), `${JSON.stringify({
      ...event, at: '2024-02-29T12:00:00.123-05:30',
    })}\n`);
    const digest = await readNight(runsDir, '2024-02-29');
    expect(digest).toMatchObject({ missing: false, badLines: 0 });
    expect(digest.rows).toHaveLength(1);
    expect(digest.rows[0].firstAt).toBe('2024-02-29T12:00:00.123-05:30');
  });

  it('does not disguise other filesystem failures as missing nights', async () => {
    await mkdir(join(runsDir, `${night}.jsonl`));
    await expect(readNight(runsDir, night)).rejects.toMatchObject({ code: 'EISDIR' });
  });
});
