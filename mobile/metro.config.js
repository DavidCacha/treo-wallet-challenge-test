// Metro: la app no es parte de los workspaces de npm (usa React 19 y la web
// React 18), así que consume @treo/shared directamente desde su código fuente.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const sharedSrc = path.resolve(projectRoot, '../packages/shared/src');

const config = getDefaultConfig(projectRoot);
config.watchFolders = [sharedSrc];
// Lo que no se encuentre subiendo directorios (p. ej. zod importada desde
// packages/shared/src) se toma de mobile/node_modules.
config.resolver.extraNodeModules = {
  '@treo/shared': sharedSrc,
  zod: path.resolve(projectRoot, 'node_modules/zod'),
};

module.exports = config;
