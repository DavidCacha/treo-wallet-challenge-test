import { Router, type RequestHandler } from 'express';
import { createBeneficiarySchema } from '@treo/shared';
import { contextOf, parse, userIdOf } from '../../http/validate';
import type { BeneficiariesService } from './beneficiaries.service';

export function beneficiariesRouter(service: BeneficiariesService, auth: RequestHandler): Router {
  const r = Router();

  r.get('/beneficiaries', auth, async (req, res) => {
    res.json({ data: await service.list(userIdOf(req)) });
  });

  r.post('/beneficiaries', auth, async (req, res) => {
    const input = parse(createBeneficiarySchema, req.body);
    res.status(201).json(await service.create(userIdOf(req), input, contextOf(req)));
  });

  return r;
}
