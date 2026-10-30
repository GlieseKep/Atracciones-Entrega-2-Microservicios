/**
 * Pruebas unitarias (dominio y negocio), e2e (API y auth contra PostgreSQL embebido) y db (migraciones y
 * restricciones de las bases de datos de los microservicios, también contra PostgreSQL embebido).
 */
const shared = {
  testEnvironment: 'node',
  // 151002: aviso de ts-jest sobre `module: node16` sin isolatedModules (no afecta la ejecución).
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json', diagnostics: { ignoreCodes: [151002] } }] },
  // Las pruebas usan el código fuente de los paquetes, sin necesidad de compilarlos antes.
  moduleNameMapper: { '^@atracciones/(.*)$': '<rootDir>/packages/$1/src' },
};

module.exports = {
  projects: [
    { ...shared, displayName: 'unit', testMatch: ['<rootDir>/packages/*/src/**/*.test.ts', '<rootDir>/apps/*/src/**/*.test.ts', '<rootDir>/apps/services/*/src/**/*.test.ts'] },
    {
      ...shared,
      displayName: 'e2e',
      testMatch: ['<rootDir>/apps/*/test/**/*.e2e.test.ts', '<rootDir>/test/system/**/*.e2e.test.ts'],
      globalSetup: '<rootDir>/tools/test/global-setup.js',
      globalTeardown: '<rootDir>/tools/test/global-teardown.js',
    },
    {
      ...shared,
      displayName: 'db',
      testMatch: ['<rootDir>/apps/services/test/**/*.db.test.ts', '<rootDir>/apps/services/*/test/**/*.db.test.ts'],
      globalSetup: '<rootDir>/tools/test/global-setup.js',
      globalTeardown: '<rootDir>/tools/test/global-teardown.js',
    },
  ],
  testTimeout: 60000,
};
