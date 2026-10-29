import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestPageRoutes } from '../src/digest/page-route.js';

describe('digest page', () => {
  let runsDir: string;
  let app: Hono;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-page-'));
    app = new Hono().route('/digest', digestPageRoutes({
      adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir,
    }));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it('renders all fields in reader order, original offsets, warnings and bad-line count', async () => {
    const at = '2026-10-28T01:00:00+02:00';
    const lastAt = '2026-10-28T02:00:00+01:00';
    await writeFile(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at, job: 'zeta', owner: null, status: 'fail', error: '<failed>' }),
      JSON.stringify({ at, job: 'alpha', owner: 'reader', status: 'retry' }),
      JSON.stringify({ at, job: 'alpha', owner: 'reader', status: 'retry' }),
      JSON.stringify({ at, job: 'alpha', owner: 'reader', status: 'retry' }),
      JSON.stringify({ at: lastAt, job: 'alpha', owner: 'reader', status: 'ok' }),
      JSON.stringify({ at, job: 'middle', owner: null, status: 'ok' }),
      'broken line',
    ].join('\n'));

    const response = await app.request('/digest/2026-10-28');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<header>');
    expect(html).toContain('digest · 2026-10-28');
    expect(html).toContain('bad lines: 1');
    expect(html.indexOf('<td>alpha</td>')).toBeLessThan(html.indexOf('<td>middle</td>'));
    expect(html.indexOf('<td>middle</td>')).toBeLessThan(html.indexOf('<td>zeta</td>'));
    expect(html).toContain('<tr class="warn"><td>alpha</td><td>reader</td><td>4</td><td>3</td><td>ok</td><td>—</td>');
    expect(html).toContain('<tr class="warn"><td>zeta</td><td>—</td><td>1</td><td>0</td><td>fail</td><td>&lt;failed&gt;</td>');
    expect(html).toContain('<tr><td>middle</td><td>—</td>');
    expect(html).toContain(`<td>${at}</td><td>${lastAt}</td>`);
    expect(html).not.toContain('<script');
  });

  it('renders an existing empty night as nothing ran', async () => {
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');
    const response = await app.request('/digest/2026-10-28');
    const html = await response.text();
    expect(response.status).toBe(200);
    expect(html).toContain('nothing ran');
    expect(html).toContain('bad lines: 0');
  });

  it('returns 404 for a missing night', async () => {
    expect((await app.request('/digest/2026-10-28')).status).toBe(404);
  });

  it.each(['not-a-night', '2026-02-30', '2026-13-01', '2026-10-28.jsonl', '%2e%2e%2fsecret'])(
    'returns 404 for invalid night %s', async (night) => {
      expect((await app.request(`/digest/${night}`)).status).toBe(404);
    },
  );
});
