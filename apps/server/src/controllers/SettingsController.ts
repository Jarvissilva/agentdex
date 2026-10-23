import type { Request, Response } from 'express';
import type SettingsService from '../services/SettingsService.js';
import type ModelService from '../services/ModelService.js';
export default class SettingsController {
  constructor(private readonly settings: SettingsService, private readonly models: ModelService) {}
  get = async (_request: Request, response: Response) => { response.json(await this.settings.get()); };
  put = async (request: Request, response: Response) => {
    const value = this.settings.validate(request.body);
    await Promise.all(Object.entries(value.providers).map(([id, defaults]) => this.models.validate(id, value.startingDirectory, defaults)));
    response.json(await this.settings.save(value));
  };
}
