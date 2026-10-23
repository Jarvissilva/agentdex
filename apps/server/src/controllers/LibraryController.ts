import type { Request, Response } from 'express';
import type { LibraryInput, LibraryKind, SyncRequest } from '@agentdex/shared';
import LibraryService from '../services/LibraryService.js';

export default class LibraryController {
  constructor(private readonly service: LibraryService, private readonly kind: LibraryKind) {}
  list = async (_request: Request, response: Response) => { response.json({ items: await this.service.list(this.kind) }); };
  put = async (request: Request, response: Response) => {
    const id = await this.service.put(this.kind, request.body as LibraryInput, request.params.id as string | undefined);
    response.status(request.params.id ? 200 : 201).json({ item: (await this.service.list(this.kind)).find(item => item.id === id) });
  };
  import = async (request: Request, response: Response) => {
    const body = request.body as { name: string; path: string };
    const id = await this.service.put('skills', { name: body.name }, undefined, body.path);
    response.status(201).json({ item: (await this.service.list('skills')).find(item => item.id === id) });
  };
  sync = async (request: Request, response: Response) => { response.json({ results: await this.service.sync(this.kind, request.params.id as string, (request.body as SyncRequest).destinations, false, request.body as SyncRequest) }); };
  uninstall = async (request: Request, response: Response) => { response.json({ results: await this.service.sync(this.kind, request.params.id as string, (request.body as SyncRequest).destinations, true) }); };
  remove = async (request: Request, response: Response) => { await this.service.remove(this.kind, request.params.id as string); response.json({ deleted: true }); };
}
