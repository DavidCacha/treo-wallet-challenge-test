let n = 0;
/** UUID v4 válidos y deterministas en pruebas. */
export const randomUUID = jest.fn(() => {
  n += 1;
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
});
export const getRandomValues = jest.fn(<T extends ArrayBufferView>(arr: T) => {
  if (arr instanceof Uint32Array) arr.fill(1234567);
  return arr;
});
