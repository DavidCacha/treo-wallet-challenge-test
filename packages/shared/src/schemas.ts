import { z } from 'zod';
import { isClabeFormat } from './clabe';
import { MAX_TRANSFER_CENTS } from './money';

export const uuidSchema = z.string().uuid();

export const emailSchema = z.string().trim().toLowerCase().email('Correo inválido').max(254);

export const registerSchema = z
  .object({
    email: emailSchema,
    full_name: z.string().trim().min(1, 'Requerido').max(120),
    password: z.string().min(10, 'Mínimo 10 caracteres').max(128),
  })
  .strict();

export const loginSchema = z
  .object({
    email: emailSchema,
    password: z.string().min(1, 'Requerido').max(128),
  })
  .strict();

export const refreshSchema = z.object({ refresh_token: z.string().min(1).max(512) }).strict();

export const clientPlatformSchema = z.enum(['web', 'mobile']);

export const clabeSchema = z
  .string()
  .refine(isClabeFormat, 'La CLABE debe tener exactamente 18 dígitos');

export const createBeneficiarySchema = z
  .object({
    name: z.string().trim().min(1, 'Requerido').max(80),
    alias: z.string().trim().min(1, 'Requerido').max(30),
    clabe: clabeSchema,
  })
  .strict();

/** Caracteres imprimibles (sin controles). */
const PRINTABLE = /^[^\p{Cc}\p{Cf}]+$/u;

export const createTransferSchema = z
  .object({
    source_account_id: uuidSchema,
    beneficiary_id: uuidSchema.optional(),
    destination_account_id: uuidSchema.optional(),
    amount_cents: z
      .number({ invalid_type_error: 'El monto debe ser un entero de centavos' })
      .int('El monto debe ser un entero de centavos (sin decimales)')
      .positive('El monto debe ser mayor a cero')
      .max(MAX_TRANSFER_CENTS, 'El monto excede el máximo por transferencia'),
    concept: z
      .string()
      .trim()
      .min(1, 'Requerido')
      .max(40, 'Máximo 40 caracteres')
      .regex(PRINTABLE, 'Contiene caracteres no permitidos'),
    reference: z.string().regex(/^\d{1,7}$/, 'La referencia debe tener de 1 a 7 dígitos'),
  })
  .strict()
  .refine((v) => (v.beneficiary_id === undefined) !== (v.destination_account_id === undefined), {
    message: 'Indica exactamente un destino: beneficiary_id o destination_account_id',
    path: ['beneficiary_id'],
  });

export const confirmTransferSchema = z
  .object({ code: z.string().regex(/^\d{6}$/, 'El código tiene 6 dígitos') })
  .strict();

export const movementTypeSchema = z.enum(['TRANSFER_IN', 'TRANSFER_OUT', 'DEPOSIT']);

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD')
  .refine(
    (s) =>
      !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
      new Date(`${s}T00:00:00Z`).toISOString().startsWith(s),
    'Fecha inválida',
  );

export const movementsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    type: movementTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(200).optional(),
  })
  .strict()
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '`from` no puede ser posterior a `to`',
    path: ['from'],
  });

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type CreateBeneficiaryInput = z.infer<typeof createBeneficiarySchema>;
export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type ConfirmTransferInput = z.infer<typeof confirmTransferSchema>;
export type MovementsQuery = z.infer<typeof movementsQuerySchema>;
export type MovementType = z.infer<typeof movementTypeSchema>;
