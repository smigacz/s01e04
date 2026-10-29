import { Hono } from 'hono';
import type { RigConfig } from '../config.js';
import { readNight } from './reader.js';

export function digestJsonRoutes(config: RigConfig): Hono {
  const routes = new Hono();

  routes.get('/:night', async (c) => {
    let digest;
    try {
      digest = await readNight(config.runsDir, c.req.param('night'));
    } catch (error) {
      if (error instanceof RangeError) {
        return c.json({ error: 'Invalid night' }, 404);
      }
      throw error;
    }

    return c.json(digest, digest.missing ? 404 : 200);
  });

  return routes;
}
