/**
 * Pruebas unitarias (dominio y negocio), e2e (API y auth contra PostgreSQL embebido) y db (migraciones y
 * restricciones de las bases de datos de los microservicios, también contra PostgreSQL embebido).
 */
const shared = {
  testEnvironment: 'node',
  // 151002: aviso de ts-jest sobre `module: node16` sin isolatedModules (no afecta la ejecución).
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.jest.json', diagnostics: { ignoreCodes: [151002] } }] },
  // Las pruebas usan el código fuente de los paquetes, sin necesidad de compilarlos antes.
  moduleNameMapper: {
    // El ESB importa la tabla de rutas compilada de cada microservicio (`@atracciones/ms-x-service/dist/...`): en las
    // pruebas se usa su código fuente (`apps/services/ms-x/src/...`), sin compilar antes.
    '^@atracciones/(ms-[a-z-]+)-service/dist/(.*)$': '<rootDir>/apps/services/$1/src/$2',
    '^@atracciones/(.*)$': '<rootDir>/packages/$1/src',
  },
};

module.exports = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      testMatch: [
        '<rootDir>/packages/*/src/**/*.test.ts',
        '<rootDir>/apps/*/src/**/*.test.ts',
        '<rootDir>/apps/services/*/src/**/*.test.ts',
        // Unitarias de componentes cuyo tsconfig de build no excluye los *.test.ts (gateway, esb, ms-pricing): van fuera
        // de src para no entrar en dist ni en el paquete de Azure.
        '<rootDir>/apps/*/test/**/*.unit.test.ts',
        '<rootDir>/apps/services/*/test/**/*.unit.test.ts',
      ],
    },
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
    {
      // Pruebas de integración del plan Calidad/PLAN_PRUEBAS_UNIT_INTEGRACION_E2E.md: componentes con sus dependencias
      // reales (PostgreSQL embebido con las bases ms_*, RabbitMQ local, ESB, otros servicios).
      ...shared,
      displayName: 'integration',
      testMatch: [
        '<rootDir>/packages/*/test/**/*.int.test.ts',
        '<rootDir>/apps/*/test/**/*.int.test.ts',
        '<rootDir>/apps/services/ms-*/test/**/*.int.test.ts',
        // Casos que cruzan varios servicios (migraciones de los 12, colaboración vía ESB, eventos productor → consumidor).
        '<rootDir>/test/integration/**/*.int.test.ts',
      ],
      setupFiles: ['<rootDir>/test/support/integration-env.js'],
      globalSetup: '<rootDir>/tools/test/global-setup.js',
      globalTeardown: '<rootDir>/tools/test/global-teardown.js',
    },
  ],
  testTimeout: 60000,
};
