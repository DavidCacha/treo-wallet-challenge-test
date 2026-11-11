export const __store = new Map<string, string>();
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'WHEN_UNLOCKED_THIS_DEVICE_ONLY';
export const getItemAsync = jest.fn(async (k: string) => __store.get(k) ?? null);
export const setItemAsync = jest.fn(async (k: string, v: string) => {
  __store.set(k, v);
});
export const deleteItemAsync = jest.fn(async (k: string) => {
  __store.delete(k);
});
