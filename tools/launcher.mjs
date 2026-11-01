// Lanzador de Descubre EC en una sola App Service (Plan/PLAN_DESPLIEGUE_UNA_APP.md): arranca los 16 microservicios, el SRI
// simulado, el ESB, la Partner API, GraphQL y el Gateway como procesos Node separados dentro del mismo contenedor.
//
//   Comando de inicio en Azure:  node tools/launcher.mjs
//
// Cada proceso recibe su puerto local y su base (`DATABASE_SERVER_URL` + `/ms_<servicio>`). Solo el Gateway escucha en el
// `PORT` de App Service; los demás se hablan por localhost. Si un proceso termina, se reinicia con espera creciente.
import { fork } from 'node:child_process';
import { connect } from 'node:net';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const local = (port) => `http://127.0.0.1:${port}`;

/** Puertos locales: los mismos que usa cada servicio por defecto. */
const SERVICES = {
  'ms-identity': 4018, 'ms-location': 4014, 'ms-catalog': 4019, 'ms-billing-profile': 4013, 'ms-pricing': 4026,
  'ms-inventory': 4025, 'ms-review': 4015, 'ms-coupon': 4011, 'ms-cart': 4012, 'ms-payment': 4020, 'ms-order': 4024,
  'ms-booking': 4023, 'ms-refund': 4016, 'ms-invoicing': 4021, 'ms-support': 4017, 'ms-audit': 4022,
};
const PORTS = { esb: 3300, 'partner-api': 3100, graphql: 3200, 'sri-mock': 4091 };

/** Destinos del ESB (`<SERVICIO>_URL`), todos en localhost. */
const ESB_TARGETS = {
  IDENTITY_URL: 'ms-identity', LOCATION_URL: 'ms-location', CATALOG_URL: 'ms-catalog', BILLING_URL: 'ms-billing-profile',
  PRICING_URL: 'ms-pricing', INVENTORY_URL: 'ms-inventory', REVIEW_URL: 'ms-review', COUPON_URL: 'ms-coupon', CART_URL: 'ms-cart',
  PAYMENT_URL: 'ms-payment', ORDER_URL: 'ms-order', BOOKING_URL: 'ms-booking', REFUND_URL: 'ms-refund',
  INVOICING_URL: 'ms-invoicing', SUPPORT_URL: 'ms-support', AUDIT_URL: 'ms-audit',
};

const server = (process.env.DATABASE_SERVER_URL ?? 'postgres://postgres:tourgirls-local@localhost:5433').replace(/\/+$/, '');
const publicPort = Number(process.env.PORT ?? 8080);

// Variables de App Service que no deben pasar tal cual a los procesos: cada uno recibe las suyas.
const inherited = { ...process.env };
for (const name of ['PORT', 'NODE_OPTIONS', 'DATABASE_URL', 'DATABASE_SERVER_URL', 'NODE_ID', 'NODE_CODE']) delete inherited[name];

/** Procesos en orden de arranque: servicios, SRI simulado, ESB, Partner API, GraphQL y, al final, el Gateway. */
const PROCESSES = [
  ...Object.entries(SERVICES).map(([name, port]) => ({
    name, port, file: `apps/services/${name}/dist/main.js`,
    env: {
      DATABASE_URL: `${server}/${name.replace(/-/g, '_')}`,
      ...(name === 'ms-payment' ? { PAYMENT_WEBHOOK_URL: `${local(port)}/api/v3/webhooks/simulada` } : {}),
    },
  })),
  { name: 'sri-mock', port: PORTS['sri-mock'], file: 'apps/sri-mock/dist/main.js', env: { SRI_MOCK_PORT: String(PORTS['sri-mock']) } },
  {
    name: 'esb', port: PORTS.esb, file: 'apps/esb/dist/main.js',
    env: Object.fromEntries(Object.entries(ESB_TARGETS).map(([variable, name]) => [variable, local(SERVICES[name])])),
  },
  {
    name: 'partner-api', port: PORTS['partner-api'], file: 'apps/partner-api/dist/main.js', memory: 192,
    env: { NODE_ID: 'node-atr-molina-01', NODE_CODE: 'NODE_ATR_MOLINA' },
  },
  { name: 'graphql', port: PORTS.graphql, file: 'apps/graphql/dist/main.js', memory: 192, env: {} },
  {
    name: 'gateway', port: publicPort, file: 'apps/gateway/dist/main.js',
    env: {
      PARTNER_API_URL: local(PORTS['partner-api']),
      GRAPHQL_URL: local(PORTS.graphql),
      IDENTITY_URL: local(SERVICES['ms-identity']),
    },
  },
];

const log = (message) => console.log(`[launcher] ${message}`);
const children = new Map();
let stopping = false;

/** Copia la salida del proceso al log del contenedor, con su nombre delante. */
function pipe(stream, name, target) {
  if (!stream) return;
  createInterface({ input: stream }).on('line', (line) => target.write(`[${name}] ${line}\n`));
}

function start(spec, attempt = 0) {
  if (stopping) return;
  const child = fork(join(root, spec.file), [], {
    cwd: root,
    silent: true,
    execArgv: [`--max-old-space-size=${spec.memory ?? 128}`],
    // ESB_CALL_TIMEOUT_MS: mayor que la ruta más lenta del ESB (compra: 20 s × ESB_TIMEOUT_FACTOR 3 = 60 s).
    env: { ESB_CALL_TIMEOUT_MS: '65000', ...inherited, ...spec.env, PORT: String(spec.port), ESB_URL: local(PORTS.esb), NODE_ENV: 'production' },
  });
  const startedAt = Date.now();
  children.set(spec.name, child);
  pipe(child.stdout, spec.name, process.stdout);
  pipe(child.stderr, spec.name, process.stderr);
  child.on('exit', (code, signal) => {
    children.delete(spec.name);
    if (stopping) return;
    // Si duró más de un minuto, la próxima caída vuelve a empezar desde 1 s.
    const next = Date.now() - startedAt > 60_000 ? 0 : attempt + 1;
    const wait = Math.min(1000 * 2 ** next, 30_000);
    log(`${spec.name} terminó (código ${code ?? signal}); se reinicia en ${wait / 1000} s`);
    setTimeout(() => start(spec, next), wait);
  });
}

/** Espera a que el puerto acepte conexiones (o se rinde a los `timeoutMs`). */
function waitForPort(port, timeoutMs) {
  const until = Date.now() + timeoutMs;
  return new Promise((resolve) => {
    const attempt = () => {
      const socket = connect(port, '127.0.0.1');
      socket.once('connect', () => { socket.destroy(); resolve(true); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() > until) resolve(false);
        else setTimeout(attempt, 1000);
      });
    };
    attempt();
  });
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log(`${signal}: deteniendo ${children.size} procesos`);
  for (const child of children.values()) child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 10_000).unref();
  const check = setInterval(() => {
    if (children.size === 0) {
      clearInterval(check);
      process.exit(0);
    }
  }, 200);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Los servicios arrancan de a 4 para no saturar CPU y memoria; el Gateway, al final, abre el puerto público.
const BATCH = 4;
for (let i = 0; i < PROCESSES.length; i += BATCH) {
  const batch = PROCESSES.slice(i, i + BATCH);
  for (const spec of batch) start(spec);
  const ready = await Promise.all(batch.map((spec) => waitForPort(spec.port, 120_000)));
  batch.forEach((spec, index) => log(`${spec.name} ${ready[index] ? 'escuchando' : 'NO responde'} en :${spec.port}`));
}
log(`${children.size} procesos en marcha; público en :${publicPort}`);
