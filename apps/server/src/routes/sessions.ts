import { Router } from 'express';
import type SessionController from '../controllers/SessionController.js';

export default function sessionRoutes(controller: SessionController) {
  const router = Router();
  router.get('/', controller.list);
  router.get('/managed', controller.managed);
  router.post('/', controller.create);
  router.post('/clear-memory', controller.clearMemory);
  router.post('/pick-directory', controller.pickDirectory);
  router.patch('/history/:provider/:id', controller.renameHistory);
  router.delete('/history/:provider/:id', controller.deleteHistory);
  router.delete('/:id', controller.stop);
  return router;
}
