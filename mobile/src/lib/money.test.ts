import { formatCents } from '@treo/shared';

/**
 * T-25: Hermes puede no aceptar cadenas decimales en Intl.NumberFormat#format
 * (Intl.NumberFormat v3). formatCents tiene una alternativa sin float; aquí se
 * simula ese motor para comprobarla. La prueba en un dispositivo real queda
 * documentada aparte (ver ai-log).
 */
describe('formatCents en un motor sin Intl.NumberFormat v3', () => {
  const RealNumberFormat = Intl.NumberFormat;

  afterEach(() => {
    Intl.NumberFormat = RealNumberFormat;
  });

  it('usa la alternativa exacta cuando format(string) devuelve NaN', () => {
    // Motor antiguo: convierte la cadena a número de forma inválida.
    Intl.NumberFormat = function (this: unknown, locale?: string, opts?: Intl.NumberFormatOptions) {
      const real = new RealNumberFormat(locale, opts);
      return {
        format: (v: number | string) => (typeof v === 'string' ? '$NaN' : real.format(v)),
      };
    } as unknown as typeof Intl.NumberFormat;

    // Módulo recién cargado: su caché de formateadores aún no existe.
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const fresh = require('@treo/shared') as typeof import('@treo/shared');
      expect(fresh.formatCents(123456789)).toBe('$1,234,567.89');
      expect(fresh.formatCents(-5)).toBe('-$0.05');
    });
  });

  it('con Intl completo formatea centavos sin pasar por float', () => {
    expect(formatCents(900719925474099)).toBe('$9,007,199,254,740.99');
  });
});
