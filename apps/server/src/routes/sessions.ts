import { Router } from 'express';
import type SessionController from '../controllers/SessionController.js';

export default function sessionRoutes(controller: SessionController) {
  const router = Router();
  router.get('/', controller.list);
  router.post('/', controller.create);
  router.delete('/:id', controller.stop);
  return router;
}
