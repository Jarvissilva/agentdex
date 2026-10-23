import type SettingsService from '../services/SettingsService.js';
import HttpError from '../lib/HttpError.js';
import pickDirectory from '../lib/pickDirectory.js';
import { homedir } from 'node:os';
import type { Request, Response } from 'express';
import type SessionService from '../services/SessionService.js';
import type SessionHistoryService from '../services/SessionHistoryService.js';

export default class SessionController {
  constructor(private readonly sessions: SessionService, private readonly defaultWorkingDirectory: string, private readonly history: SessionHistoryService, private readonly settings?: SettingsService) {}

  list = async (_request: Request, response: Response) => {
    const history = await this.history.list();
    response.json({ ...history, session: this.sessions.session, managedSessions: this.sessions.sessions, defaultWorkingDirectory: (await this.settings?.get())?.startingDirectory ?? this.defaultWorkingDirectory, homeDirectory: homedir() });
  };

  clearMemory = (_request: Request, response: Response) => { response.json(this.sessions.clearMemory()); };

  managed = (_request: Request, response: Response) => {
    response.json({ managedSessions: this.sessions.sessions });
  };

  pickDirectory = async (request: Request, response: Response) => {
    const controller = new AbortController();
    const abort = () => controller.abort();
    response.once('close', abort);
    try {
      const directory = await pickDirectory(request.body?.workingDirectory ?? this.defaultWorkingDirectory, controller.signal);
      if (!response.destroyed) response.json({ directory });
    } finally { response.off('close', abort); }
  };

  create = async (request: Request, response: Response) => {
    const body: unknown = request.body;
    const directory = body && typeof body === 'object' && 'workingDirectory' in body ? body.workingDirectory : undefined;
    const provider = body && typeof body === 'object' && 'provider' in body ? body.provider : undefined;
    const resumeSessionId = body && typeof body === 'object' && 'resumeSessionId' in body ? body.resumeSessionId : undefined;
    response.status(201).json(await this.sessions.create(directory, provider, resumeSessionId));
  };

  renameHistory = async (request: Request<{ provider: string; id: string }>, response: Response) => {
    const body: unknown = request.body;
    const title = body && typeof body === 'object' && 'title' in body ? body.title : undefined;
    await this.history.renameSession(request.params.provider, request.params.id, title);
    response.json({ renamed: true });
  };

  deleteHistory = async (request: Request<{ provider: string; id: string }>, response: Response) => {
    const { provider, id } = request.params;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,199}$/.test(id)) throw new HttpError(400, 'Invalid session ID.');
    if (provider === 'agy' && request.body?.externalSessionsStopped !== true) {
      throw new HttpError(400, 'Confirm that external Antigravity sessions are stopped.');
    }
    try {
      await this.sessions.deleteHistory(provider, () => this.history.deleteSession(provider, id));
    } finally { this.history.invalidate(); }
    response.json({ deleted: true });
  };

  stop = (request: Request<{ id: string }>, response: Response) => {
    this.sessions.stop(request.params.id);
    response.status(202).json({ session: { ...this.sessions.getRuntime(request.params.id).info } });
  };
}
