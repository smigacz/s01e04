import { Hono } from 'hono';
import { loadConfig, type RigConfig } from './config.js';
import { lane } from './lane.js';
import { readStatus } from './status.js';
import { Layout } from './views/layout.js';
import { StatusBoard } from './views/status.js';
import { digestPageRoutes } from './digest/page-route.js';
import { digestJsonRoutes } from './digest/json-route.js';

export function createApp(config: RigConfig = loadConfig()) {
  const app = new Hono();

  app.get('/health', (c) => c.json({ ok: true, lane: lane().id }));

  app.get('/', async (c) =>
    c.html(
      <Layout title="status" lane={lane()}>
        <StatusBoard status={await readStatus(config)} />
      </Layout>,
    ),
  );

  app.route('/digest', digestPageRoutes(config));
  app.route('/api/digest', digestJsonRoutes(config));

  return app;
}
