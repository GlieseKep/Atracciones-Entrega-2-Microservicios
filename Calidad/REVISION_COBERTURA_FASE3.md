# Revisión de cobertura · cierre de la fase 3

Según la sección 2.2 del [plan](PLAN_PRUEBAS_UNIT_INTEGRACION_E2E.md), la cobertura es un diagnóstico, no una meta. Al cerrar las unitarias de `application/*` se revisaron los módulos con menos cobertura de los 12 servicios del alcance y se decidió, uno por uno, si merecen un caso nuevo.

Comando: `npx jest --selectProjects unit --coverage --collectCoverageFrom='apps/services/ms-*/src/{application,events}/**/*.ts'`.

| Módulo | Líneas cubiertas | Decisión | Motivo |
|---|---:|---|---|
| `ms-booking/application/checkin-notifier.ts` | 0 % | Sin caso nuevo | Es el aviso del check-in a Booking Central, una extensión que no está en el contrato v3. En las unitarias de P10 se usa como spy. |
| `ms-catalog/application/admin-input.ts`, `permissions.ts` | 0 % | Sin caso nuevo | Son de la administración del catálogo (panel web) y quedan fuera del alcance (inventario 0.3). |
| `ms-catalog/application/attraction-service.ts` | 31 % | Sin caso nuevo | La parte pública (P5 y la referencia y logística de P7) está cubierta. Lo que falta es administración (alta, edición, publicación), que queda fuera del alcance. |
| `ms-coupon/application/coupon-validation.ts`, `coupon-input.ts` | 0 % / 18 % | Sin caso nuevo | Son los cupones de la web. El contrato v3 solo tiene el acuerdo de promociones (P11), que está cubierto. |
| `ms-identity/application/auth-service.ts`, `user-service.ts`, `verification-service.ts`, `passwords.ts`, `mailer.ts` | 0 % | Sin caso nuevo | Son `/auth/*` y las cuentas de usuarios, fuera del alcance (inventario 0.3). T1 usa `credential-validator`, `tokens` y `api-client-service`, que están cubiertos. |
| `ms-inventory/application/booking-stock-sync.ts` | 0 % | Sin caso nuevo | Envía el stock por REST, fuera del alcance (inventario 0.3). |
| `ms-inventory/application/schedule-service.ts` | 0 % | Sin caso nuevo | Es la administración de horarios desde el panel. La generación de turnos (`slot-generator`) está cubierta, y P6 y P7 la usan por la base de datos (integración 4.1). |
| `ms-order/application/cart-sync.ts` | 0 % | Sin caso nuevo | Es del carrito (ms-cart), fuera del alcance. |
| `ms-payment/application/transfer-service.ts` | 0 % | Sin caso nuevo | Son los comprobantes de transferencia de la web; la venta de Booking es B2B. |

**Resultado:** no se agregan casos. Lo que quedó sin cubrir son módulos fuera del alcance del contrato v3.

**Nota de estabilidad:** en la primera corrida con `--coverage` (caché de ts-jest vacía, unos 210 s), un caso de `apps/partner-api/src/handlers/catalog.test.ts` falló una vez. Las tres corridas siguientes (suite completa con y sin cobertura, y la suite sola) pasaron. Según la regla 2.2 no se agregan reintentos. Si vuelve a pasar en CI, se investiga el tiempo de arranque del validador OpenAPI bajo instrumentación de cobertura.
