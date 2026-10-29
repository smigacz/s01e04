import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readStatus } from '../src/status.js';
import { StatusBoard } from '../src/views/status.js';

describe('status board night summaries', () => {
  let runsDir = '';
  beforeEach(async () => {
    runsDir = '';
    runsDir = await mkdtemp(join(tmpdir(), 'rig-board-'));
  });
  afterEach(async () => {
    if (runsDir) await rm(runsDir, { recursive: true, force: true });
  });

  function config() {
    return { adapter: 'shim', installed: '2026-10-29T14:06:00+01:00', beatEverySeconds: 60, runsDir };
  }

  async function writeNight(night: string) {
    const event = { at: `${night}T23:00:00+01:00`, owner: 'rook' };
    await writeFile(join(runsDir, `${night}.jsonl`), [
      JSON.stringify({ ...event, job: 'recovered', status: 'retry' }),
      JSON.stringify({ ...event, job: 'recovered', status: 'fail' }),
      JSON.stringify({ ...event, job: 'recovered', status: 'ok' }),
      JSON.stringify({ ...event, job: 'recovered', status: 'ok' }),
      '{bad line',
      JSON.stringify({ ...event, job: 'pending', status: 'retry' }),
      JSON.stringify({ ...event, job: 'broken', status: 'fail' }),
      '',
    ].join('\n'));
  }

  it('counts each job once by its latest status, ignoring malformed lines', async () => {
    await writeNight('2026-10-28');
    const status = await readStatus(config());
    expect(status).toMatchObject({ adapter: 'shim', installed: config().installed });
    expect(status.nights).toEqual([
      { night: '2026-10-28', counts: { ok: 1, retry: 1, fail: 1 } },
    ]);
  });

  it('keeps newest-first ordering and includes an empty night with zero counts', async () => {
    await writeNight('2026-10-28');
    await writeFile(join(runsDir, '2026-10-29.jsonl'), '');
    await writeFile(join(runsDir, 'notes.txt'), 'not a night');
    expect((await readStatus(config())).nights).toEqual([
      { night: '2026-10-29', counts: { ok: 0, retry: 0, fail: 0 } },
      { night: '2026-10-28', counts: { ok: 1, retry: 1, fail: 1 } },
    ]);
  });

  it('renders a digest link and labeled counts for each night without client scripts', async () => {
    await writeNight('2026-10-28');
    await writeFile(join(runsDir, '2026-10-29.jsonl'), '');
    const app = new Hono();
    app.get('/', async (c) => c.html(<StatusBoard status={await readStatus(config())} />));
    const res = await app.request('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('<a href="/digest/2026-10-28">2026-10-28</a>');
    expect(html).toContain('<a href="/digest/2026-10-29">2026-10-29</a>');
    expect(html.indexOf('/digest/2026-10-29')).toBeLessThan(html.indexOf('/digest/2026-10-28'));
    expect(html).toContain('jobs by latest status');
    expect(html).toContain('ok 1 / retry 1 / fail 1');
    expect(html).toContain('ok 0 / retry 0 / fail 0');
    expect(html).not.toContain('<script');
  });

  it('preserves the empty-board message when no runs directory exists', async () => {
    const status = await readStatus({ ...config(), runsDir: join(runsDir, 'missing') });
    expect(status.nights).toEqual([]);
    const app = new Hono();
    app.get('/', (c) => c.html(<StatusBoard status={status} />));
    const html = await (await app.request('/')).text();
    expect(html).toContain('nothing in runs/');
    expect(html).not.toContain('/digest/');
  });
});
