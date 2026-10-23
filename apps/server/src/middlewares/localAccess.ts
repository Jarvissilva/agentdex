import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { IncomingMessage } from 'node:http';

export default function localAccess(allowedOrigins: Set<string>) {
  const token = randomBytes(32).toString('hex');
  const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));

  function hasCookie(request: IncomingMessage): boolean {
    const value = request.headers.cookie?.split(';').map((cookie) => cookie.trim()).find((cookie) => cookie.startsWith('agentdex='))?.slice('agentdex='.length);
    return !!value && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token));
  }

  function allowed(request: IncomingMessage): boolean {
    return !!request.headers.host && allowedHosts.has(request.headers.host)
      && (!request.headers.origin || allowedOrigins.has(request.headers.origin));
  }

  const middleware: RequestHandler = (request, response, next) => {
    response.setHeader('Cache-Control', 'no-store');
    if (!allowed(request) || ((!['GET', 'HEAD'].includes(request.method) || /^\/sessions\/managed\/?$/i.test(request.path)) && !hasCookie(request))) {
      response.status(403).json({ error: 'Local access denied. Open AgentDex in its local browser tab.' });
      return;
    }
    if (!hasCookie(request)) response.cookie('agentdex', token, { httpOnly: true, sameSite: 'strict', path: '/api' });
    next();
  };

  return {
    middleware,
    authorizeSocket: (request: IncomingMessage) => allowed(request) && !!request.headers.origin && hasCookie(request),
  };
}
