# TourGirls — Modelo de base de datos

Fuente: migraciones vigentes de `apps/services/ms-*/src/persistence/migrations/` (PostgreSQL).
Cada microservicio tiene **su propia base** (`ms_identity`, `ms_catalog`, `ms_booking`, …). Por eso hay dos tipos de relación:

- **FK física**: dentro de la misma base, con `FOREIGN KEY`.
- **Referencia lógica**: entre bases distintas; se guarda el ID del otro servicio sin `FOREIGN KEY` (marcado en el código como "ID lógico").

**Convenciones de las tablas de atributos**

| Columna | Significado |
|---|---|
| **Clave** | `PK` clave primaria · `FK` clave foránea física · `FL` referencia lógica a otro microservicio · `UQ` único |
| **Nulo** | `No` = `NOT NULL` · `Sí` = admite `NULL` |
| `IDENTITY` | `GENERATED ALWAYS AS IDENTITY` (autoincremental) |

---

## Índice

1. [Dominios (tipos personalizados)](#1-dominios-tipos-personalizados)
2. [ms_identity](#2-ms_identity)
3. [ms_location](#3-ms_location)
4. [ms_catalog](#4-ms_catalog)
5. [ms_pricing](#5-ms_pricing)
6. [ms_inventory](#6-ms_inventory)
7. [ms_coupon](#7-ms_coupon)
8. [ms_cart](#8-ms_cart)
9. [ms_order](#9-ms_order)
10. [ms_payment](#10-ms_payment)
11. [ms_refund](#11-ms_refund)
12. [ms_booking](#12-ms_booking)
13. [ms_billing_profile](#13-ms_billing_profile)
14. [ms_invoicing](#14-ms_invoicing)
15. [ms_review](#15-ms_review)
16. [ms_support](#16-ms_support)
17. [ms_audit](#17-ms_audit)
18. [Tabla común: outbox](#18-tabla-común-outbox)
19. [Relaciones entre tablas](#19-relaciones-entre-tablas)
20. [Resumen de cardinalidades](#20-resumen-de-cardinalidades)

---

## 1. Dominios (tipos personalizados)

| Dominio | Tipo base | Regla |
|---|---|---|
| `dom_correo` | VARCHAR(160) | Formato de correo electrónico |
| `dom_documento` | VARCHAR(20) | Cédula (10 dígitos) o pasaporte (1-2 letras + 6-9 dígitos) |
| `dom_telefono` | VARCHAR(20) | `+` opcional y 7-15 dígitos |
| `dom_ruc` | VARCHAR(13) | 13 dígitos |
| `dom_importe` | NUMERIC(12,2) | ≥ 0 |
| `dom_moneda` | CHAR(3) | 3 letras mayúsculas (ISO 4217, ej. `USD`) |
| `dom_porcentaje` | NUMERIC(5,2) | 0 a 100 |
| `dom_calificacion` | NUMERIC(4,2) | 0 a 10 |

---

## 2. ms_identity

### `rol`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| rol_id | SMALLINT IDENTITY | No | PK | |
| rol_nombre | VARCHAR(30) | No | UQ | ADMIN, OPERADOR, CLIENTE, GUIA |
| rol_descripcion | VARCHAR(200) | No | | |
| rol_activo | BOOLEAN | No | | Default TRUE |

### `usuario`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| usu_id | BIGINT IDENTITY | No | PK | |
| usu_correo | dom_correo | No | UQ | |
| usu_password | VARCHAR(100) | No | | Hash bcrypt |
| usu_nombre | VARCHAR(120) | No | | No vacío |
| usu_apellido | VARCHAR(120) | No | | No vacío |
| usu_documento | dom_documento | Sí | UQ | |
| usu_telefono | dom_telefono | Sí | | |
| usu_verificado | BOOLEAN | No | | Default FALSE |
| usu_activo | BOOLEAN | No | | Default TRUE |
| usu_ultimo_acceso | TIMESTAMPTZ | Sí | | |
| usu_creado_en | TIMESTAMPTZ | No | | Default now() |
| usu_actualizado_en | TIMESTAMPTZ | No | | Default now() |

### `usuario_rol` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| usu_id | BIGINT | No | PK, FK → usuario | ON DELETE CASCADE |
| rol_id | SMALLINT | No | PK, FK → rol | ON DELETE RESTRICT |
| usr_asignado_en | TIMESTAMPTZ | No | | Default now() |
| usr_asignado_por | BIGINT | Sí | FK → usuario | Admin que asignó; ON DELETE SET NULL |

### `sesion`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ses_id | UUID | No | PK | gen_random_uuid() |
| usu_id | BIGINT | No | FK → usuario | ON DELETE CASCADE |
| ses_token_hash | VARCHAR(128) | No | UQ | SHA-256 del token |
| ses_ip | VARCHAR(45) | Sí | | |
| ses_user_agent | VARCHAR(255) | Sí | | |
| ses_expira_en | TIMESTAMPTZ | No | | |
| ses_revocada | BOOLEAN | No | | Default FALSE |
| ses_creado_en | TIMESTAMPTZ | No | | Default now() |

### `token_verificacion`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| tokv_id | BIGINT IDENTITY | No | PK | |
| usu_id | BIGINT | No | FK → usuario | ON DELETE CASCADE |
| tokv_token | VARCHAR(128) | No | UQ | |
| tokv_tipo | VARCHAR(20) | No | | EMAIL, RECUPERACION |
| tokv_expira_en | TIMESTAMPTZ | No | | |
| tokv_usado | BOOLEAN | No | | Default FALSE |
| tokv_creado_en | TIMESTAMPTZ | No | | Default now() |

### `cliente_api`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| cla_id | BIGINT IDENTITY | No | PK | |
| cla_codigo | VARCHAR(60) | No | UQ | ej. BOOKING_PROTOTIPO |
| cla_nombre | VARCHAR(150) | No | | |
| cla_tipo | VARCHAR(10) | No | | SOCIO, TURISTA (default SOCIO) |
| cla_clave_hash | VARCHAR(128) | Sí | UQ | SHA-256 de la X-API-Key; obligatorio si SOCIO, NULL si TURISTA |
| cla_correo | dom_correo | Sí | UQ (TURISTA) | Obligatorio si TURISTA |
| cla_identificacion | VARCHAR(20) | Sí | UQ (TURISTA) | Obligatorio si TURISTA |
| cla_telefono | dom_telefono | Sí | | |
| cla_activo | BOOLEAN | No | | Default TRUE |
| cla_creado_en | TIMESTAMPTZ | No | | Default now() |
| cla_actualizado_en | TIMESTAMPTZ | No | | Trigger de actualización |
| cla_ultimo_uso | TIMESTAMPTZ | Sí | | |

Vista: `v_usuario_roles`. Además tiene la tabla [`outbox`](#18-tabla-común-outbox).

---

## 3. ms_location

### `region`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| reg_id | SMALLINT IDENTITY | No | PK | |
| reg_nombre | VARCHAR(30) | No | UQ | No vacío |
| reg_codigo | CHAR(2) | No | UQ | |

### `provincia`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| prov_id | SMALLINT IDENTITY | No | PK | |
| prov_nombre | VARCHAR(60) | No | UQ | |
| prov_codigo | CHAR(2) | No | UQ | 01-24 |
| reg_id | SMALLINT | No | FK → region | ON DELETE RESTRICT |
| prov_activa | BOOLEAN | No | | Default TRUE |

### `ciudad`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ciu_id | SMALLINT IDENTITY | No | PK | |
| ciu_nombre | VARCHAR(80) | No | UQ (prov_id, ciu_nombre) | |
| ciu_codigo | CHAR(6) | No | UQ | Código INEC |
| prov_id | SMALLINT | No | FK → provincia | ON DELETE RESTRICT |
| ciu_activa | BOOLEAN | No | | Default TRUE |
| ciu_descripcion | VARCHAR(500) | Sí | | |
| ciu_imagen | VARCHAR(500) | Sí | | |

---

## 4. ms_catalog

### `operador`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ope_id | BIGINT IDENTITY | No | PK | |
| ope_codigo | VARCHAR(60) | No | UQ | ProveedorInfo.id del contrato |
| ope_nombre | VARCHAR(150) | No | | |
| ope_ruc | dom_ruc | Sí | UQ | |
| ope_correo | dom_correo | Sí | | |
| ope_telefono | dom_telefono | Sí | | |
| ope_direccion | VARCHAR(255) | Sí | | |
| prov_id | SMALLINT | No | FL → provincia | ms_location |
| ope_activo | BOOLEAN | No | | Default TRUE |
| ope_creado_en | TIMESTAMPTZ | No | | |
| ope_actualizado_en | TIMESTAMPTZ | No | | |

### `operador_usuario` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ope_id | BIGINT | No | PK, FK → operador | ON DELETE CASCADE |
| usu_id | BIGINT | No | PK, FL → usuario | ms_identity |
| opeu_cargo | VARCHAR(60) | No | | ADMIN, VENDEDOR, GUIA |
| opeu_activo | BOOLEAN | No | | Default TRUE |

### `guia`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| gui_id | BIGINT IDENTITY | No | PK | |
| ope_id | BIGINT | No | FK → operador | ON DELETE RESTRICT |
| usu_id | BIGINT | Sí | UQ, FL → usuario | ms_identity |
| gui_codigo | VARCHAR(30) | No | UQ | ej. GUIA-CARLOS-01 |
| gui_nombre | VARCHAR(150) | No | | |
| gui_credencial_mintur | VARCHAR(30) | No | UQ | Credencial del Ministerio de Turismo |
| gui_activo | BOOLEAN | No | | Default TRUE |
| gui_creado_en | TIMESTAMPTZ | No | | |

### `categoria`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| cat_id | INTEGER IDENTITY | No | PK | |
| cat_codigo | VARCHAR(40) | No | UQ | ej. cat-tours-201 |
| cat_padre_id | INTEGER | Sí | FK → categoria | Autorreferencia; no puede ser ella misma |
| cat_nombre | VARCHAR(80) | No | | |
| cat_slug | VARCHAR(80) | No | UQ | |
| cat_descripcion | VARCHAR(255) | Sí | | |
| cat_icono | VARCHAR(40) | No | | Default 'map-pin' |
| cat_orden | SMALLINT | No | | Default 0 |
| cat_incluye_comida | BOOLEAN | No | | |
| cat_incluye_transporte | BOOLEAN | No | | |
| cat_incluye_guia | BOOLEAN | No | | |
| cat_activa | BOOLEAN | No | | Default TRUE |

### `idioma`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| idi_id | SMALLINT IDENTITY | No | PK | |
| idi_codigo | CHAR(2) | No | UQ | ISO 639-1 |
| idi_nombre | VARCHAR(50) | No | | |

### `inclusion`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| inc_id | INTEGER IDENTITY | No | PK | |
| inc_tipo | VARCHAR(20) | No | UQ (inc_tipo, inc_nombre) | INCLUYE, NO_INCLUYE, RECOMENDACION |
| inc_nombre | VARCHAR(150) | No | | |
| inc_orden | SMALLINT | No | | Default 0 |

### `atraccion`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| atr_id | BIGINT IDENTITY | No | PK | |
| atr_codigo | CHAR(12) | No | UQ | Id público del contrato (12 alfanuméricos) |
| atr_uuid | UUID | No | UQ | |
| atr_nombre | VARCHAR(200) | No | | |
| atr_slug | VARCHAR(220) | No | UQ | |
| atr_descripcion | TEXT | No | | |
| atr_descripcion_corta | VARCHAR(280) | Sí | | |
| atr_tipo | VARCHAR(30) | No | | GUIDED_TOUR, ADMISSION, DAY_TRIP, TRANSPORT, PACKAGE |
| atr_estado | VARCHAR(20) | No | | BORRADOR, PUBLICADA, INACTIVA |
| atr_latitud | NUMERIC(10,6) | No | | -90 a 90 |
| atr_longitud | NUMERIC(10,6) | No | | -180 a 180 |
| atr_direccion | VARCHAR(255) | Sí | | |
| atr_punto_encuentro | VARCHAR(255) | Sí | | |
| atr_instrucciones_llegada | VARCHAR(500) | Sí | | |
| atr_duracion_horas | NUMERIC(5,2) | No | | > 0 y ≤ 720 |
| atr_moneda | dom_moneda | No | | Default USD |
| atr_precio_adulto / _nino / _senior / _infante / _estudiante | dom_importe | Sí | | Réplica de ms_pricing |
| ciu_id | SMALLINT | No | FL → ciudad | ms_location |
| ope_id | BIGINT | No | FK → operador | ON DELETE RESTRICT |
| atr_incluye_comida / _transporte / _guia | BOOLEAN | No | | Banderas de inclusión |
| atr_accesible_silla_ruedas / _carriola | BOOLEAN | No | | Accesibilidad |
| atr_admite_animales_asistencia | BOOLEAN | No | | Accesibilidad |
| atr_cancelacion_gratuita | BOOLEAN | No | | |
| atr_horas_cancelacion | SMALLINT | No | | Default 24, ≥ 0 |
| atr_politica_cancelacion | VARCHAR(500) | Sí | | |
| atr_permite_paquete | BOOLEAN | No | | |
| atr_porcentaje_descuento_paquete | dom_porcentaje | No | | 0 si no permite paquete |
| atr_destacada | BOOLEAN | No | | |
| atr_calificacion_promedio | dom_calificacion | No | | Réplica de ms_review |
| atr_calif_limpieza / _servicio / _calidad_precio / _puntualidad | dom_calificacion | No | | Réplica de ms_review |
| atr_numero_resenas | INTEGER | No | | ≥ 0 |
| atr_creado_en / atr_actualizado_en | TIMESTAMPTZ | No | | |
| atr_eliminado_en | TIMESTAMPTZ | Sí | | Borrado lógico |

### `atraccion_categoria` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| atr_id | BIGINT | No | PK, FK → atraccion | ON DELETE CASCADE |
| cat_id | INTEGER | No | PK, FK → categoria | ON DELETE CASCADE |

### `atraccion_idioma` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| atr_id | BIGINT | No | PK, FK → atraccion | ON DELETE CASCADE |
| idi_id | SMALLINT | No | PK, FK → idioma | ON DELETE RESTRICT |

### `atraccion_inclusion` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| atr_id | BIGINT | No | PK, FK → atraccion | ON DELETE CASCADE |
| inc_id | INTEGER | No | PK, FK → inclusion | ON DELETE CASCADE |

### `atraccion_foto`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| fot_id | BIGINT IDENTITY | No | PK | |
| atr_id | BIGINT | No | FK → atraccion | ON DELETE CASCADE |
| fot_url | VARCHAR(500) | No | | |
| fot_alt | VARCHAR(200) | No | | Texto alternativo (WCAG) |
| fot_orden | SMALLINT | No | | Default 0 |

### `atraccion_itinerario`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| iti_id | BIGINT IDENTITY | No | PK | |
| atr_id | BIGINT | No | FK → atraccion, UQ (atr_id, iti_numero_parada) | ON DELETE CASCADE |
| iti_numero_parada | SMALLINT | No | | > 0 |
| iti_hora | TIME | No | | |
| iti_titulo | VARCHAR(200) | No | | |
| iti_descripcion | VARCHAR(500) | Sí | | |
| iti_duracion_minutos | SMALLINT | No | | > 0 |
| iti_nombre_ubicacion | VARCHAR(200) | Sí | | |

Vista: `v_atraccion_completa`.

---

## 5. ms_pricing

### `tarifa`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| tar_id | BIGINT IDENTITY | No | PK | tariff_id |
| atr_codigo | CHAR(12) | No | FL → atraccion.atr_codigo | ms_catalog |
| tar_tipo | VARCHAR(20) | No | | ADULT, CHILD, SENIOR, INFANT, STUDENT |
| tar_precio | dom_importe | No | | |
| tar_moneda | dom_moneda | No | | Default USD |
| tar_vigente_desde | DATE | No | UQ (atr_codigo, tar_tipo, tar_vigente_desde) | Default hoy |
| tar_vigente_hasta | DATE | Sí | | NULL = sin fin |

Restricción `EXCLUDE`: no se solapan vigencias de la misma atracción y tipo. Además tiene [`outbox`](#18-tabla-común-outbox).

---

## 6. ms_inventory

### `horario`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| hor_id | BIGINT IDENTITY | No | PK, UQ (hor_id, atr_codigo) | |
| atr_codigo | CHAR(12) | No | FL → atraccion.atr_codigo, UQ (atr_codigo, hor_hora) | ms_catalog |
| hor_hora | TIME | No | | |
| hor_cupo | INTEGER | No | | Default 20, > 0 |
| hor_activo | BOOLEAN | No | | Default TRUE |
| gui_id | BIGINT | Sí | FL → guia | ms_catalog |

### `disponibilidad`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| dis_id | BIGINT IDENTITY | No | PK | |
| atr_codigo | CHAR(12) | No | FK compuesta → horario (hor_id, atr_codigo) | El horario debe ser de la misma atracción |
| hor_id | BIGINT | No | FK compuesta → horario | ON DELETE CASCADE |
| dis_fecha | DATE | No | UQ (atr_codigo, dis_fecha, hor_id) | |
| dis_slot_codigo | VARCHAR(40) | No | UQ (atr_codigo, dis_slot_codigo) | `slot-AAAAMMDD-HHMM` |
| dis_cupo_total | INTEGER | No | | > 0 |
| dis_cupo_reservado | INTEGER | No | | 0 ≤ reservado ≤ total |
| dis_cerrada | BOOLEAN | No | | Default FALSE |
| gui_id | BIGINT | Sí | FL → guia | ms_catalog |

### `fecha_bloqueada`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| fb_id | BIGINT IDENTITY | No | PK | |
| atr_codigo | CHAR(12) | No | FL → atraccion.atr_codigo, UQ (atr_codigo, fb_fecha) | ms_catalog |
| fb_fecha | DATE | No | | |
| fb_motivo | VARCHAR(200) | No | | |
| fb_creado_en | TIMESTAMPTZ | No | | |

### `bloqueo_cupo`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| blo_id | BIGINT IDENTITY | No | PK | |
| dis_id | BIGINT | No | FK → disponibilidad | ON DELETE RESTRICT |
| blo_clave | VARCHAR(120) | No | UQ | Clave de idempotencia del bloqueo |
| blo_cantidad | INTEGER | No | | > 0 |
| blo_creado_en | TIMESTAMPTZ | No | | |
| blo_liberado_en | TIMESTAMPTZ | Sí | | |

Además tiene [`outbox`](#18-tabla-común-outbox) (con columna extra `proximo_en`).

---

## 7. ms_coupon

### `cupon`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| cup_id | BIGINT IDENTITY | No | PK | |
| cup_codigo | VARCHAR(30) | No | UQ | `[A-Z0-9_-]{3,30}` |
| cup_tipo | VARCHAR(20) | No | | PORCENTAJE, FIJO |
| cup_valor | dom_importe | No | | ≤ 100 si es PORCENTAJE |
| cup_fecha_inicio | DATE | No | | |
| cup_fecha_fin | DATE | Sí | | ≥ inicio; NULL = sin fin |
| cup_usos_max | INTEGER | Sí | | > 0; NULL = sin límite |
| cup_activo | BOOLEAN | No | | Default TRUE |

### `acuerdo_promocion`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| apr_id | SMALLINT IDENTITY | No | PK | |
| apr_proveedor_codigo | VARCHAR(60) | No | UQ | proveedor_id |
| apr_nombre_comercial | VARCHAR(150) | Sí | | |
| apr_permite_promociones | BOOLEAN | No | | |
| apr_porcentaje_descuento_max | NUMERIC(5,2) | No | | 0 a 50 |
| apr_fecha_acuerdo | DATE | No | | Default hoy |
| apr_vigencia_hasta | DATE | No | | ≥ fecha_acuerdo |
| apr_condiciones_combo | VARCHAR(500) | Sí | | |
| apr_contacto_nombre | VARCHAR(120) | Sí | | |
| apr_contacto_correo | dom_correo | Sí | | |
| apr_contacto_telefono | dom_telefono | Sí | | |
| apr_actualizado_en | TIMESTAMPTZ | No | | |

### `acuerdo_promocion_destino` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| apr_id | SMALLINT | No | PK, FK → acuerdo_promocion | ON DELETE CASCADE |
| ciu_id | SMALLINT | No | PK, FL → ciudad | ms_location |

---

## 8. ms_cart

### `carrito`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| car_id | BIGINT IDENTITY | No | PK | |
| usu_id | BIGINT | No | FL → usuario | Un solo carrito activo por usuario (índice único parcial) |
| car_activo | BOOLEAN | No | | Default TRUE |
| car_creado_en / car_actualizado_en | TIMESTAMPTZ | No | | |

### `carrito_item`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| cai_id | BIGINT IDENTITY | No | PK | |
| car_id | BIGINT | No | FK → carrito | ON DELETE CASCADE |
| atr_codigo | CHAR(12) | No | FL → atraccion.atr_codigo | ms_catalog |
| dis_slot_codigo | VARCHAR(40) | Sí | FL → disponibilidad.dis_slot_codigo | ms_inventory |
| cai_adultos | INTEGER | No | | Default 1, ≥ 1 |
| cai_ninos / cai_seniors / cai_estudiantes / cai_infantes | INTEGER | No | | Default 0, ≥ 0 |
| cai_estado | VARCHAR(10) | No | | PENDIENTE, EN_PAGO, COMPRADO |
| cai_ord_numero | VARCHAR(20) | Sí | UQ, FL → orden.ord_numero | ms_order |
| cai_orden_clave | UUID | Sí | | Idempotency-Key de la compra |
| cai_en_pago_desde | TIMESTAMPTZ | Sí | | |
| cai_comprado_en | TIMESTAMPTZ | Sí | | |
| cai_creado_en | TIMESTAMPTZ | No | | |

Los campos de compra deben ser coherentes con `cai_estado` (CHECK `carrito_item_compra_coherente`).

---

## 9. ms_order

### `estado`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| est_id | SMALLINT IDENTITY | No | PK | |
| est_codigo | VARCHAR(20) | No | UQ | |
| est_nombre | VARCHAR(50) | No | | |
| est_final | BOOLEAN | No | | Default FALSE |

> `ms_payment`, `ms_booking` y `ms_invoicing` tienen su propia tabla `estado` con esta misma estructura.

### `orden`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ord_id | BIGINT IDENTITY | No | PK | |
| ord_numero | VARCHAR(20) | No | UQ | external_order_id |
| usu_id | BIGINT | Sí | FL → usuario | Compra web |
| cla_id | BIGINT | Sí | FL → cliente_api | Canal B2B. Exactamente uno de usu_id / cla_id |
| cai_id | BIGINT | Sí | UQ, FL → carrito_item | NULL = compra directa |
| est_id | SMALLINT | No | FK → estado | ON DELETE RESTRICT |
| mpa_id | SMALLINT | Sí | FL → metodo_pago | ms_payment |
| ord_fecha | TIMESTAMPTZ | No | | |
| ord_subtotal / ord_descuento / ord_iva / ord_total | dom_importe | No | | total = subtotal − descuento + iva |
| ord_moneda | dom_moneda | No | | Default USD |
| ord_observaciones | VARCHAR(500) | Sí | | |
| ord_creado_en / ord_actualizado_en | TIMESTAMPTZ | No | | |

### `orden_detalle`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| det_id | BIGINT IDENTITY | No | PK | |
| ord_id | BIGINT | No | FK → orden | ON DELETE CASCADE |
| atr_id | BIGINT | No | FL → atraccion | ms_catalog |
| det_descripcion | VARCHAR(255) | No | | Snapshot del nombre |
| det_cantidad | INTEGER | No | | > 0 |
| det_precio_unitario | dom_importe | No | | Snapshot del precio |
| det_subtotal | dom_importe | No | | = cantidad × precio |

### `orden_cupon` (tabla intermedia N:M)
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ord_id | BIGINT | No | PK, FK → orden | ON DELETE CASCADE |
| cup_id | BIGINT | No | PK, FL → cupon | ms_coupon |
| orc_usado_en | TIMESTAMPTZ | No | | |

### `idempotencia`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| idem_clave | UUID | No | PK | Cabecera Idempotency-Key |
| idem_sujeto_tipo | VARCHAR(12) | No | PK | USUARIO, CLIENTE_API |
| idem_sujeto | BIGINT | No | PK, FL → usuario / cliente_api | |
| idem_operacion | VARCHAR(150) | No | | |
| idem_request_hash | VARCHAR(64) | No | | |
| idem_estado | VARCHAR(12) | No | | IN_PROGRESS, DONE, FAILED |
| idem_response | JSONB | Sí | | |
| idem_expira_en | TIMESTAMPTZ | No | | 24 h |
| idem_creado_en | TIMESTAMPTZ | No | | |

> `ms_booking` tiene una tabla `idempotencia` idéntica.

Vista: `v_orden_financiero`. Además tiene [`outbox`](#18-tabla-común-outbox).

---

## 10. ms_payment

### `metodo_pago`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| mpa_id | SMALLINT IDENTITY | No | PK | |
| mpa_codigo | VARCHAR(20) | No | UQ | CREDIT_CARD, DEBIT_CARD, PAYPAL, TRANSFER |
| mpa_nombre | VARCHAR(60) | No | | |
| mpa_requiere_datos | BOOLEAN | No | | |
| mpa_activo | BOOLEAN | No | | |

### `estado`
Misma estructura que [`estado` de ms_order](#estado).

### `pago`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| pag_id | BIGINT IDENTITY | No | PK | |
| pag_numero | VARCHAR(30) | No | UQ | |
| ord_id | BIGINT | No | FL → orden | Un solo pago aprobado por orden (índice único parcial) |
| mpa_id | SMALLINT | No | FK → metodo_pago | ON DELETE RESTRICT |
| est_id | SMALLINT | No | FK → estado | ON DELETE RESTRICT |
| pag_monto | dom_importe | No | | > 0 |
| pag_referencia | VARCHAR(100) | Sí | | Id de la pasarela |
| pag_autorizacion | VARCHAR(100) | Sí | | |
| pag_fecha | TIMESTAMPTZ | No | | |
| pag_aprobado_en | TIMESTAMPTZ | Sí | | No puede coexistir con rechazado |
| pag_rechazado_en | TIMESTAMPTZ | Sí | | |
| pag_motivo_rechazo | VARCHAR(300) | Sí | | Solo si rechazado |
| pag_creado_en | TIMESTAMPTZ | No | | |

### `pago_tarjeta`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| pat_id | BIGINT IDENTITY | No | PK | |
| pag_id | BIGINT | No | UQ, FK → pago | 1:1; ON DELETE CASCADE |
| pat_marca | VARCHAR(20) | No | | VISA, MASTERCARD, AMEX |
| pat_ultimos4 | CHAR(4) | No | | 4 dígitos |
| pat_titular | VARCHAR(120) | No | | |
| pat_mes | SMALLINT | No | | 1-12 |
| pat_anio | SMALLINT | No | | 2020-2100 |
| pat_pais | CHAR(2) | No | | |

### `pago_transferencia`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ptr_id | BIGINT IDENTITY | No | PK | |
| pag_id | BIGINT | No | UQ, FK → pago | 1:1; ON DELETE CASCADE |
| ptr_banco | VARCHAR(60) | No | | |
| ptr_numero_comprobante | VARCHAR(40) | No | | |
| ptr_fecha_transferencia | DATE | No | | |
| ptr_archivo_adjunto | VARCHAR(500) | Sí | | |

Además tiene [`outbox`](#18-tabla-común-outbox).

---

## 11. ms_refund

### `reembolso`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| rem_id | BIGINT IDENTITY | No | PK | |
| pag_id | BIGINT | No | FL → pago | ms_payment |
| rem_numero | VARCHAR(30) | No | UQ | reembolso_id |
| rem_monto | dom_importe | No | | > 0 |
| rem_motivo | VARCHAR(300) | Sí | | |
| rem_referencia | VARCHAR(100) | Sí | | Id en la pasarela |
| rem_clave_idempotencia | UUID | No | UQ | |
| rem_solicitado_en | TIMESTAMPTZ | No | | |
| rem_procesado_en | TIMESTAMPTZ | Sí | | |
| rem_creado_en | TIMESTAMPTZ | No | | |

Además tiene [`outbox`](#18-tabla-común-outbox).

---

## 12. ms_booking

### `estado`
Misma estructura que [`estado` de ms_order](#estado).

### `reserva`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| res_id | BIGINT IDENTITY | No | PK | |
| res_uuid | UUID | No | UQ | reservation_id |
| res_codigo | VARCHAR(12) | No | UQ | PNR, ej. DEC-7F3K9Q |
| ord_numero | VARCHAR(20) | No | UQ, FL → orden.ord_numero | ms_order |
| det_id | BIGINT | No | FL → orden_detalle | ms_order |
| dis_id | BIGINT | No | FL → disponibilidad | ms_inventory |
| est_id | SMALLINT | No | FK → estado | ON DELETE RESTRICT |
| gui_id | BIGINT | Sí | FL → guia | ms_catalog |
| cla_id_cliente | BIGINT | Sí | FL → cliente_api (TURISTA) | NULL en compras web |
| res_canal | VARCHAR(10) | No | | WEB, SOCIO |
| res_saga_id | VARCHAR(40) | Sí | | Saga de Booking |
| res_adultos | INTEGER | No | | ≥ 1 |
| res_ninos / res_seniors / res_estudiantes / res_infantes | INTEGER | No | | ≥ 0 |
| res_numero_tickets | INTEGER | No | | = suma de pasajeros |
| res_precio_total | dom_importe | No | | Snapshot |
| res_requerimientos | VARCHAR(500) | Sí | | |
| res_voucher_qr | TEXT | Sí | | Payload firmado |
| res_motivo_cancelacion | VARCHAR(255) | Sí | | |
| res_cancelado_por | VARCHAR(20) | Sí | | CLIENTE, SAGA_ORCHESTRATOR, ADMIN |
| res_cancelado_en | TIMESTAMPTZ | Sí | | Junto con cancelado_por |
| res_reembolso_id | VARCHAR(30) | Sí | FL → reembolso.rem_numero | ms_refund |
| res_monto_reembolsado | dom_importe | Sí | | Junto con reembolso_id |
| res_checkin_en | TIMESTAMPTZ | Sí | | No puede haber check-in y cancelación |
| res_checkin_documento | VARCHAR(20) | Sí | | Obligatorio si hay check-in |
| res_checkin_guia_codigo | VARCHAR(30) | Sí | | |
| res_checkin_dispositivo | VARCHAR(60) | Sí | | |
| res_confirmado_en | TIMESTAMPTZ | Sí | | |
| res_creado_en / res_actualizado_en | TIMESTAMPTZ | No | | |

### `reserva_pasajero`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| pax_id | BIGINT IDENTITY | No | PK | |
| res_id | BIGINT | No | FK → reserva | ON DELETE CASCADE; un solo titular por reserva |
| pax_nombre | VARCHAR(120) | No | | |
| pax_tipo_documento | VARCHAR(10) | Sí | | CEDULA, PASAPORTE, RUC |
| pax_documento | VARCHAR(20) | Sí | | Formato según tipo |
| pax_correo | dom_correo | Sí | | |
| pax_telefono | dom_telefono | Sí | | |
| pax_tipo_boleto | VARCHAR(10) | No | | ADULT, CHILD, SENIOR, INFANT, STUDENT |
| pax_fecha_nacimiento | DATE | Sí | | |
| pax_es_titular | BOOLEAN | No | | El titular exige documento, correo y teléfono |

### `notificacion_checkin`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| res_id | BIGINT | No | PK, FK → reserva | 1:1; ON DELETE CASCADE |
| nch_payload | JSONB | No | | Cuerpo del aviso de check-in |
| nch_intentos | INTEGER | No | | ≥ 0 |
| nch_ultimo_error | VARCHAR(500) | Sí | | |
| nch_proximo_en | TIMESTAMPTZ | No | | |
| nch_enviado_en | TIMESTAMPTZ | Sí | | |
| nch_correlation_id | VARCHAR(100) | Sí | | |
| nch_creado_en | TIMESTAMPTZ | No | | |

### `idempotencia`
Misma estructura que [`idempotencia` de ms_order](#idempotencia).

### `outbox_evento`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| evt_id | BIGINT IDENTITY | No | PK | sequence_number |
| evt_uuid | UUID | No | UQ | event_id |
| evt_specversion | VARCHAR(5) | No | | Default '1.0' |
| evt_fuente | VARCHAR(120) | No | | Default '/api/v3/atracciones' |
| evt_tipo | VARCHAR(30) | No | | RESERVA_CREADA, RESERVA_CONFIRMADA, STOCK_ACTUALIZADO, RESERVA_CANCELADA |
| evt_aggregate_id | VARCHAR(64) | No | | |
| evt_correlation_id | VARCHAR(64) | No | | |
| evt_payload | JSONB | No | | |
| evt_creado_en | TIMESTAMPTZ | No | | |
| evt_publicado_en | TIMESTAMPTZ | Sí | | |

---

## 13. ms_billing_profile

### `dato_facturacion`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| dfa_id | BIGINT IDENTITY | No | PK | |
| usu_id | BIGINT | Sí | FL → usuario | Exactamente uno de usu_id / cla_id |
| cla_id | BIGINT | Sí | FL → cliente_api (TURISTA) | |
| dfa_tipo_identificacion | VARCHAR(20) | No | UQ con titular + identificación | CEDULA, RUC, PASAPORTE, CONSUMIDOR_FINAL |
| dfa_identificacion | VARCHAR(20) | No | | Formato según tipo |
| dfa_razon_social | VARCHAR(150) | No | | |
| dfa_correo | dom_correo | No | | |
| dfa_telefono | dom_telefono | Sí | | |
| dfa_es_principal | BOOLEAN | No | | Uno principal por titular |
| dfa_activo | BOOLEAN | No | | Borrado lógico |
| dfa_creado_en | TIMESTAMPTZ | No | | |

---

## 14. ms_invoicing

### `estado`
Misma estructura que [`estado` de ms_order](#estado).

### `factura`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| fac_id | BIGINT IDENTITY | No | PK | |
| ord_id | BIGINT | No | UQ, FL → orden | Una factura por orden |
| dfa_id | BIGINT | Sí | FL → dato_facturacion | ms_billing_profile |
| fac_numero | VARCHAR(20) | No | UQ | |
| fac_clave_acceso | VARCHAR(49) | Sí | | Clave de acceso SRI |
| fac_autorizacion_sri | VARCHAR(49) | Sí | | Obligatoria si AUTORIZADA |
| fac_estado_sri | VARCHAR(15) | No | | PENDIENTE, AUTORIZADA, RECHAZADA |
| fac_intentos | SMALLINT | No | | ≥ 0 |
| fac_proximo_intento_en | TIMESTAMPTZ | No | | Cola de reintentos SRI |
| fac_mensaje_sri | VARCHAR(500) | Sí | | |
| est_id | SMALLINT | No | FK → estado | ON DELETE RESTRICT |
| fac_emitida_en | TIMESTAMPTZ | No | | |
| fac_subtotal / fac_descuento / fac_iva / fac_total | dom_importe | No | | total = subtotal − descuento + iva |
| fac_tipo_identificacion | VARCHAR(20) | No | | Snapshot del comprador |
| fac_identificacion | VARCHAR(20) | No | | Snapshot |
| fac_razon_social | VARCHAR(150) | No | | Snapshot |
| fac_correo | dom_correo | No | | Snapshot |
| fac_telefono | dom_telefono | Sí | | Snapshot |

### `factura_detalle`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| fde_id | BIGINT IDENTITY | No | PK | |
| fac_id | BIGINT | No | FK → factura | ON DELETE CASCADE |
| det_id | BIGINT | No | UQ, FL → orden_detalle | Una línea se factura una vez |
| fde_codigo | VARCHAR(25) | No | | Código SRI |
| fde_descripcion | VARCHAR(300) | No | | |
| fde_cantidad | INTEGER | No | | > 0 |
| fde_precio_unitario | dom_importe | No | | |
| fde_descuento | dom_importe | No | | |
| fde_subtotal | dom_importe | No | | = cantidad × precio − descuento |
| fde_iva_porcentaje | dom_porcentaje | No | | |
| fde_iva | dom_importe | No | | |
| fde_total | dom_importe | No | | = subtotal + iva |

Además tiene [`outbox`](#18-tabla-común-outbox).

---

## 15. ms_review

### `resena`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| ren_id | BIGINT IDENTITY | No | PK | |
| atr_id | BIGINT | No | FL → atraccion, UQ (atr_id, usu_id) | Una reseña por usuario y atracción |
| usu_id | BIGINT | Sí | FL → usuario | NULL = anónima |
| ren_autor_nombre | VARCHAR(120) | Sí | | Solo si es anónima |
| ren_puntuacion | SMALLINT | No | | 1-10 |
| ren_limpieza / ren_servicio / ren_calidad_precio / ren_puntualidad | SMALLINT | No | | 1-10 |
| ren_comentario | VARCHAR(1000) | No | | |
| ren_visible | BOOLEAN | No | | Default TRUE |
| ren_creado_en | TIMESTAMPTZ | No | | |

Además tiene [`outbox`](#18-tabla-común-outbox).

---

## 16. ms_support

### `mensaje_contacto`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| men_id | BIGINT IDENTITY | No | PK | |
| men_nombre | VARCHAR(120) | No | | |
| men_correo | dom_correo | No | | |
| men_asunto | VARCHAR(30) | No | | |
| men_cuerpo | VARCHAR(2000) | No | | |
| men_leido | BOOLEAN | No | | Default FALSE |
| men_creado_en | TIMESTAMPTZ | No | | |

Tabla independiente, sin relaciones.

---

## 17. ms_audit

### `bitacora`
| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| bit_id | BIGINT IDENTITY | No | PK | |
| bit_event_id | UUID | No | UQ | Id del evento del bus |
| usu_id | BIGINT | Sí | FL → usuario | NULL = anónimo |
| bit_accion | VARCHAR(60) | No | | |
| bit_entidad | VARCHAR(60) | No | | |
| bit_entidad_id | VARCHAR(64) | Sí | | |
| bit_correlation_id | VARCHAR(64) | Sí | | X-Correlation-Id |
| bit_detalle | JSONB | Sí | | |
| bit_ip | VARCHAR(45) | Sí | | |
| bit_creado_en | TIMESTAMPTZ | No | | |

---

## 18. Tabla común: `outbox`

Presente en **ms_identity, ms_inventory, ms_pricing, ms_order, ms_payment, ms_refund, ms_invoicing y ms_review** (patrón Transactional Outbox para publicar eventos en RabbitMQ). ms_booking usa su propia `outbox_evento`.

| Atributo | Tipo | Nulo | Clave | Notas |
|---|---|---|---|---|
| id | UUID | No | PK | |
| event_id | UUID | No | UQ | |
| tipo_evento | VARCHAR(60) | No | | |
| agregado_id | VARCHAR(60) | No | | |
| payload | JSONB | No | | |
| correlation_id | VARCHAR(100) | No | | |
| creado_en | TIMESTAMPTZ | No | | |
| publicado_en | TIMESTAMPTZ | Sí | | NULL = pendiente |
| intentos | INT | No | | ≥ 0 |
| ultimo_error | VARCHAR(500) | Sí | | |
| proximo_en | TIMESTAMPTZ | Sí | | Solo en ms_inventory |

---

## 19. Relaciones entre tablas

**Tipos de cardinalidad usados**

| Notación | Significado |
|---|---|
| 1 : 1 | A cada fila le corresponde como máximo una fila del otro lado (FK con `UNIQUE` o PK = FK) |
| 1 : N | Una fila del lado "1" tiene muchas del lado "N" |
| N : M | Muchos a muchos, resuelto con una tabla intermedia |
| 1 : N (recursiva) | La tabla se relaciona consigo misma |

### 19.1 Relaciones físicas (dentro de la misma base)

| # | Base | Tabla origen (1) | Tabla destino | Cardinalidad | Columna(s) | Tabla intermedia | Al borrar |
|---|---|---|---|---|---|---|---|
| 1 | ms_identity | usuario | rol | **N : M** | usu_id, rol_id | usuario_rol | CASCADE / RESTRICT |
| 2 | ms_identity | usuario (asignador) | usuario_rol | 1 : N | usr_asignado_por | — | SET NULL |
| 3 | ms_identity | usuario | sesion | 1 : N | usu_id | — | CASCADE |
| 4 | ms_identity | usuario | token_verificacion | 1 : N | usu_id | — | CASCADE |
| 5 | ms_location | region | provincia | 1 : N | reg_id | — | RESTRICT |
| 6 | ms_location | provincia | ciudad | 1 : N | prov_id | — | RESTRICT |
| 7 | ms_catalog | operador | guia | 1 : N | ope_id | — | RESTRICT |
| 8 | ms_catalog | operador | atraccion | 1 : N | ope_id | — | RESTRICT |
| 9 | ms_catalog | categoria | categoria | 1 : N (recursiva) | cat_padre_id | — | RESTRICT |
| 10 | ms_catalog | atraccion | categoria | **N : M** | atr_id, cat_id | atraccion_categoria | CASCADE |
| 11 | ms_catalog | atraccion | idioma | **N : M** | atr_id, idi_id | atraccion_idioma | CASCADE / RESTRICT |
| 12 | ms_catalog | atraccion | inclusion | **N : M** | atr_id, inc_id | atraccion_inclusion | CASCADE |
| 13 | ms_catalog | atraccion | atraccion_foto | 1 : N | atr_id | — | CASCADE |
| 14 | ms_catalog | atraccion | atraccion_itinerario | 1 : N | atr_id | — | CASCADE |
| 15 | ms_inventory | horario | disponibilidad | 1 : N | (hor_id, atr_codigo) FK compuesta | — | CASCADE |
| 16 | ms_inventory | disponibilidad | bloqueo_cupo | 1 : N | dis_id | — | RESTRICT |
| 17 | ms_coupon | acuerdo_promocion | acuerdo_promocion_destino | 1 : N | apr_id | — | CASCADE |
| 18 | ms_cart | carrito | carrito_item | 1 : N | car_id | — | CASCADE |
| 19 | ms_order | estado | orden | 1 : N | est_id | — | RESTRICT |
| 20 | ms_order | orden | orden_detalle | 1 : N | ord_id | — | CASCADE |
| 21 | ms_order | orden | orden_cupon | 1 : N | ord_id | — | CASCADE |
| 22 | ms_payment | metodo_pago | pago | 1 : N | mpa_id | — | RESTRICT |
| 23 | ms_payment | estado | pago | 1 : N | est_id | — | RESTRICT |
| 24 | ms_payment | pago | pago_tarjeta | **1 : 1** (0..1) | pag_id UNIQUE | — | CASCADE |
| 25 | ms_payment | pago | pago_transferencia | **1 : 1** (0..1) | pag_id UNIQUE | — | CASCADE |
| 26 | ms_booking | estado | reserva | 1 : N | est_id | — | RESTRICT |
| 27 | ms_booking | reserva | reserva_pasajero | 1 : N (un solo titular) | res_id | — | CASCADE |
| 28 | ms_booking | reserva | notificacion_checkin | **1 : 1** (0..1) | res_id (PK = FK) | — | CASCADE |
| 29 | ms_invoicing | estado | factura | 1 : N | est_id | — | RESTRICT |
| 30 | ms_invoicing | factura | factura_detalle | 1 : N | fac_id | — | CASCADE |

### 19.2 Relaciones lógicas (entre microservicios)

| # | Tabla origen (1) — servicio | Tabla destino — servicio | Cardinalidad | Columna en destino | Observación |
|---|---|---|---|---|---|
| 31 | usuario — identity | operador — catalog | **N : M** | operador_usuario.usu_id | Tabla intermedia operador_usuario |
| 32 | usuario — identity | guia — catalog | **1 : 1** (0..1) | guia.usu_id UNIQUE | Un usuario es a lo sumo un guía |
| 33 | provincia — location | operador — catalog | 1 : N | operador.prov_id | |
| 34 | ciudad — location | atraccion — catalog | 1 : N | atraccion.ciu_id | |
| 35 | ciudad — location | acuerdo_promocion — coupon | **N : M** | acuerdo_promocion_destino.ciu_id | Tabla intermedia acuerdo_promocion_destino |
| 36 | atraccion — catalog | tarifa — pricing | 1 : N | tarifa.atr_codigo | Una tarifa por tipo de boleto y vigencia |
| 37 | atraccion — catalog | horario — inventory | 1 : N | horario.atr_codigo | |
| 38 | atraccion — catalog | disponibilidad — inventory | 1 : N | disponibilidad.atr_codigo | |
| 39 | atraccion — catalog | fecha_bloqueada — inventory | 1 : N | fecha_bloqueada.atr_codigo | |
| 40 | guia — catalog | horario — inventory | 1 : N | horario.gui_id | Opcional |
| 41 | guia — catalog | disponibilidad — inventory | 1 : N | disponibilidad.gui_id | Opcional |
| 42 | usuario — identity | carrito — cart | 1 : N (1 activo) | carrito.usu_id | Índice único parcial: un carrito activo |
| 43 | atraccion — catalog | carrito_item — cart | 1 : N | carrito_item.atr_codigo | |
| 44 | disponibilidad — inventory | carrito_item — cart | 1 : N | carrito_item.dis_slot_codigo | Opcional |
| 45 | carrito_item — cart | orden — order | **1 : 1** (0..1) | orden.cai_id UNIQUE / carrito_item.cai_ord_numero UNIQUE | Un ítem genera una orden |
| 46 | usuario — identity | orden — order | 1 : N | orden.usu_id | Compra web |
| 47 | cliente_api — identity | orden — order | 1 : N | orden.cla_id | Compra B2B; excluyente con usu_id |
| 48 | metodo_pago — payment | orden — order | 1 : N | orden.mpa_id | |
| 49 | atraccion — catalog | orden_detalle — order | 1 : N | orden_detalle.atr_id | |
| 50 | orden — order | cupon — coupon | **N : M** | orden_cupon.cup_id | Tabla intermedia orden_cupon |
| 51 | orden — order | pago — payment | 1 : N | pago.ord_id | Varios intentos, un solo pago aprobado |
| 52 | pago — payment | reembolso — refund | 1 : N | reembolso.pag_id | |
| 53 | orden — order | reserva — booking | **1 : 1** (0..1) | reserva.ord_numero UNIQUE | |
| 54 | orden_detalle — order | reserva — booking | 1 : N | reserva.det_id | |
| 55 | disponibilidad — inventory | reserva — booking | 1 : N | reserva.dis_id | |
| 56 | guia — catalog | reserva — booking | 1 : N | reserva.gui_id | Opcional |
| 57 | cliente_api — identity | reserva — booking | 1 : N | reserva.cla_id_cliente | Solo TURISTA |
| 58 | reembolso — refund | reserva — booking | **1 : 1** (0..1) | reserva.res_reembolso_id | |
| 59 | usuario — identity | dato_facturacion — billing_profile | 1 : N | dato_facturacion.usu_id | Uno principal |
| 60 | cliente_api — identity | dato_facturacion — billing_profile | 1 : N | dato_facturacion.cla_id | Excluyente con usu_id |
| 61 | orden — order | factura — invoicing | **1 : 1** (0..1) | factura.ord_id UNIQUE | |
| 62 | dato_facturacion — billing_profile | factura — invoicing | 1 : N | factura.dfa_id | |
| 63 | orden_detalle — order | factura_detalle — invoicing | **1 : 1** (0..1) | factura_detalle.det_id UNIQUE | |
| 64 | usuario — identity | atraccion — catalog | **N : M** | resena (usu_id, atr_id) | Tabla intermedia resena (con datos propios) |
| 65 | atraccion — catalog | resena — review | 1 : N | resena.atr_id | |
| 66 | usuario — identity | resena — review | 1 : N | resena.usu_id | Una por atracción |
| 67 | usuario — identity | bitacora — audit | 1 : N | bitacora.usu_id | |
| 68 | usuario / cliente_api — identity | idempotencia — order, booking | 1 : N | idempotencia.idem_sujeto | Según idem_sujeto_tipo |

---

## 20. Resumen de cardinalidades

| Cardinalidad | Relaciones |
|---|---|
| **N : M** | usuario ↔ rol (usuario_rol) · atraccion ↔ categoria (atraccion_categoria) · atraccion ↔ idioma (atraccion_idioma) · atraccion ↔ inclusion (atraccion_inclusion) · operador ↔ usuario (operador_usuario) · acuerdo_promocion ↔ ciudad (acuerdo_promocion_destino) · orden ↔ cupon (orden_cupon) · usuario ↔ atraccion (resena) |
| **1 : 1** | pago – pago_tarjeta · pago – pago_transferencia · reserva – notificacion_checkin · usuario – guia · carrito_item – orden · orden – reserva · orden – factura · orden_detalle – factura_detalle · reembolso – reserva |
| **1 : N recursiva** | categoria – categoria (subcategorías) |
| **1 : N** | Todas las demás de las tablas 19.1 y 19.2 |
| **Sin relaciones** | mensaje_contacto · outbox · outbox_evento |
