import { Router, type RequestHandler, type Response } from 'express';
import { confirmTransferSchema, createTransferSchema, uuidSchema } from '@treo/shared';
import { contextOf, parse, userIdOf } from '../../http/validate';
import { AppError, toProblem } from '../../lib/problem';
import type { TransfersService } from './transfers.service';
import type { TransferView } from './transfer-view';

const REJECTION_DETAIL: Record<string, string> = {
  INSUFFICIENT_FUNDS: 'Saldo insuficiente',
  DAILY_LIMIT_EXCEEDED: 'La operación excede tu límite diario',
  ACCOUNT_BLOCKED: 'Una de las cuentas no está activa',
  OTP_EXPIRED: 'El código expiró o se agotaron los intentos; inicia una nueva transferencia',
};

/**
 * El código HTTP se deriva del estado ACTUAL de la transferencia, también en las
 * repeticiones por idempotencia: así un cliente que reintenta tras perder la red ve
 * el resultado real (R4.17).
 */
function sendTransfer(
  res: Response,
  transfer: TransferView,
  replayed: boolean,
  instance: string,
  requestId: string,
) {
  res.setHeader('Cache-Control', 'no-store');
  if (replayed) res.setHeader('Idempotent-Replayed', 'true');
  switch (transfer.status) {
    case 'COMPLETED':
      res.status(201).json(transfer);
      return;
    case 'PENDING_OTP':
      res.status(202).json(transfer);
      return;
    case 'REJECTED':
    case 'EXPIRED': {
      const code =
        transfer.status === 'EXPIRED' ? 'OTP_EXPIRED' : (transfer.rejection_code ?? 'REJECTED');
      const err = new AppError(code, 422, REJECTION_DETAIL[code], { transfer });
      res
        .status(422)
        .type('application/problem+json')
        .json(toProblem(err, instance, requestId));
      return;
    }
  }
}

export function transfersRouter(service: TransfersService, auth: RequestHandler): Router {
  const r = Router();

  r.post('/transfers', auth, async (req, res) => {
    const key = req.get('Idempotency-Key');
    const parsedKey = uuidSchema.safeParse(key);
    if (!parsedKey.success) {
      throw new AppError(
        'VALIDATION_ERROR',
        400,
        'El encabezado Idempotency-Key (UUID) es obligatorio',
        {
          errors: [{ path: 'Idempotency-Key', message: 'Debe ser un UUID' }],
        },
      );
    }
    const input = parse(createTransferSchema, req.body);
    const out = await service.create(
      userIdOf(req),
      parsedKey.data.toLowerCase(),
      input,
      contextOf(req),
    );
    sendTransfer(res, out.transfer, out.replayed, req.originalUrl, String(req.id));
  });

  r.get('/transfers/:transferId', auth, async (req, res) => {
    const transferId = parse(uuidSchema, req.params.transferId);
    res.setHeader('Cache-Control', 'no-store');
    res.json(await service.get(userIdOf(req), transferId));
  });

  r.post('/transfers/:transferId/confirm', auth, async (req, res) => {
    const transferId = parse(uuidSchema, req.params.transferId);
    const { code } = parse(confirmTransferSchema, req.body);
    const transfer = await service.confirm(userIdOf(req), transferId, code, contextOf(req));
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(transfer);
  });

  return r;
}
