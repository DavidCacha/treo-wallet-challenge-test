import { Router, type RequestHandler } from 'express';
import { uuidSchema } from '@treo/shared';
import { parse, userIdOf } from '../../http/validate';
import type { AccountsService } from './accounts.service';

export function accountsRouter(accounts: AccountsService, auth: RequestHandler): Router {
  const r = Router();

  r.get('/me', auth, async (req, res) => {
    res.json(await accounts.me(userIdOf(req)));
  });

  r.get('/accounts', auth, async (req, res) => {
    res.json({ data: await accounts.list(userIdOf(req)) });
  });

  r.get('/accounts/:accountId', auth, async (req, res) => {
    const accountId = parse(uuidSchema, req.params.accountId);
    res.json(await accounts.getOwned(userIdOf(req), accountId));
  });

  return r;
}
