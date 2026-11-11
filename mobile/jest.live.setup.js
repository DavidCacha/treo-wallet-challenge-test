const real = globalThis.__nodeFetch;
globalThis.fetch = real.fetch;
globalThis.Headers = real.Headers;
globalThis.Request = real.Request;
globalThis.Response = real.Response;
