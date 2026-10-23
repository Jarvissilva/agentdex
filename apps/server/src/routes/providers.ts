import { Router } from 'express';
import type ProviderController from '../controllers/ProviderController.js';

export default function providerRoutes(controller: ProviderController) {
  const router = Router();
  router.get('/', controller.list);
  return router;
}
