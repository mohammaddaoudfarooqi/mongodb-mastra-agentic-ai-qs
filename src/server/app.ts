import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Config } from '../config';
import { loadConfig } from '../config';
import { logger } from '../observability/logger';

export function createApp(cfg: Config): Hono {
  const app = new Hono();
  app.get('/api/health', c => c.json({ status: 'ok', app: cfg.appName }));
  return app;
}

// Entry point: `pnpm dev`. Guarded so importing this module in tests does not start a server.
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.loadEnvFile(); } catch { /* .env optional */ }
  const cfg = loadConfig();
  const app = createApp(cfg);
  serve({ fetch: app.fetch, port: cfg.port }, info => {
    logger.info('server listening', { app: cfg.appName, port: info.port });
  });
}
