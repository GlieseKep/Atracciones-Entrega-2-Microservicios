// Arma out/microservices: un solo paquete con los 16 microservicios, el ESB, el Gateway, GraphQL, la Partner API y el SRI
// simulado, listo para ejecutar sin compilar en el servidor. En Azure va a una sola App Service, que los arranca todos con
// `node tools/launcher.mjs` (Plan/PLAN_DESPLIEGUE_UNA_APP.md). Cada uno también se puede arrancar solo:
//
//   node apps/services/<ms-servicio>/dist/main.js     (16 microservicios)
//   node apps/<esb|gateway|graphql|partner-api|sri-mock>/dist/main.js
//
// Los paquetes del monorepo (@atracciones/*) se incrustan en cada main.js: App Service no conserva los enlaces simbólicos
// de los workspaces. Se empaqueta la salida de `tsc`, porque esbuild no emite los metadatos de decoradores de NestJS.
// Los contratos (OpenAPI y .proto) se copian a packages/contracts, donde los busca @atracciones/platform.
//
// Uso: npx tsc -b apps/services apps/esb apps/gateway apps/graphql apps/partner-api apps/sri-mock && node tools/package-microservices.mjs
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'out', 'microservices');
const readJson = (file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

const services = readJson('apps/services/services.json').filter((name) => name.startsWith('ms-')).map((name) => `apps/services/${name}`);
export const APPS = [...services, 'apps/esb', 'apps/gateway', 'apps/graphql', 'apps/partner-api', 'apps/sri-mock'];

for (const app of APPS) {
  if (!existsSync(join(root, app, 'dist', 'main.js'))) throw new Error(`Falta ${app}/dist/main.js: compile antes con tsc -b.`);
}

// Carpeta de cada workspace del monorepo, por nombre de paquete.
const workspaces = new Map();
for (const pattern of readJson('package.json').workspaces) {
  if (existsSync(join(root, pattern, 'package.json'))) workspaces.set(readJson(`${pattern}/package.json`).name, pattern);
}

// Dependencias de terceros de las apps y de los workspaces que usan, fijadas a la versión instalada (la del package-lock).
const dependencies = {};
const visited = new Set();
/** Versión instalada: npm puede dejar un paquete dentro del workspace que lo usa en lugar de la raíz. */
const installedVersion = (dir, name) => {
  const local = `${dir}/node_modules/${name}/package.json`;
  return readJson(existsSync(join(root, local)) ? local : `node_modules/${name}/package.json`).version;
};
const collect = (dir) => {
  if (visited.has(dir)) return;
  visited.add(dir);
  for (const name of Object.keys(readJson(`${dir}/package.json`).dependencies ?? {})) {
    if (workspaces.has(name)) collect(workspaces.get(name));
    else dependencies[name] = installedVersion(dir, name);
  }
};
for (const app of APPS) collect(app);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

for (const app of APPS) {
  await build({
    entryPoints: [join(root, app, 'dist', 'main.js')],
    outfile: join(out, app, 'dist', 'main.js'),
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: true,
    // Todo lo que no es del monorepo se resuelve en node_modules en tiempo de ejecución (incluidos los require opcionales de NestJS).
    plugins: [{
      name: 'externals',
      setup(b) {
        b.onResolve({ filter: /^[^./]/ }, (args) =>
          args.kind === 'entry-point' || args.path.startsWith('@atracciones/') ? undefined : { path: args.path, external: true },
        );
      },
    }],
    logLevel: 'warning',
  });
}

mkdirSync(join(out, 'tools'), { recursive: true });
cpSync(join(root, 'tools', 'launcher.mjs'), join(out, 'tools', 'launcher.mjs'));

for (const folder of ['openapi', 'proto']) {
  cpSync(join(root, 'packages', 'contracts', folder), join(out, 'packages', 'contracts', folder), { recursive: true });
}

const rootPkg = readJson('package.json');
writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify({ name: 'tourgirls-microservicios', version: rootPkg.version, private: true, engines: rootPkg.engines, dependencies }, null, 2)}\n`,
);
execSync('npm install --omit=dev --no-audit --no-fund --ignore-scripts', { cwd: out, stdio: 'inherit' });
console.log(`Listo: ${out} (${APPS.length} apps)`);
