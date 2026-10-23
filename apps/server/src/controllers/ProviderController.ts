import type { Request, Response } from 'express';
import type ProviderRegistry from '../lib/providers/index.js';

export default class ProviderController {
  constructor(private readonly providers: ProviderRegistry) {}

  list = (_request: Request, response: Response) => {
    response.json({ providers: this.providers.list(), defaultProviderId: this.providers.defaultProviderId });
  };
}
