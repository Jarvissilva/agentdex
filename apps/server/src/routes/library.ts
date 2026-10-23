import { Router } from 'express';
import type LibraryController from '../controllers/LibraryController.js';

export default function libraryRoutes(controller: LibraryController, skills = false) {
  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.put);
  if (skills) router.post('/import', controller.import);
  router.put('/:id', controller.put);
  router.delete('/:id', controller.remove);
  router.post('/:id/sync', controller.sync);
  router.post('/:id/uninstall', controller.uninstall);
  return router;
}
