import type SettingsService from '../services/SettingsService.js';
import type ModelService from '../services/ModelService.js';
import type { Request, Response } from 'express';
import type ProviderRegistry from '../lib/providers/index.js';

export default class ProviderController {
  constructor(private readonly providers: ProviderRegistry, private readonly settings?: SettingsService, private readonly modelService?: ModelService) {}

  models = async (request: Request<{ id: string }>, response: Response) => {
    const directory = typeof request.query.workingDirectory === 'string' ? request.query.workingDirectory : (await this.settings?.get())?.startingDirectory ?? process.cwd();
    response.json(await this.modelService?.list(request.params.id, directory, request.query.refresh === 'true'));
  };

  list = async (_request: Request, response: Response) => {
    response.json({ providers: this.providers.list(), defaultProviderId: (await this.settings?.get())?.defaultProviderId ?? this.providers.defaultProviderId });
  };
}
