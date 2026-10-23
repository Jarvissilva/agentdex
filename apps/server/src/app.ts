import { createServer } from 'node:http';
import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler } from 'express';
import SessionService from './services/SessionService.js';
import SessionController from './controllers/SessionController.js';
import attachTerminals from './controllers/TerminalController.js';
import sessionRoutes from './routes/sessions.js';
import localAccess from './middlewares/localAccess.js';
import HttpError from './lib/HttpError.js';
import ProviderRegistry from './lib/providers/index.js';
import ProviderController from './controllers/ProviderController.js';
import providerRoutes from './routes/providers.js';
import SessionHistoryService from './services/SessionHistoryService.js';

interface AppOptions {
  providers?: ProviderRegistry;
  sessions?: SessionService;
  allowedOrigins?: string[];
  defaultWorkingDirectory?: string;
}

export default function createApp(options: AppOptions = {}) {
  const port = process.env.PORT || '3001';
  const origins = new Set(options.allowedOrigins ?? [
    ...['127.0.0.1', 'localhost'].flatMap((host) => [5173, 4173, Number(port)].map((value) => `http://${host}:${value}`)),
  ]);
  const providers = options.providers ?? new ProviderRegistry();
  const sessions = options.sessions ?? new SessionService(providers);
  const access = localAccess(origins);
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', access.middleware, express.json({ limit: '64kb' }));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api/providers', providerRoutes(new ProviderController(providers)));
  app.use('/api/sessions', sessionRoutes(new SessionController(sessions, options.defaultWorkingDirectory ?? process.env.INIT_CWD ?? homedir(), new SessionHistoryService(providers))));
  app.use('/api', (_request, response) => response.status(404).json({ error: 'API endpoint not found.' }));

  const clientDist = fileURLToPath(new URL('../../client/dist/', import.meta.url));
  if (existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist));
    app.get('/{*path}', (_request, response) => response.sendFile(path.join(clientDist, 'index.html')));
  }

  const errors: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (response.headersSent) { _next(error); return; }
    if (error instanceof HttpError) { response.status(error.status).json({ error: error.message }); return; }
    if (error instanceof SyntaxError) { response.status(400).json({ error: 'Invalid JSON request.' }); return; }
    if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body is too large.' });
      return;
    }
    console.error(error);
    response.status(500).json({ error: 'An unexpected server error occurred.' });
  };
  app.use(errors);
  const server = createServer(app);
  const closeTerminals = attachTerminals(server, sessions, access.authorizeSocket);
  return {
    server,
    close: () => { closeTerminals(); sessions.shutdown(); server.close(); },
  };
}
