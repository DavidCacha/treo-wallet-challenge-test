export * from './clabe';
export * from './money';
export * from './schemas';
export type { paths, components, operations } from './generated/api';

/** Esquemas del contrato OpenAPI como tipos TypeScript. */
export type ApiSchemas = import('./generated/api').components['schemas'];
