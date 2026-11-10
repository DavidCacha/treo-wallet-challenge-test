import { describe, expect, it } from 'vitest';
import { buildClabe, computeClabeCheckDigit, isValidClabe, maskClabe } from '../src/clabe';

describe('CLABE [R3.2]', () => {
  it.each(['002010077777777771', '032180000118359719'])('acepta CLABE válida %s', (c) => {
    expect(isValidClabe(c)).toBe(true);
  });

  it('rechaza dígito verificador incorrecto', () => {
    expect(isValidClabe('002010077777777772')).toBe(false);
  });

  it.each([
    '00201007777777777',
    '0020100777777777711',
    '00201007777777777a',
    '',
    ' 002010077777777771',
  ])('rechaza formato inválido %j', (c) => {
    expect(isValidClabe(c)).toBe(false);
  });

  it('dígito verificador 0 cuando la suma es múltiplo de 10', () => {
    const first17 = '00000000000000000';
    expect(computeClabeCheckDigit(first17)).toBe(0);
    expect(isValidClabe(`${first17}0`)).toBe(true);
  });

  it('buildClabe produce CLABEs válidas', () => {
    for (let i = 0; i < 200; i++) {
      const acct = String(i * 7919).padStart(11, '0');
      expect(isValidClabe(buildClabe('999180', acct))).toBe(true);
    }
  });

  it('maskClabe deja solo los últimos 4 dígitos', () => {
    expect(maskClabe('002010077777777771')).toBe('**************7771');
  });
});
