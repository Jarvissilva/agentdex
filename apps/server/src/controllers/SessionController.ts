import type { Request, Response } from 'express';
import type SessionService from '../services/SessionService.js';
import type SessionHistoryService from '../services/SessionHistoryService.js';

export default class SessionController {
  constructor(private readonly sessions: SessionService, private readonly defaultWorkingDirectory: string, private readonly history: SessionHistoryService) {}

  list = async (_request: Request, response: Response) => {
    const history = await this.history.list();
    response.json({ ...history, session: this.sessions.session, defaultWorkingDirectory: this.defaultWorkingDirectory });
  };

  create = async (request: Request, response: Response) => {
    const body: unknown = request.body;
    const directory = body && typeof body === 'object' && 'workingDirectory' in body ? body.workingDirectory : undefined;
    const provider = body && typeof body === 'object' && 'provider' in body ? body.provider : undefined;
    response.status(201).json(await this.sessions.create(directory, provider));
  };

  stop = (request: Request<{ id: string }>, response: Response) => {
    this.sessions.stop(request.params.id);
    response.status(202).json({ session: this.sessions.session });
  };
}
