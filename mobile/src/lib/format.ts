const dateTime = new Intl.DateTimeFormat('es-MX', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Mexico_City',
});

/** Fecha y hora en la zona de negocio (America/Mexico_City). */
export function formatDateTime(iso: string): string {
  return dateTime.format(new Date(iso));
}

const MOVEMENT_LABELS: Record<string, string> = {
  TRANSFER_IN: 'Transferencia recibida',
  TRANSFER_OUT: 'Transferencia enviada',
  DEPOSIT: 'Depósito',
};

export function movementLabel(type: string): string {
  return MOVEMENT_LABELS[type] ?? type;
}

const STATUS_LABELS: Record<string, string> = {
  COMPLETED: 'Completada',
  PENDING_OTP: 'Pendiente de código',
  REJECTED: 'Rechazada',
  EXPIRED: 'Expirada',
};

export function transferStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}
