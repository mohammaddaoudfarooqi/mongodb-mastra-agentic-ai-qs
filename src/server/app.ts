import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { MongoClient } from 'mongodb';
import type { Db } from 'mongodb';
import type { Config } from '../config';
import { loadConfig } from '../config';
import { logger } from '../observability/logger';
import { ChangeStreamHub } from './change-stream-sse';
import { mountRoutes } from './routes';

/** Build the app. When `deps` is provided, the control-room API is mounted; otherwise only
 *  the health route exists (used by unit tests that don't need a DB). */
export function createApp(cfg: Config, deps?: { db: Db; hub: ChangeStreamHub }): Hono {
  const app = new Hono();
  app.get('/api/health', c => c.json({ status: 'ok', app: cfg.appName }));
  if (deps) {
    mountRoutes(app, cfg, deps.db, deps.hub);
    // No-cache the SPA shell so a plain browser refresh always loads current index.html/app.js
    // (avoids the "stale cached JS = buttons look broken" class of problem). Scoped explicitly to
    // static asset extensions and "/" and EXCLUDES /api/* — so this can never accidentally alter
    // an API response's headers even if a future route is added under the same catch-all.
    const isSpaAsset = (p: string) => !p.startsWith('/api/') && (p === '/' || /\.(html|js|css|svg|ico)$/.test(p));
    app.use('/*', async (c, next) => {
      await next();
      if (isSpaAsset(new URL(c.req.url).pathname)) {
        c.header('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    });
    // Serve the control-room SPA from ./public.
    app.use('/*', serveStatic({ root: './public' }));
  }
  return app;
}

export async function startServer(cfg: Config): Promise<void> {
  const client = new MongoClient(cfg.mongoUri);
  await client.connect();
  const db: Db = client.db(cfg.mongoDb);
  (db as any).client = client;
  const hub = new ChangeStreamHub(db);
  hub.start();
  const app = createApp(cfg, { db, hub });
  serve({ fetch: app.fetch, port: cfg.port }, info => {
    logger.info('server listening', { app: cfg.appName, port: info.port });
  });
}

// Entry point: `pnpm dev`.
if (import.meta.url === `file://${process.argv[1]}`) {
  try { process.loadEnvFile(); } catch { /* .env optional */ }
  startServer(loadConfig()).catch(err => { logger.error('server failed to start', { err: String(err) }); process.exit(1); });
}
