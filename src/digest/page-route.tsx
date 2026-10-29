import { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { lane } from '../lane.js';
import { DigestPage } from '../views/digest.js';
import { Layout } from '../views/layout.js';
import { readNight } from './reader.js';
import type { NightDigest } from './types.js';

export function digestPageRoutes(config: RigConfig): Hono {
  const app = new Hono();

  app.get('/:night', async (c) => {
    let digest: NightDigest;
    try {
      digest = await readNight(config.runsDir, c.req.param('night'));
    } catch (error) {
      if (error instanceof RangeError) return c.notFound();
      throw error;
    }
    if (digest.missing) return c.notFound();

    return c.html(
      <Layout title={`digest · ${digest.night}`} lane={lane()}>
        <DigestPage digest={digest} />
      </Layout>,
    );
  });

  return app;
}
