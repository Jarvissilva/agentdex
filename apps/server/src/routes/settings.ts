import { Router } from 'express';
import type SettingsController from '../controllers/SettingsController.js';
export default function settingsRoutes(controller: SettingsController) {
  const router = Router();
  router.get('/', controller.get);
  router.put('/', controller.put);
  return router;
}
