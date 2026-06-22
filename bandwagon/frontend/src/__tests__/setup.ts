import '@testing-library/jest-dom';

// jsdom's localStorage is unavailable on Node 26 (experimental localStorage
// requires --localstorage-file). Provide a simple in-memory shim.
const localStorageMap = new Map<string, string>();
const localStorageShim: Storage = {
  getItem: (k) => localStorageMap.get(k) ?? null,
  setItem: (k, v) => { localStorageMap.set(k, String(v)); },
  removeItem: (k) => { localStorageMap.delete(k); },
  clear: () => { localStorageMap.clear(); },
  key: (i) => [...localStorageMap.keys()][i] ?? null,
  get length() { return localStorageMap.size; },
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageShim, writable: true });
