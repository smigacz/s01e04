import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DigestRow, NightDigest } from '../src/digest/types.js';

const night = '2026-10-28';
const firstAt = '2026-10-28T23:10:00+02:00';
const lastAt = '2026-10-29T01:20:00-05:30';
const event = { at: firstAt, job: 'alpha', status: 'ok', owner: 'rook' };

// Read only data cells, without depending on column order or decorative markup.
function tableRows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
    .filter((match) => /<td\b/i.test(match[1]))
    .map((match) => ({
      html: match[0],
      cells: [...match[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)]
        .map((cell) => cell[1].replace(/<[^>]*>/g, '').trim()),
    }));
}

describe('digest routes', () => {
  let runsDir: string;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-routes-'));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  function app() {
    return createApp({
      adapter: 'shim', installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60, runsDir,
    });
  }

  async function writeLines(lines: unknown[]) {
    await writeFile(join(runsDir, `${night}.jsonl`),
      `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  }

  it('serves sorted HTML fields and exactly the same ordered JSON rows', async () => {
    await writeLines([
      { ...event, job: 'zeta', status: 'fail', error: 'disk full' },
      { ...event, status: 'retry', error: 'try again' },
      { ...event, at: lastAt, owner: null },
    ]);
    const rows: DigestRow[] = [
      {
        job: 'alpha', owner: null, runs: 2, retries: 1, lastStatus: 'ok',
        lastError: 'try again', firstAt, lastAt,
      },
      {
        job: 'zeta', owner: 'rook', runs: 1, retries: 0, lastStatus: 'fail',
        lastError: 'disk full', firstAt, lastAt: firstAt,
      },
    ];
    const expected: NightDigest = { night, missing: false, rows, badLines: 0 };
    const instance = app();
    const page = await instance.request(`/digest/${night}`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    const html = await page.text();
    expect(html).toContain(night);
    expect(html.match(/<table\b/g)).toHaveLength(1);
    const rendered = tableRows(html);
    expect(rendered).toHaveLength(rows.length);
    for (const [index, row] of rows.entries()) {
      expect(rendered[index].cells).toHaveLength(8);
      expect(rendered[index].cells).toEqual(expect.arrayContaining([
        row.job, row.owner ?? '—', String(row.runs), String(row.retries),
        row.lastStatus, row.lastError ?? '—', row.firstAt, row.lastAt,
      ]));
    }

    const json = await instance.request(`/api/digest/${night}`);
    expect(json.status).toBe(200);
    expect(json.headers.get('content-type')).toContain('application/json');
    expect(await json.json()).toEqual(expected);
    // The exact timestamp strings above intentionally have different non-UTC offsets.
    expect(html).not.toContain('2026-10-28T21:10:00Z');
    expect(html).not.toContain('2026-10-29T06:50:00Z');
    expect(html).not.toMatch(/<script\b/i);
  });

  it.each(['/digest', '/api/digest'])('returns 404 for a missing night at %s', async (route) => {
    expect((await app().request(`${route}/${night}`)).status).toBe(404);
  });

  it('renders nothing ran for an existing empty file and returns an empty JSON digest', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), '');
    const instance = app();
    const page = await instance.request(`/digest/${night}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toMatch(/nothing ran/i);
    expect(tableRows(html)).toEqual([]);
    const json = await instance.request(`/api/digest/${night}`);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ night, missing: false, rows: [], badLines: 0 });
  });

  it('counts malformed and invalid lines while retaining valid rows in both responses', async () => {
    await writeFile(join(runsDir, `${night}.jsonl`), [
      '{broken', JSON.stringify(event), JSON.stringify({ ...event, status: 'unknown' }), '',
    ].join('\n'));
    const instance = app();
    const page = await instance.request(`/digest/${night}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(tableRows(html)).toHaveLength(1);
    expect(tableRows(html)[0].cells).toContain('alpha');
    expect(tableRows(html)[0].cells).toContain('—');
    const text = html.replace(/<[^>]*>/g, ' ');
    expect(text).toMatch(/(?:\b2\s+(?:bad|malformed|invalid)\s+lines?\b|\b(?:bad|malformed|invalid)\s+lines?\s*:\s*2\b)/i);
    const json = await instance.request(`/api/digest/${night}`);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night, missing: false, badLines: 2,
      rows: [{
        job: 'alpha', owner: 'rook', runs: 1, retries: 0, lastStatus: 'ok',
        lastError: null, firstAt, lastAt: firstAt,
      }],
    });
  });

  it('marks three or more retries and failures, but not two successful retries', async () => {
    await writeLines([
      ...Array.from({ length: 3 }, () => ({ ...event, job: 'many', status: 'retry' })),
      { ...event, job: 'many' },
      ...Array.from({ length: 2 }, () => ({ ...event, job: 'few', status: 'retry' })),
      { ...event, job: 'few' },
      { ...event, job: 'failed', status: 'fail' },
    ]);
    const response = await app().request(`/digest/${night}`);
    expect(response.status).toBe(200);
    const rows = tableRows(await response.text());
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.cells.find((cell) => ['failed', 'few', 'many'].includes(cell))))
      .toEqual(['failed', 'few', 'many']);
    const warning = /class=["'][^"']*\bwarn\b[^"']*["']/;
    expect(rows.find((row) => row.cells.includes('many'))?.html).toMatch(warning);
    expect(rows.find((row) => row.cells.includes('failed'))?.html).toMatch(warning);
    expect(rows.find((row) => row.cells.includes('few'))?.html).not.toMatch(warning);
  });

  it.each(['not-a-date', '2026-02-29', '2026-04-31', '2026-13-01', '2026-10-28.jsonl'])(
    'returns 404 on both routes for invalid night %s even if a file exists', async (invalidNight) => {
      await writeFile(join(runsDir, `${invalidNight}.jsonl`), JSON.stringify(event));
      const instance = app();
      for (const route of ['/digest', '/api/digest']) {
        expect((await instance.request(`${route}/${invalidNight}`)).status).toBe(404);
      }
    },
  );

  it('escapes job, owner and error in HTML without altering the JSON values', async () => {
    const job = '<script>alert("job")</script>';
    const owner = '<img src=x onerror="owner">';
    const error = '<b>error & detail</b>';
    await writeLines([{ ...event, job, owner, status: 'fail', error }]);
    const instance = app();
    const page = await instance.request(`/digest/${night}`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).not.toContain(job);
    expect(html).not.toContain(owner);
    expect(html).not.toContain(error);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).toContain('&lt;b&gt;error &amp; detail&lt;/b&gt;');
    expect(html).not.toMatch(/<(?:script|img|b)\b/i);
    const json = await instance.request(`/api/digest/${night}`);
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({
      night, missing: false, badLines: 0,
      rows: [{
        job, owner, runs: 1, retries: 0, lastStatus: 'fail', lastError: error,
        firstAt, lastAt: firstAt,
      }],
    });
  });
});
