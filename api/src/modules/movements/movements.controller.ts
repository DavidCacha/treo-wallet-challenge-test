import { Router, type RequestHandler } from 'express';
import { movementsQuerySchema, uuidSchema } from '@treo/shared';
import { parse, userIdOf } from '../../http/validate';
import type { MovementsService } from './movements.service';

export function movementsRouter(service: MovementsService, auth: RequestHandler): Router {
  const r = Router();
  r.get('/accounts/:accountId/movements', auth, async (req, res) => {
    const accountId = parse(uuidSchema, req.params.accountId);
    const query = parse(movementsQuerySchema, req.query);
    res.json(await service.list(userIdOf(req), accountId, query));
  });
  return r;
}
