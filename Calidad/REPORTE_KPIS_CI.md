# Reporte de KPIs de CI: workflow «Pruebas»

**Fuente:** API pública de GitHub Actions del repositorio `GlieseKep/Atracciones-Entrega-2-Microservicios`, workflow [`.github/workflows/pruebas.yml`](../.github/workflows/pruebas.yml). Consulta del 2026-11-16.
**Período:** las 6 ejecuciones que hubo, entre el 2026-11-16 00:55 y 02:57 UTC (el workflow empezó a correr con el commit `19cd092`).
**Límite de la fuente:** sin sesión iniciada, la API no entrega los logs de los jobs (responde 403) ni descarga el artefacto de cobertura. Por eso no hay conteo de casos ni porcentajes de cobertura medidos en CI. Ver la sección 7.

## 1. Ejecuciones

| # | Commit | Hora inicio (UTC) | Resultado | Duración | lint | unit | integration | e2e |
|---|---|---|---|---:|---|---|---|---|
| 1 | `19cd092` Pruebas unitarias, de integración y E2E | 00:55:39 | ❌ Falla | 1 min 11 s | ✅ 22 s | ❌ 43 s | omitido | omitido |
| 2 | `edb11cb` Arreglar la interfaz de admin… | 01:06:05 | ❌ Falla | 1 min 16 s | ✅ 21 s | ❌ 51 s | omitido | omitido |
| 3 | `b57cb84` Cambiar los workflows para los test | 01:42:45 | ✅ Éxito | 4 min 59 s | ✅ 25 s | ✅ 55 s | ✅ 2 min 09 s | ✅ 1 min 20 s |
| 4 | `fbfede9` Agregar botones de cancelación… | 01:56:46 | ⏹ Cancelada | 4 min 32 s | ✅ 20 s | ✅ 1 min 01 s | ✅ 1 min 44 s | ⏹ 1 min 18 s |
| 5 | `12a8a5b` Agregar botones de cancelación… | 02:01:01 | ✅ Éxito | 5 min 14 s | ✅ 21 s | ✅ 57 s | ✅ 2 min 06 s | ✅ 1 min 24 s |
| 6 | `22c9687` Agregar botones de cancelación… | 02:52:21 | ✅ Éxito | 5 min 07 s | ✅ 27 s | ✅ 1 min 12 s | ✅ 2 min 02 s | ✅ 1 min 20 s |

Todas las ejecuciones son del evento `push` a `main` y tienen un solo intento: no se volvió a lanzar ninguna a mano.

## 2. Tasa de éxito

| KPI | Cálculo | Valor |
|---|---|---|
| Tasa de éxito total | ejecuciones en verde / ejecuciones | 3 / 6 = **50 %** |
| Tasa de éxito sin canceladas | en verde / (en verde + falladas) | 3 / 5 = **60 %** |
| Tasa de éxito desde la corrección del workflow (`b57cb84`) | en verde / terminadas | 3 / 3 = **100 %** (más 1 cancelada) |
| Ejecuciones falladas | — | 2, ambas en el job `unit` |
| Ejecuciones canceladas | — | 1, cancelada por `concurrency` (ver sección 5) |

## 3. Causa de las fallas y tiempo de recuperación

Las ejecuciones 1 y 2 fallaron en el paso de pruebas unitarias con `Process completed with exit code 1`. Sin los logs, la causa se deduce del commit que lo arregló (`b57cb84`), que cambió dos cosas:

1. **Faltaba compilar antes de las pruebas.** Agregó `npm run build` a los jobs `unit`, `integration` y `e2e`. Algunas pruebas importan `dist/` de los microservicios (por ejemplo, a través de `apps/esb/src/routes.ts`), y cada job empieza con el repositorio sin compilar. En local no pasaba porque `dist/` ya existía.
2. **El hash del contrato dependía del fin de línea.** `packages/platform/src/contract-files.test.ts` calculaba el SHA-256 del archivo del contrato v3 tal cual estaba en disco. En Windows (`core.autocrlf`) el archivo tiene CRLF y en el runner de Linux tiene LF, así que el hash no coincidía. Ahora el hash se calcula con los fines de línea normalizados a LF.

Las dos son diferencias entre el entorno local y el de CI, no defectos del sistema. El pipeline las detectó en la primera ejecución, que es para lo que está.

| KPI | Cálculo | Valor |
|---|---|---|
| Tiempo hasta la señal de falla | inicio → fin de la ejecución fallada | **1 min 11 s y 1 min 16 s**: el orden lint → unit cortó antes de integración y E2E |
| Tiempo de recuperación (MTTR) | primera ejecución en rojo (00:55:39) → primera en verde (01:47:44) | **52 min** |
| Commits seguidos en rojo | — | 2 |

## 4. Duración

Promedios sobre las ejecuciones donde el job terminó; la ejecución 4 cuenta en los jobs que terminó antes de la cancelación.

| Job | Duración del job | Solo el paso de pruebas | Muestras |
|---|---:|---:|---:|
| lint (chequeo de tipos con `tsc -b`) | 23 s | 9 s | 6 |
| unit (con cobertura) | 1 min 01 s | 33 s | 4 |
| integration (PostgreSQL embebido + RabbitMQ) | 2 min 00 s | 1 min 12 s | 4 |
| e2e (contrato v3 por el Gateway) | 1 min 21 s | 37 s | 3 |

| KPI | Valor |
|---|---|
| Duración promedio del pipeline en verde | **5 min 07 s** (4 min 59 s a 5 min 14 s) |
| Variación entre ejecuciones en verde | 15 s (±3 %) |
| Espera entre jobs (cola del runner) | 6 s a 26 s por ejecución |
| Job más lento | `integration`: alrededor del 40 % de la duración |

**Preparación frente a pruebas.** En la ejecución 6, de 301 s de jobs, 161 s fueron chequeo de tipos y pruebas. Los otros 140 s (47 %) fueron preparación repetida en cada job:

| Paso de preparación | Duración por job |
|---|---|
| `npm ci` | 5 s a 10 s |
| `npm run build` | 7 s a 13 s |
| Arranque del contenedor RabbitMQ (`integration` y `e2e`) | 17 s a 21 s |

**Comparación con local.**

| Suite | Paso en CI | En local |
|---|---:|---:|
| Unitarias | 30 s a 40 s | 46 s con caché |
| E2E | 34 s a 40 s | Unos 90 s |

El runner de GitHub no comparte la máquina con el editor ni con Docker Desktop.

## 5. Estabilidad

| KPI | Valor |
|---|---|
| Pruebas intermitentes en CI | **0 observadas**: ninguna ejecución pasó de rojo a verde sin un cambio de código que lo explique, y no hubo reintentos. La muestra es chica (3 ejecuciones completas). |
| Reintentos manuales (`run_attempt` > 1) | 0 |
| Fallas por infraestructura (runner, contenedor de RabbitMQ) | 0: el contenedor arrancó sano en las 8 veces que se levantó |
| Cancelaciones por `concurrency` | 1. La ejecución 4 (`fbfede9`) se canceló cuando llegó el push `12a8a5b`, 4 min 15 s después (*«Canceling since a higher priority waiting request for pruebas-refs/heads/main exists»*). Es lo esperado: se prueba solo el último commit. |

## 6. Cumplimiento de lo planificado en el plan §6.1

| Punto | Estado |
|---|---|
| Orden de fallo rápido lint → unit → integration → e2e | ✅ Funciona: en las fallas, `integration` y `e2e` quedaron como «omitido» |
| Sin conexión al RabbitMQ real | ✅ Integración y E2E usan el contenedor de servicio `rabbitmq:3.13-management-alpine` en `localhost:5672` |
| Reporte de cobertura como artefacto | ✅ Se subió `cobertura-unitarias` en todas las ejecuciones, también en las falladas (`if: always()`). El último pesa 594 KB y expira el 2027-02-14. |
| Required status checks en `main` | ⏳ **Pendiente.** La API informa `protected: false` para `main`. Hay que activarlos en *Settings → Branches* para los 4 jobs: `lint`, `unit`, `integration`, `e2e`. |

**Observación.** El workflow de despliegue *Desplegar en Azure App Service* corre en paralelo y no depende de «Pruebas». En el commit `19cd092` el despliegue terminó en verde mientras las pruebas fallaban. El plan dejó este comportamiento a propósito, porque no modifica los workflows existentes. Los required status checks bloquean merges de PR, no los push directos ni los despliegues.

## 7. KPIs que no se pudieron medir desde la API

| KPI | Motivo | Cómo obtenerlo |
|---|---|---|
| Casos ejecutados en CI por suite (pasados, fallidos, `it.failing`) | Los logs exigen sesión (HTTP 403) | Abrir el log del paso de pruebas de cada job en la pestaña *Actions* (líneas `Tests:` de Jest) |
| Cobertura medida en CI | La descarga del artefacto exige sesión | Descargar `cobertura-unitarias` de la ejecución 6 (`coverage/lcov-report/index.html`) o ver el `text-summary` en el log del job `unit` |
| Minutos facturables | La API informa 0 ms: el repositorio es público y los minutos de Linux no se cobran | — |
| Tendencias (duración, tasa de éxito, intermitentes) | 6 ejecuciones en un solo día | Repetir este reporte cuando haya más ejecuciones |

## 8. Avisos de la plataforma (riesgos a futuro)

- **Node.js 20 obsoleto en las acciones.** GitHub avisa que `actions/checkout@v4`, `actions/setup-node@v4` y `actions/upload-artifact@v4` usan Node.js 20 y las está forzando a correr en Node.js 24. Hoy funciona; conviene pasar a versiones de las acciones que usen Node 24 cuando estén disponibles.
- **Cambio de `ubuntu-latest`.** La etiqueta `ubuntu-latest` está migrando a Ubuntu 26 desde el 2026-10-19. Si el cambio rompe algo (por ejemplo `embedded-postgres`), la falla saldría en el job `integration`.
