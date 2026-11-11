// Pruebas contra la API local real: npm run test:live (requiere la API corriendo).
const base = require('./package.json').jest;

module.exports = {
  ...base,
  testEnvironment: '<rootDir>/jest.live.env.js',
  setupFiles: [...base.setupFiles, '<rootDir>/jest.live.setup.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  testMatch: ['**/*.live.test.ts'],
};
