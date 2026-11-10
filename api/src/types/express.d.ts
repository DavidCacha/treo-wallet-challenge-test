import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Lo coloca el middleware authenticate a partir del JWT. */
    auth?: { userId: string };
  }
}
