import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestJsonRoutes } from '../src/digest/json-route.js';
import { readNight } from '../src/digest/reader.js';

describe('digest JSON route', () => {
  let runsDir: string;
  let app: Hono;

  beforeEach(async () => {
    runsDir = await mkdtemp(join(tmpdir(), 'rig-digest-json-'));
    app = new Hono().route('/api/digest', digestJsonRoutes({
      adapter: 'shim',
      installed: '2026-10-29T14:06:00+01:00',
      beatEverySeconds: 60,
      runsDir,
    }));
  });

  afterEach(async () => {
    await rm(runsDir, { recursive: true, force: true });
  });

  it('returns the reader digest unchanged, including sorted rows and bad lines', async () => {
    const at = '2026-10-28T23:00:00+01:00';
    await writeFile(join(runsDir, '2026-10-28.jsonl'), [
      JSON.stringify({ at, job: 'zebra', status: 'fail', owner: null, error: 'timeout' }),
      'broken JSON',
      JSON.stringify({ at, job: 'alpha', status: 'retry', owner: 'rook' }),
      '',
    ].join('\n'));

    const res = await app.request('/api/digest/2026-10-28');
    const digest = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(digest).toEqual(await readNight(runsDir, '2026-10-28'));
    expect(digest.rows.map((row: { job: string }) => row.job)).toEqual(['alpha', 'zebra']);
    expect(digest.badLines).toBe(1);
  });

  it('returns JSON 404 for a missing night', async () => {
    const res = await app.request('/api/digest/2026-10-28');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      night: '2026-10-28', missing: true, rows: [], badLines: 0,
    });
  });

  it.each(['not-a-night', '2026-02-30', '2026-13-01', '..%2Fsecret'])('returns JSON 404 for invalid night %s', async (night) => {
    const res = await app.request(`/api/digest/${night}`);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Invalid night' });
  });

  it('returns an empty existing night successfully', async () => {
    await writeFile(join(runsDir, '2026-10-28.jsonl'), '');
    const res = await app.request('/api/digest/2026-10-28');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      night: '2026-10-28', missing: false, rows: [], badLines: 0,
    });
  });

  it('propagates non-missing I/O errors to the app error handler', async () => {
    await mkdir(join(runsDir, '2026-10-28.jsonl'));
    let caught: Error | undefined;
    app.onError((error, c) => {
      caught = error;
      return c.json({ error: 'Read failed' }, 500);
    });

    const res = await app.request('/api/digest/2026-10-28');

    expect(res.status).toBe(500);
    expect(caught).toMatchObject({ code: 'EISDIR' });
    expect(await res.json()).toEqual({ error: 'Read failed' });
  });
});
