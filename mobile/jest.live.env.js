// Entorno para las pruebas "live": el preset de React Native reemplaza fetch por
// un mock; aquí se guarda el fetch real de Node para usar la API local de verdad.
const NativeEnvironment = require('jest-expo/src/preset/nativeEnvironment');

module.exports = class LiveEnvironment extends NativeEnvironment {
  constructor(config, context) {
    super(config, context);
    this.global.__nodeFetch = { fetch, Headers, Request, Response };
  }
};
