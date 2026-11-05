-- ============================================================================
--  TOURGIRLS  ·  BASES DE DATOS POR MICROSERVICIO (v2 + contrato OpenAPI v3)
--  Basado en: Plan/microservicios_tablas_v2.html  (16 microservicios)
--  Origen de columnas y reglas: Plan/Script Base de dats.txt (v1.3, 3FN)
--  Contrato: Plan/PlanBooking/atracciones-openapi-v3(1).yaml (v3.0.0)
--  Motor: PostgreSQL 14+   |   Codificacion: UTF-8
-- ============================================================================
--
--  REGLAS DE ESTE SCRIPT
--  ---------------------------------------------------------------------------
--  1. Cada microservicio tiene SU PROPIA base de datos (database-per-service).
--  2. Solo hay FOREIGN KEY entre tablas del MISMO microservicio.
--  3. Las referencias a tablas de OTRO servicio se guardan como ID logico:
--     la columna existe (con su indice) pero SIN FOREIGN KEY. Se valida por
--     API (REST/gRPC/SOAP) o por eventos.
--  4. "estado" ya no es un catalogo unico con est_grupo: Order, Booking,
--     Payment e Invoicing tienen cada uno su propia tabla estado.
--  5. Se conservan las convenciones del script original: tablas en singular,
--     PK = sigla + "_id", la FK se llama igual que la PK que referencia,
--     importes NUMERIC, toda FK con indice y ON DELETE explicito.
--  6. Cuando el contrato v3 define un enum que se emite tal cual (estado de
--     la reserva, tipo de boleto, metodo de pago), la base guarda el MISMO
--     valor del contrato para no tener que traducirlo.
--
--  CAMBIOS POR EL CONTRATO OPENAPI v3 (sobre el diagrama v2)
--  ---------------------------------------------------------------------------
--  Identity : + cliente_api (X-API-Key, canal M2M de Booking Prototipo).
--  Catalog  : + guia (1-N desde operador) y + atraccion_itinerario.
--             categoria y atraccion: banderas incluye_comida/transporte/guia.
--             atraccion: accesibilidad, permite_paquete, % descuento de
--             paquete, instrucciones de llegada, politica de cancelacion y
--             promedios por pilar (escala 0-10).
--  Review   : puntuacion 1-10 y pilares limpieza/servicio/calidad_precio/
--             puntualidad.
--  Pricing  : tar_tipo = ADULT, CHILD, SENIOR, INFANT, STUDENT. (ver ms_pricing.sql)
--  Inventory: disponibilidad.dis_slot_codigo = slot_id del contrato
--             (ej. slot-20261025-1030). Hace el papel de "turnos_aforo".
--  Coupon   : + acuerdo_promocion y acuerdo_promocion_destino
--             (GET/PUT /atracciones/promociones/contrato). (ver ms_coupon.sql)
--  Order    : orden de canal B2B: usu_id opcional + cla_id, CHECK de canal
--             unico. idempotencia admite usuario o cliente API como sujeto.
--  Booking  : estados PENDING/CONFIRMED/CHECKED_IN/COMPLETED/CANCELLED/
--             EXPIRED; senior/student/infant; saga_id; voucher QR; datos de
--             check-in; guia (gui_id); titular con contacto en
--             reserva_pasajero; tipo de boleto por pasajero;
--             + idempotencia (cancel y checkin exigen Idempotency-Key);
--             + outbox_evento (GET /atracciones/eventos, CloudEvents).
--  Payment  : metodo_pago = CREDIT_CARD, DEBIT_CARD, PAYPAL, TRANSFER.
--  Audit    : bitacora.bit_correlation_id (X-Correlation-Id).
--
--  TRIGGERS / VISTAS QUE CAMBIAN AL SEPARAR LAS BASES
--  ---------------------------------------------------------------------------
--  - trg_resena_calificacion  -> evento RESENA_PUBLICADA (Review -> Catalog).
--  - trg_reembolso_no_excede  -> validacion en Refund consultando a Payment.
--  - v_atraccion_completa     -> queda en Catalog, sin JOIN a geografia.
--  - v_orden_financiero       -> queda en Order, expone usu_id / cla_id.
--
--  EJECUCION (con psql, como superusuario)
--  ---------------------------------------------------------------------------
--     psql -U postgres -f 02_microservicios_v2_bases_de_datos.sql
--  El script crea 13 bases y se conecta a cada una con \connect.
--  Pricing, Cart y Coupon ya tienen su script independiente:
--     psql -U postgres -f ms_pricing/ms_pricing.sql
--     psql -U postgres -f ms_cart/ms_cart.sql
--     psql -U postgres -f ms_coupon/ms_coupon.sql
--
--  BASES
--  ---------------------------------------------------------------------------
--   1 ms_identity        Identity & Access Service         (REST)
--   2 ms_billing_profile Billing Profile Service           (REST)
--   3 ms_location        Location Service                  (REST)
--   4 ms_catalog         Catalog & Attractions Service     (REST)
--   5 ms_review          Review Service                    (REST)
--   6 ms_pricing         Pricing Service                   (gRPC)  -> Plan/ms_pricing/ms_pricing.sql
--   7 ms_inventory       Inventory & Availability Service  (gRPC)
--   8 ms_cart            Cart Service                      (REST)  -> Plan/ms_cart/ms_cart.sql
--   9 ms_coupon          Coupon & Promotions Service       (REST)  -> Plan/ms_coupon/ms_coupon.sql
--  10 ms_order           Order Management Service          (gRPC)
--  11 ms_booking         Booking Service                   (gRPC)
--  12 ms_payment         Payment Service                   (REST)
--  13 ms_refund          Refund Service                    (REST)
--  14 ms_invoicing       Electronic Invoicing Service      (SOAP)
--  15 ms_support         Support Service                   (REST)
--  16 ms_audit           Audit Service                     (REST, consumidor de eventos)
-- ============================================================================

\set ON_ERROR_STOP on

CREATE DATABASE ms_identity        ENCODING 'UTF8';
CREATE DATABASE ms_billing_profile ENCODING 'UTF8';
CREATE DATABASE ms_location        ENCODING 'UTF8';
CREATE DATABASE ms_catalog         ENCODING 'UTF8';
CREATE DATABASE ms_review          ENCODING 'UTF8';
CREATE DATABASE ms_inventory       ENCODING 'UTF8';
CREATE DATABASE ms_order           ENCODING 'UTF8';
CREATE DATABASE ms_booking         ENCODING 'UTF8';
CREATE DATABASE ms_payment         ENCODING 'UTF8';
CREATE DATABASE ms_refund          ENCODING 'UTF8';
CREATE DATABASE ms_invoicing       ENCODING 'UTF8';
CREATE DATABASE ms_support         ENCODING 'UTF8';
CREATE DATABASE ms_audit           ENCODING 'UTF8';


-- ============================================================================
--  1 · IDENTITY & ACCESS SERVICE  (REST)
--  Tablas: rol, usuario, usuario_rol, sesion, token_verificacion, cliente_api
--  Relaciones internas: rol 1-N usuario_rol, usuario 1-N usuario_rol,
--                       usuario 1-N sesion, usuario 1-N token_verificacion,
--                       usuario_rol.usr_asignado_por -> usuario
--  Referencias externas: ninguna
-- ============================================================================
\connect ms_identity

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_documento AS VARCHAR(20)
    CHECK (VALUE ~ '^[0-9]{10}$' OR VALUE ~ '^[A-Z]{1,2}[0-9]{6,9}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE rol (
    rol_id          SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol_nombre      VARCHAR(30)  NOT NULL UNIQUE,   -- ADMIN, OPERADOR, CLIENTE
    rol_descripcion VARCHAR(200) NOT NULL,
    rol_activo      BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE usuario (
    usu_id         BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_correo     dom_correo    NOT NULL UNIQUE,
    usu_password   VARCHAR(100)  NOT NULL,          -- bcrypt, NUNCA texto plano
    usu_nombre     VARCHAR(120)  NOT NULL,
    usu_apellido   VARCHAR(120)  NOT NULL,
    usu_documento  dom_documento UNIQUE,
    usu_telefono   dom_telefono,
    usu_fecha_nacimiento DATE,
    usu_avatar     VARCHAR(255),
    usu_verificado BOOLEAN       NOT NULL DEFAULT FALSE,
    usu_activo     BOOLEAN       NOT NULL DEFAULT TRUE,
    usu_ultimo_acceso TIMESTAMPTZ,
    usu_creado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    usu_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT usuario_nombres_no_vacios
        CHECK (btrim(usu_nombre) <> '' AND btrim(usu_apellido) <> '')
);

CREATE TABLE usuario_rol (
    usu_id           BIGINT      NOT NULL,
    rol_id           SMALLINT    NOT NULL,
    usr_asignado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    usr_asignado_por BIGINT,                        -- admin que lo asigno
    CONSTRAINT pk_usuario_rol PRIMARY KEY (usu_id, rol_id),
    CONSTRAINT fk_usuario_rol_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_usuario_rol_rol
        FOREIGN KEY (rol_id) REFERENCES rol (rol_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_usuario_rol_asignador
        FOREIGN KEY (usr_asignado_por) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);
CREATE INDEX ix_usuario_rol_rol_id ON usuario_rol (rol_id);
CREATE INDEX ix_usuario_rol_asignado_por ON usuario_rol (usr_asignado_por);

CREATE TABLE sesion (
    ses_id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    usu_id          BIGINT       NOT NULL,
    ses_token_hash  VARCHAR(128) NOT NULL UNIQUE,   -- SHA-256, nunca el token
    ses_ip          VARCHAR(45),
    ses_user_agent  VARCHAR(255),
    ses_expira_en   TIMESTAMPTZ  NOT NULL,
    ses_revocada    BOOLEAN      NOT NULL DEFAULT FALSE,
    ses_creado_en   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT fk_sesion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_sesion_usu_id ON sesion (usu_id);
CREATE INDEX ix_sesion_expira_en ON sesion (ses_expira_en);

CREATE TABLE token_verificacion (
    tokv_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id         BIGINT       NOT NULL,
    tokv_token     VARCHAR(128) NOT NULL UNIQUE,
    tokv_tipo      VARCHAR(20)  NOT NULL,           -- EMAIL, RECUPERACION
    tokv_expira_en TIMESTAMPTZ  NOT NULL,
    tokv_usado     BOOLEAN      NOT NULL DEFAULT FALSE,
    tokv_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT token_verificacion_tipo_valido
        CHECK (tokv_tipo IN ('EMAIL', 'RECUPERACION')),
    CONSTRAINT fk_token_verificacion_usuario
        FOREIGN KEY (usu_id) REFERENCES usuario (usu_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_token_verificacion_usu_id ON token_verificacion (usu_id);

-- Cliente API (maquina a maquina): sistemas externos como Booking Prototipo
-- que consumen la API con la cabecera X-API-Key. NUNCA se guarda la clave,
-- solo su hash.
CREATE TABLE cliente_api (
    cla_id         BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cla_codigo     VARCHAR(60)  NOT NULL UNIQUE,    -- ej. BOOKING_PROTOTIPO
    cla_nombre     VARCHAR(150) NOT NULL,
    cla_clave_hash VARCHAR(128) NOT NULL UNIQUE,    -- SHA-256 de la X-API-Key
    cla_activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    cla_creado_en  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    cla_ultimo_uso TIMESTAMPTZ
);

CREATE TRIGGER trg_usuario_actualizado BEFORE UPDATE ON usuario
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('usu_actualizado_en');

CREATE VIEW v_usuario_roles AS
SELECT u.usu_id, u.usu_correo, u.usu_nombre, u.usu_apellido, r.rol_id, r.rol_nombre
FROM usuario u
JOIN usuario_rol ur ON ur.usu_id = u.usu_id
JOIN rol r          ON r.rol_id  = ur.rol_id
WHERE u.usu_activo AND r.rol_activo;

INSERT INTO rol (rol_nombre, rol_descripcion) VALUES
    ('ADMIN',    'Administrador total del marketplace'),
    ('OPERADOR', 'Empresa que opera atracciones'),
    ('CLIENTE',  'Usuario que compra y reserva');


-- Clientes turistas (Booking): se registran en cliente_api sin clave ni cuenta web
-- (GET/POST /api/v3/clientes). cla_tipo separa a los socios (X-API-Key) de los
-- turistas; un turista nunca se autentica. Rol GUIA para el check-in.
ALTER TABLE cliente_api ADD COLUMN cla_tipo VARCHAR(10) NOT NULL DEFAULT 'SOCIO'
    CONSTRAINT cliente_api_tipo_valido CHECK (cla_tipo IN ('SOCIO', 'TURISTA'));
ALTER TABLE cliente_api ALTER COLUMN cla_clave_hash DROP NOT NULL;
ALTER TABLE cliente_api
    ADD COLUMN cla_correo         dom_correo,
    ADD COLUMN cla_identificacion VARCHAR(20),
    ADD COLUMN cla_telefono       dom_telefono,
    ADD COLUMN cla_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE cliente_api ADD CONSTRAINT cliente_api_datos_por_tipo CHECK (
    (cla_tipo = 'SOCIO'   AND cla_clave_hash IS NOT NULL) OR
    (cla_tipo = 'TURISTA' AND cla_clave_hash IS NULL
                          AND cla_correo IS NOT NULL AND cla_identificacion IS NOT NULL
                          AND (cla_identificacion ~ '^[0-9]{10}$' OR cla_identificacion ~ '^[A-Z0-9]{6,9}$'))
);
CREATE UNIQUE INDEX ux_cliente_api_turista_correo ON cliente_api (lower(cla_correo)) WHERE cla_tipo = 'TURISTA';
CREATE UNIQUE INDEX ux_cliente_api_turista_identificacion ON cliente_api (cla_identificacion) WHERE cla_tipo = 'TURISTA';
CREATE TRIGGER trg_cliente_api_actualizado BEFORE UPDATE ON cliente_api
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('cla_actualizado_en');
INSERT INTO rol (rol_nombre, rol_descripcion)
    VALUES ('GUIA', 'Guía que valida el check-in en el punto de encuentro');

-- Outbox transaccional: cambios de roles, cuentas y socios hacia el bus
-- (ROL_ASIGNADO, ROL_REVOCADO, USUARIO_DESACTIVADO, USUARIO_REACTIVADO,
-- ADMIN_INICIAL_CREADO, CLIENTE_API_*). ms-audit los guarda en la bitacora.
CREATE TABLE outbox (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id       UUID         NOT NULL CONSTRAINT uq_outbox_event_id UNIQUE,
    tipo_evento    VARCHAR(60)  NOT NULL,
    agregado_id    VARCHAR(60)  NOT NULL,    -- usu_id o cla_id afectado
    payload        JSONB        NOT NULL,    -- usu_id = quien hizo el cambio
    correlation_id VARCHAR(100) NOT NULL,
    creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    publicado_en   TIMESTAMPTZ,
    intentos       INT          NOT NULL DEFAULT 0 CONSTRAINT ck_outbox_intentos CHECK (intentos >= 0),
    ultimo_error   VARCHAR(500)
);
CREATE INDEX ix_outbox_pendientes ON outbox (creado_en) WHERE publicado_en IS NULL;


-- ============================================================================
--  2 · BILLING PROFILE SERVICE  (REST)
--  Tablas: dato_facturacion
--  Referencias externas (ID logico): usu_id -> usuario (Identity)
-- ============================================================================
\connect ms_billing_profile

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');

CREATE TABLE dato_facturacion (
    dfa_id                  BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id                  BIGINT       NOT NULL,                   -- ID logico (Identity)
    dfa_tipo_identificacion VARCHAR(20)  NOT NULL DEFAULT 'CEDULA',  -- CEDULA, RUC, PASAPORTE, CONSUMIDOR_FINAL
    dfa_identificacion      VARCHAR(20)  NOT NULL,
    dfa_razon_social        VARCHAR(150) NOT NULL,
    dfa_correo              dom_correo   NOT NULL,
    dfa_telefono            dom_telefono,
    dfa_es_principal        BOOLEAN      NOT NULL DEFAULT FALSE,
    dfa_activo              BOOLEAN      NOT NULL DEFAULT TRUE,      -- borrado logico
    dfa_creado_en           TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT dato_facturacion_tipo_valido
        CHECK (dfa_tipo_identificacion IN ('CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL')),
    CONSTRAINT dato_facturacion_identificacion_valida CHECK (
        (dfa_tipo_identificacion = 'CEDULA'           AND dfa_identificacion ~ '^[0-9]{10}$') OR
        (dfa_tipo_identificacion = 'RUC'              AND dfa_identificacion ~ '^[0-9]{13}$') OR
        (dfa_tipo_identificacion = 'PASAPORTE'        AND dfa_identificacion ~ '^[A-Z0-9]{6,20}$') OR
        (dfa_tipo_identificacion = 'CONSUMIDOR_FINAL' AND dfa_identificacion = '9999999999999')
    ),
    CONSTRAINT uq_dato_facturacion_usuario_identificacion
        UNIQUE (usu_id, dfa_tipo_identificacion, dfa_identificacion)
);
CREATE UNIQUE INDEX ux_dato_facturacion_principal
    ON dato_facturacion (usu_id) WHERE dfa_es_principal;
CREATE INDEX ix_dato_facturacion_usu_id ON dato_facturacion (usu_id);


-- Datos de facturacion de los turistas de cliente_api (Identity): cada fila es
-- de un usuario web (usu_id) o de un turista (cla_id), nunca de los dos.
ALTER TABLE dato_facturacion ALTER COLUMN usu_id DROP NOT NULL;
ALTER TABLE dato_facturacion ADD COLUMN cla_id BIGINT;            -- ID logico (Identity, cliente_api TURISTA)
ALTER TABLE dato_facturacion ADD CONSTRAINT dato_facturacion_un_titular
    CHECK ((usu_id IS NOT NULL) <> (cla_id IS NOT NULL));
ALTER TABLE dato_facturacion ADD CONSTRAINT uq_dato_facturacion_cliente_identificacion
    UNIQUE (cla_id, dfa_tipo_identificacion, dfa_identificacion);
CREATE UNIQUE INDEX ux_dato_facturacion_principal_cliente
    ON dato_facturacion (cla_id) WHERE dfa_es_principal AND cla_id IS NOT NULL;
CREATE INDEX ix_dato_facturacion_cla_id ON dato_facturacion (cla_id);


-- ============================================================================
--  3 · LOCATION SERVICE  (REST)
--  Tablas: region, provincia, ciudad
--  Relaciones internas: region 1-N provincia, provincia 1-N ciudad
--  Referencias externas: ninguna
-- ============================================================================
\connect ms_location

CREATE TABLE region (
    reg_id      SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reg_nombre  VARCHAR(30)  NOT NULL UNIQUE,
    reg_codigo  CHAR(2)      NOT NULL UNIQUE,
    CONSTRAINT region_nombre_no_vacio CHECK (btrim(reg_nombre) <> '')
);

CREATE TABLE provincia (
    prov_id      SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prov_nombre  VARCHAR(60)  NOT NULL UNIQUE,
    prov_codigo  CHAR(2)      NOT NULL UNIQUE,      -- codigo interno 01-24
    reg_id       SMALLINT     NOT NULL,
    prov_activa  BOOLEAN      NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_provincia_region
        FOREIGN KEY (reg_id) REFERENCES region (reg_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_provincia_reg_id ON provincia (reg_id);

CREATE TABLE ciudad (
    ciu_id          SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ciu_nombre      VARCHAR(80)  NOT NULL,
    ciu_codigo      CHAR(6)      NOT NULL UNIQUE,   -- codigo INEC/DANE
    prov_id         SMALLINT     NOT NULL,
    ciu_activa      BOOLEAN      NOT NULL DEFAULT TRUE,
    ciu_descripcion VARCHAR(500),
    ciu_imagen      VARCHAR(500),
    CONSTRAINT uq_ciudad_provincia_nombre UNIQUE (prov_id, ciu_nombre),
    CONSTRAINT fk_ciudad_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_ciudad_prov_id ON ciudad (prov_id);

INSERT INTO region (reg_nombre, reg_codigo) VALUES
    ('SIERRA',   'SI'),
    ('COSTA',    'CO'),
    ('AMAZONIA', 'AM'),
    ('GALAPAGOS','GA');

INSERT INTO provincia (prov_nombre, prov_codigo, reg_id) VALUES
    ('Azuay',                          '01', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Bolívar',                        '02', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Cañar',                          '03', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Carchi',                         '04', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Chimborazo',                     '05', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Cotopaxi',                       '06', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('El Oro',                         '07', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Esmeraldas',                     '08', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Galápagos',                      '09', (SELECT reg_id FROM region WHERE reg_codigo='GA')),
    ('Guayas',                         '10', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Imbabura',                       '11', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Loja',                           '12', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Los Ríos',                       '13', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Manabí',                         '14', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Morona Santiago',                '15', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Napo',                           '16', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Orellana',                       '17', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Pastaza',                        '18', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Pichincha',                      '19', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Santa Elena',                    '20', (SELECT reg_id FROM region WHERE reg_codigo='CO')),
    ('Santo Domingo de los Tsáchilas', '21', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Sucumbíos',                      '22', (SELECT reg_id FROM region WHERE reg_codigo='AM')),
    ('Tungurahua',                     '23', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Zamora Chinchipe',               '24', (SELECT reg_id FROM region WHERE reg_codigo='AM'));

INSERT INTO ciudad (ciu_nombre, ciu_codigo, prov_id) VALUES
    ('Cuenca',                 '010100', (SELECT prov_id FROM provincia WHERE prov_nombre='Azuay')),
    ('Guayaquil',              '090150', (SELECT prov_id FROM provincia WHERE prov_nombre='Guayas')),
    ('Quito',                  '170150', (SELECT prov_id FROM provincia WHERE prov_nombre='Pichincha')),
    ('Ambato',                 '180150', (SELECT prov_id FROM provincia WHERE prov_nombre='Tungurahua')),
    ('Riobamba',               '060100', (SELECT prov_id FROM provincia WHERE prov_nombre='Chimborazo')),
    ('Loja',                   '130100', (SELECT prov_id FROM provincia WHERE prov_nombre='Loja')),
    ('Puerto Baquerizo Moreno','020100', (SELECT prov_id FROM provincia WHERE prov_nombre='Galápagos')),
    ('Manta',                  '140350', (SELECT prov_id FROM provincia WHERE prov_nombre='Manabí')),
    ('Salinas',                '090300', (SELECT prov_id FROM provincia WHERE prov_nombre='Santa Elena')),
    ('La Troncal',             '030050', (SELECT prov_id FROM provincia WHERE prov_nombre='Cañar')),
    ('Ibarra',                 '100150', (SELECT prov_id FROM provincia WHERE prov_nombre='Imbabura')),
    ('Tulcan',                 '040100', (SELECT prov_id FROM provincia WHERE prov_nombre='Carchi')),
    ('Latacunga',              '050100', (SELECT prov_id FROM provincia WHERE prov_nombre='Cotopaxi')),
    ('Macas',                  '160100', (SELECT prov_id FROM provincia WHERE prov_nombre='Morona Santiago')),
    ('Puyo',                   '190150', (SELECT prov_id FROM provincia WHERE prov_nombre='Pastaza')),
    ('Archidona',              '170350', (SELECT prov_id FROM provincia WHERE prov_nombre='Napo')),
    ('Nueva Loja',             '230100', (SELECT prov_id FROM provincia WHERE prov_nombre='Sucumbíos'));


-- ============================================================================
--  4 · CATALOG & ATTRACTIONS SERVICE  (REST)
--  Tablas: categoria, operador, operador_usuario, guia, idioma, inclusion,
--          atraccion, atraccion_categoria, atraccion_idioma,
--          atraccion_inclusion, atraccion_foto, atraccion_itinerario
--  Relaciones internas: categoria 1-N categoria (cat_padre_id),
--                       categoria 1-N atraccion_categoria,
--                       atraccion 1-N atraccion_categoria,
--                       atraccion 1-N atraccion_foto,
--                       atraccion 1-N atraccion_itinerario,
--                       operador  1-N atraccion,
--                       operador  1-N operador_usuario,
--                       operador  1-N guia,
--                       atraccion 1-N atraccion_idioma, idioma 1-N atraccion_idioma,
--                       atraccion 1-N atraccion_inclusion, inclusion 1-N atraccion_inclusion
--  Referencias externas (ID logico): atraccion.ciu_id -> ciudad (Location),
--                       operador.prov_id -> provincia (Location),
--                       operador_usuario.usu_id, guia.usu_id -> usuario (Identity)
--  Las calificaciones de atraccion se actualizan al consumir el evento
--  RESENA_PUBLICADA de Review (escala 0-10 del contrato v3).
-- ============================================================================
\connect ms_catalog

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_ruc AS VARCHAR(13)
    CHECK (VALUE ~ '^[0-9]{13}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');
CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN dom_porcentaje AS NUMERIC(5,2)
    CHECK (VALUE >= 0 AND VALUE <= 100);
-- Calificacion promedio en la escala 0-10 del contrato (score, breakdown)
CREATE DOMAIN dom_calificacion AS NUMERIC(4,2)
    CHECK (VALUE >= 0 AND VALUE <= 10);

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE operador (
    ope_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ope_codigo    INTEGER      NOT NULL UNIQUE,     -- codigo legado del contrato
    ope_nombre    VARCHAR(150) NOT NULL,
    ope_ruc       dom_ruc      UNIQUE,
    ope_correo    dom_correo,
    ope_telefono  dom_telefono,
    ope_direccion VARCHAR(255),
    prov_id       SMALLINT     NOT NULL,            -- ID logico (Location)
    ope_activo    BOOLEAN      NOT NULL DEFAULT TRUE,
    ope_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ope_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_operador_prov_id ON operador (prov_id);

CREATE TABLE operador_usuario (
    ope_id      BIGINT      NOT NULL,
    usu_id      BIGINT      NOT NULL,               -- ID logico (Identity)
    opeu_cargo  VARCHAR(60) NOT NULL,               -- ADMIN, VENDEDOR, GUIA
    opeu_activo BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT pk_operador_usuario PRIMARY KEY (ope_id, usu_id),
    CONSTRAINT fk_operador_usuario_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_operador_usuario_usu_id ON operador_usuario (usu_id);

-- Guia turistico del operador. Se asigna a la reserva (guia_asignado) y
-- valida el check-in (guia_codigo). Puede no tener cuenta en el sistema.
CREATE TABLE guia (
    gui_id                BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ope_id                BIGINT       NOT NULL,
    usu_id                BIGINT,                   -- ID logico (Identity), opcional
    gui_codigo            VARCHAR(30)  NOT NULL UNIQUE,  -- ej. GUIA-CARLOS-01
    gui_nombre            VARCHAR(150) NOT NULL,         -- ej. Lic. Carlos Morales
    gui_credencial_mintur VARCHAR(30)  NOT NULL UNIQUE,  -- credencial del Ministerio de Turismo
    gui_activo            BOOLEAN      NOT NULL DEFAULT TRUE,
    gui_creado_en         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_guia_usuario UNIQUE (usu_id),
    CONSTRAINT fk_guia_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_guia_ope_id ON guia (ope_id);

CREATE TABLE categoria (
    cat_id                 INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cat_padre_id           INTEGER,                  -- autorreferencia
    cat_nombre             VARCHAR(80) NOT NULL,
    cat_slug               VARCHAR(80) NOT NULL UNIQUE,
    cat_descripcion        VARCHAR(255),
    cat_icono              VARCHAR(40) NOT NULL DEFAULT 'map-pin',
    cat_orden              SMALLINT    NOT NULL DEFAULT 0,
    -- Banderas obligatorias del contrato (CategoryTreeNode)
    cat_incluye_comida     BOOLEAN     NOT NULL DEFAULT FALSE,
    cat_incluye_transporte BOOLEAN     NOT NULL DEFAULT FALSE,
    cat_incluye_guia       BOOLEAN     NOT NULL DEFAULT FALSE,
    cat_activa             BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT categoria_no_es_ella_misma CHECK (cat_padre_id IS DISTINCT FROM cat_id),
    CONSTRAINT fk_categoria_padre
        FOREIGN KEY (cat_padre_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_categoria_cat_padre_id ON categoria (cat_padre_id);

CREATE TABLE idioma (
    idi_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idi_codigo CHAR(2)     NOT NULL UNIQUE,          -- ISO 639-1
    idi_nombre VARCHAR(50) NOT NULL
);

-- inclusions_list / exclusions_list del contrato
CREATE TABLE inclusion (
    inc_id     INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inc_tipo   VARCHAR(20)  NOT NULL,                -- INCLUYE, NO_INCLUYE, RECOMENDACION
    inc_nombre VARCHAR(150) NOT NULL,
    inc_orden  SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT uq_inclusion_tipo_nombre UNIQUE (inc_tipo, inc_nombre),
    CONSTRAINT inclusion_tipo_valido
        CHECK (inc_tipo IN ('INCLUYE', 'NO_INCLUYE', 'RECOMENDACION'))
);
CREATE INDEX ix_inclusion_inc_tipo ON inclusion (inc_tipo);

CREATE TABLE atraccion (
    atr_id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_uuid            UUID          NOT NULL DEFAULT gen_random_uuid(),  -- id publico
    atr_nombre          VARCHAR(200)  NOT NULL,
    atr_slug            VARCHAR(220)  NOT NULL UNIQUE,
    atr_descripcion     TEXT          NOT NULL,
    atr_descripcion_corta VARCHAR(280),
    atr_tipo            VARCHAR(30)   NOT NULL,      -- GUIDED_TOUR, ADMISSION, DAY_TRIP, TRANSPORT, PACKAGE
    atr_estado          VARCHAR(20)   NOT NULL DEFAULT 'BORRADOR',  -- BORRADOR, PUBLICADA, INACTIVA
    -- Punto de encuentro (meeting_point_geo)
    atr_latitud         NUMERIC(10,6) NOT NULL,
    atr_longitud        NUMERIC(10,6) NOT NULL,
    atr_direccion       VARCHAR(255),
    atr_punto_encuentro VARCHAR(255),
    atr_instrucciones_llegada VARCHAR(500),          -- arrival_instructions
    atr_duracion_horas  NUMERIC(5,2)  NOT NULL,
    atr_moneda          dom_moneda    NOT NULL DEFAULT 'USD',
    ciu_id              SMALLINT      NOT NULL,      -- ID logico (Location)
    ope_id              BIGINT        NOT NULL,
    -- Banderas de inclusion (inclusions)
    atr_incluye_comida     BOOLEAN    NOT NULL DEFAULT FALSE,
    atr_incluye_transporte BOOLEAN    NOT NULL DEFAULT FALSE,
    atr_incluye_guia       BOOLEAN    NOT NULL DEFAULT FALSE,
    -- Accesibilidad (accessibility)
    atr_accesible_silla_ruedas     BOOLEAN NOT NULL DEFAULT FALSE,
    atr_accesible_carriola         BOOLEAN NOT NULL DEFAULT FALSE,
    atr_admite_animales_asistencia BOOLEAN NOT NULL DEFAULT FALSE,
    -- Politica de cancelacion (cancellation_policy)
    atr_cancelacion_gratuita BOOLEAN  NOT NULL DEFAULT FALSE,
    atr_horas_cancelacion    SMALLINT NOT NULL DEFAULT 24,
    atr_politica_cancelacion VARCHAR(500),
    -- Paquetes y combos con Booking
    atr_permite_paquete             BOOLEAN        NOT NULL DEFAULT FALSE,
    atr_porcentaje_descuento_paquete dom_porcentaje NOT NULL DEFAULT 0,
    atr_destacada       BOOLEAN       NOT NULL DEFAULT FALSE,
    -- Calificaciones (evento RESENA_PUBLICADA, escala 0-10)
    atr_calificacion_promedio  dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_limpieza         dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_servicio         dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_calidad_precio   dom_calificacion NOT NULL DEFAULT 0,
    atr_calif_puntualidad      dom_calificacion NOT NULL DEFAULT 0,
    atr_numero_resenas  INTEGER       NOT NULL DEFAULT 0,
    atr_creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_actualizado_en  TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_eliminado_en    TIMESTAMPTZ,                 -- borrado logico
    CONSTRAINT uq_atraccion_uuid UNIQUE (atr_uuid),
    CONSTRAINT atraccion_duracion_valida
        CHECK (atr_duracion_horas > 0 AND atr_duracion_horas <= 720),
    CONSTRAINT atraccion_latitud_valida  CHECK (atr_latitud BETWEEN -90 AND 90),
    CONSTRAINT atraccion_longitud_valida CHECK (atr_longitud BETWEEN -180 AND 180),
    CONSTRAINT atraccion_horas_cancelacion_valida CHECK (atr_horas_cancelacion >= 0),
    CONSTRAINT atraccion_numero_resenas_valido CHECK (atr_numero_resenas >= 0),
    -- Sin paquete no hay descuento de paquete
    CONSTRAINT atraccion_descuento_paquete_coherente
        CHECK (atr_permite_paquete OR atr_porcentaje_descuento_paquete = 0),
    CONSTRAINT atraccion_tipo_valido
        CHECK (atr_tipo IN ('GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE')),
    CONSTRAINT atraccion_estado_valido
        CHECK (atr_estado IN ('BORRADOR', 'PUBLICADA', 'INACTIVA')),
    CONSTRAINT fk_atraccion_operador
        FOREIGN KEY (ope_id) REFERENCES operador (ope_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_ciu_id ON atraccion (ciu_id);
CREATE INDEX ix_atraccion_ope_id ON atraccion (ope_id);
CREATE INDEX ix_atraccion_estado ON atraccion (atr_estado);
CREATE INDEX ix_atraccion_busqueda
    ON atraccion USING gin ((atr_nombre || ' ' || atr_descripcion) gin_trgm_ops);

CREATE TABLE atraccion_categoria (
    atr_id BIGINT  NOT NULL,
    cat_id INTEGER NOT NULL,
    CONSTRAINT pk_atraccion_categoria PRIMARY KEY (atr_id, cat_id),
    CONSTRAINT fk_atraccion_categoria_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_categoria_categoria
        FOREIGN KEY (cat_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_categoria_cat_id ON atraccion_categoria (cat_id);

-- guide_languages del contrato
CREATE TABLE atraccion_idioma (
    atr_id BIGINT   NOT NULL,
    idi_id SMALLINT NOT NULL,
    CONSTRAINT pk_atraccion_idioma PRIMARY KEY (atr_id, idi_id),
    CONSTRAINT fk_atraccion_idioma_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_idioma_idioma
        FOREIGN KEY (idi_id) REFERENCES idioma (idi_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_idioma_idi_id ON atraccion_idioma (idi_id);

CREATE TABLE atraccion_inclusion (
    atr_id BIGINT  NOT NULL,
    inc_id INTEGER NOT NULL,
    CONSTRAINT pk_atraccion_inclusion PRIMARY KEY (atr_id, inc_id),
    CONSTRAINT fk_atraccion_inclusion_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_inclusion_inclusion
        FOREIGN KEY (inc_id) REFERENCES inclusion (inc_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_inclusion_inc_id ON atraccion_inclusion (inc_id);

CREATE TABLE atraccion_foto (
    fot_id    BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id    BIGINT       NOT NULL,
    fot_url   VARCHAR(500) NOT NULL,
    fot_alt   VARCHAR(200) NOT NULL,                 -- texto alternativo (WCAG 1.1.1)
    fot_orden SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT fk_atraccion_foto_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_foto_atr_id ON atraccion_foto (atr_id);

-- Itinerario paso a paso (itinerary / ItineraryStop del contrato)
CREATE TABLE atraccion_itinerario (
    iti_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id               BIGINT       NOT NULL,
    iti_numero_parada    SMALLINT     NOT NULL,      -- stop_number
    iti_hora             TIME         NOT NULL,      -- time (se formatea "09:00 a.m.")
    iti_titulo           VARCHAR(200) NOT NULL,      -- title
    iti_descripcion      VARCHAR(500),               -- description
    iti_duracion_minutos SMALLINT     NOT NULL,      -- duration_minutes
    iti_nombre_ubicacion VARCHAR(200),               -- location_name
    CONSTRAINT uq_atraccion_itinerario_parada UNIQUE (atr_id, iti_numero_parada),
    CONSTRAINT atraccion_itinerario_parada_valida CHECK (iti_numero_parada > 0),
    CONSTRAINT atraccion_itinerario_duracion_valida CHECK (iti_duracion_minutos > 0),
    CONSTRAINT fk_atraccion_itinerario_atraccion
        FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TRIGGER trg_operador_actualizado BEFORE UPDATE ON operador
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('ope_actualizado_en');
CREATE TRIGGER trg_atraccion_actualizado BEFORE UPDATE ON atraccion
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('atr_actualizado_en');

-- Sin JOIN a geografia (vive en Location): se expone ciu_id para resolverlo por API.
CREATE VIEW v_atraccion_completa AS
SELECT a.atr_id, a.atr_nombre, a.atr_slug, a.atr_estado, a.atr_tipo,
       a.ciu_id, o.ope_nombre AS operador, o.ope_ruc AS operador_ruc
FROM atraccion a
JOIN operador o ON o.ope_id = a.ope_id;

INSERT INTO idioma (idi_codigo, idi_nombre) VALUES
    ('es','Espanol'), ('en','Ingles'), ('fr','Frances'), ('de','Aleman');

INSERT INTO categoria (cat_nombre, cat_slug, cat_descripcion, cat_orden,
                       cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia) VALUES
    ('Aventura',   'aventura',   'Deportes extremos y naturaleza', 1, FALSE, TRUE,  TRUE),
    ('Cultural',   'cultural',   'Patrimonio e historia',          2, FALSE, FALSE, TRUE),
    ('Naturales',  'naturales',  'Ecosistemas y fauna',            3, FALSE, TRUE,  TRUE),
    ('Gastronomia','gastronomia','Comida y bebida local',          4, TRUE,  FALSE, TRUE),
    ('Playas',     'playas',     'Costa y litoral',                5, FALSE, FALSE, FALSE),
    ('Montana',    'montana',    'Sierra y senderismo',            6, FALSE, TRUE,  TRUE);


-- ============================================================================
--  5 · REVIEW SERVICE  (REST)
--  Tablas: resena
--  Referencias externas (ID logico): atr_id -> atraccion (Catalog),
--                                    usu_id -> usuario (Identity)
--  Publica el evento RESENA_PUBLICADA (reemplaza a trg_resena_calificacion).
--  Escala 1-10, igual que el score y el breakdown del contrato v3.
-- ============================================================================
\connect ms_review

CREATE TABLE resena (
    ren_id             BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id             BIGINT        NOT NULL,      -- ID logico (Catalog)
    usu_id             BIGINT,                      -- ID logico (Identity); NULL = anonima
    ren_autor_nombre   VARCHAR(120),                -- solo para resenas anonimas
    ren_puntuacion     SMALLINT      NOT NULL,      -- score general
    ren_limpieza       SMALLINT      NOT NULL,      -- breakdown.limpieza
    ren_servicio       SMALLINT      NOT NULL,      -- breakdown.servicio
    ren_calidad_precio SMALLINT      NOT NULL,      -- breakdown.calidad_precio
    ren_puntualidad    SMALLINT      NOT NULL,      -- breakdown.puntualidad
    ren_comentario     VARCHAR(1000) NOT NULL,
    ren_visible        BOOLEAN       NOT NULL DEFAULT TRUE,
    ren_creado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT resena_puntuaciones_validas CHECK (
        ren_puntuacion     BETWEEN 1 AND 10 AND
        ren_limpieza       BETWEEN 1 AND 10 AND
        ren_servicio       BETWEEN 1 AND 10 AND
        ren_calidad_precio BETWEEN 1 AND 10 AND
        ren_puntualidad    BETWEEN 1 AND 10),
    CONSTRAINT uq_resena_atraccion_usuario UNIQUE (atr_id, usu_id),
    CONSTRAINT resena_autor_coherente
        CHECK ((usu_id IS NOT NULL AND ren_autor_nombre IS NULL)
            OR (usu_id IS NULL AND ren_autor_nombre IS NOT NULL))
);
CREATE INDEX ix_resena_atr_id ON resena (atr_id);
CREATE INDEX ix_resena_usu_id ON resena (usu_id);


-- ============================================================================
--  6 · PRICING SERVICE  (gRPC)  ->  script propio: Plan/ms_pricing/ms_pricing.sql
-- ============================================================================


-- ============================================================================
--  7 · INVENTORY & AVAILABILITY SERVICE  (gRPC)
--  Tablas: horario, disponibilidad, fecha_bloqueada
--  Relaciones internas: horario 1-N disponibilidad
--                       (FK compuesta (hor_id, atr_id) -> horario)
--  Referencias externas (ID logico): atr_id -> atraccion (Catalog) en las 3
--  disponibilidad es la tabla de "turnos y aforo" del contrato v3:
--  dis_slot_codigo = slot_id (bloqueo atomico de aforo). El estado
--  DISPONIBLE / ULTIMOS_CUPOS (<= 3) / AGOTADO se calcula, no se guarda.
--  Cada cambio de cupo se envia a Booking por gRPC (PushStockUpdate).
-- ============================================================================
\connect ms_inventory

CREATE TABLE horario (
    hor_id     BIGINT  GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id     BIGINT  NOT NULL,                    -- ID logico (Catalog)
    hor_hora   TIME    NOT NULL,
    hor_cupo   INTEGER NOT NULL DEFAULT 20,
    hor_activo BOOLEAN NOT NULL DEFAULT TRUE,
    gui_id     BIGINT,                              -- ID logico (Catalog): guia por defecto de los turnos; NULL = sin guia
    CONSTRAINT horario_cupo_positivo CHECK (hor_cupo > 0),
    CONSTRAINT uq_horario_atraccion_hora UNIQUE (atr_id, hor_hora),
    -- Clave candidata para la FK compuesta desde disponibilidad
    CONSTRAINT uq_horario_id_atraccion UNIQUE (hor_id, atr_id)
);
CREATE INDEX ix_horario_atr_id ON horario (atr_id);

CREATE TABLE disponibilidad (
    dis_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id             BIGINT      NOT NULL,        -- ID logico (Catalog)
    hor_id             BIGINT      NOT NULL,
    dis_fecha          DATE        NOT NULL,
    dis_slot_codigo    VARCHAR(40) NOT NULL,        -- slot_id, ej. slot-20261025-1030
    dis_cupo_total     INTEGER     NOT NULL,
    dis_cupo_reservado INTEGER     NOT NULL DEFAULT 0,
    dis_cerrada        BOOLEAN     NOT NULL DEFAULT FALSE,
    gui_id             BIGINT,                      -- ID logico (Catalog): guia del turno; NULL = sin guia
    CONSTRAINT uq_disponibilidad_atraccion_fecha_horario UNIQUE (atr_id, dis_fecha, hor_id),
    CONSTRAINT uq_disponibilidad_atraccion_slot UNIQUE (atr_id, dis_slot_codigo),
    -- La fecha del slot_id debe coincidir con dis_fecha (SLOT_TIME_MISMATCH);
    -- la hora la valida el servicio contra horario.hor_hora.
    CONSTRAINT disponibilidad_slot_formato
        CHECK (dis_slot_codigo = 'slot-' || to_char(dis_fecha, 'YYYYMMDD') || '-' || right(dis_slot_codigo, 4)
               AND dis_slot_codigo ~ '^slot-[0-9]{8}-[0-9]{4}$'),
    CONSTRAINT disponibilidad_cupos_validos
        CHECK (dis_cupo_total > 0
               AND dis_cupo_reservado >= 0
               AND dis_cupo_reservado <= dis_cupo_total),
    -- FK compuesta interna: el horario debe ser de la MISMA atraccion
    CONSTRAINT fk_disponibilidad_horario
        FOREIGN KEY (hor_id, atr_id) REFERENCES horario (hor_id, atr_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_disponibilidad_atr_id ON disponibilidad (atr_id);
CREATE INDEX ix_disponibilidad_hor_id ON disponibilidad (hor_id, atr_id);
CREATE INDEX ix_disponibilidad_fecha  ON disponibilidad (dis_fecha);
CREATE INDEX ix_disponibilidad_gui_id ON disponibilidad (gui_id);

CREATE TABLE fecha_bloqueada (
    fb_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id       BIGINT       NOT NULL,             -- ID logico (Catalog)
    fb_fecha     DATE         NOT NULL,
    fb_motivo    VARCHAR(200) NOT NULL,
    fb_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_fecha_bloqueada_atraccion_fecha UNIQUE (atr_id, fb_fecha)
);
CREATE INDEX ix_fecha_bloqueada_atr_id ON fecha_bloqueada (atr_id);


-- ============================================================================
--  8 · CART SERVICE  (REST)  ->  script propio: Plan/ms_cart/ms_cart.sql
--  9 · COUPON & PROMOTIONS SERVICE  (REST)  ->  script propio: Plan/ms_coupon/ms_coupon.sql
-- ============================================================================


-- ============================================================================
--  10 · ORDER MANAGEMENT SERVICE  (gRPC)
--  Tablas: estado, orden, orden_detalle, orden_cupon, idempotencia
--  Relaciones internas: estado 1-N orden, orden 1-N orden_detalle,
--                       orden 1-N orden_cupon
--  Referencias externas (ID logico): orden.usu_id -> usuario (Identity);
--                       orden.cla_id -> cliente_api (Identity);
--                       orden.cai_id -> carrito_item (Cart);
--                       orden.mpa_id -> metodo_pago (Payment);
--                       orden_cupon.cup_id -> cupon (Coupon);
--                       orden_detalle.atr_id -> atraccion (Catalog);
--                       idempotencia.idem_sujeto -> usuario o cliente_api (Identity)
--  external_order_id del contrato = orden.ord_numero.
--
--  REGLAS DE COMPRA
--  - Cada atraccion se paga por separado: una orden = una atraccion. Sus
--    lineas (orden_detalle, una por tipo de boleto) son todas de la misma
--    atraccion (trg_orden_detalle_una_atraccion).
--  - Desde el portal, la orden nace de UN item del carrito (orden.cai_id);
--    el resto del carrito queda sin pagar. NULL = compra directa (Booking).
--  - La orden queda CREADA hasta que Payment informa el resultado. Solo con
--    el pago APROBADO pasa a PAGADA, marca el item del carrito COMPRADO y
--    publica OrdenPagada; Invoicing emite la factura unicamente al recibir
--    ese evento. Con el pago rechazado, la orden pasa a CANCELADA y el item
--    vuelve a PENDIENTE en el carrito.
-- ============================================================================
\connect ms_order

CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Estados propios de la orden (sin est_grupo).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE orden (
    ord_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_numero         VARCHAR(20) NOT NULL UNIQUE,  -- external_order_id (ej. ORD-DILAN-8721)
    -- Canal de la orden: un usuario de la web O un cliente API (Booking).
    usu_id             BIGINT,                       -- ID logico (Identity), comprador web
    cla_id             BIGINT,                       -- ID logico (Identity), canal B2B
    cai_id             BIGINT,                       -- ID logico (Cart): item del carrito; NULL = compra directa
    est_id             SMALLINT    NOT NULL,
    mpa_id             SMALLINT,                     -- ID logico (Payment)
    ord_fecha          TIMESTAMPTZ NOT NULL DEFAULT now(),
    ord_subtotal       dom_importe NOT NULL DEFAULT 0,
    ord_descuento      dom_importe NOT NULL DEFAULT 0,
    ord_iva            dom_importe NOT NULL DEFAULT 0,
    ord_total          dom_importe NOT NULL DEFAULT 0,
    ord_moneda         dom_moneda  NOT NULL DEFAULT 'USD',
    ord_observaciones  VARCHAR(500),
    ord_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    ord_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT orden_total_coherente
        CHECK (ord_total = ord_subtotal - ord_descuento + ord_iva),
    -- Exactamente uno de los dos: la orden es de la web o del canal B2B.
    CONSTRAINT orden_canal_unico
        CHECK ((usu_id IS NOT NULL) <> (cla_id IS NOT NULL)),
    -- Un item del carrito pasa a UNA sola orden.
    CONSTRAINT uq_orden_cai_id UNIQUE (cai_id),
    CONSTRAINT fk_orden_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_orden_usu_id ON orden (usu_id);
CREATE INDEX ix_orden_cla_id ON orden (cla_id);
CREATE INDEX ix_orden_est_id ON orden (est_id);
CREATE INDEX ix_orden_fecha  ON orden (ord_fecha DESC);
CREATE INDEX ix_orden_mpa_id ON orden (mpa_id);

CREATE TABLE orden_detalle (
    det_id              BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id              BIGINT       NOT NULL,
    atr_id              BIGINT       NOT NULL,       -- ID logico (Catalog)
    det_descripcion     VARCHAR(255) NOT NULL,       -- snapshot del nombre
    det_cantidad        INTEGER      NOT NULL,
    det_precio_unitario dom_importe  NOT NULL,       -- snapshot del precio (Pricing)
    det_subtotal        dom_importe  NOT NULL,
    CONSTRAINT orden_detalle_cantidad_valida CHECK (det_cantidad > 0),
    CONSTRAINT orden_detalle_subtotal_coherente
        CHECK (det_subtotal = det_cantidad * det_precio_unitario),
    CONSTRAINT fk_orden_detalle_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_orden_detalle_ord_id ON orden_detalle (ord_id);
CREATE INDEX ix_orden_detalle_atr_id ON orden_detalle (atr_id);

-- Una orden = una atraccion: todas las lineas de una orden deben ser de la
-- misma atraccion (no se compran dos atracciones en una transaccion).
CREATE OR REPLACE FUNCTION fn_orden_detalle_una_atraccion()
RETURNS TRIGGER AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM orden_detalle
               WHERE ord_id = NEW.ord_id AND atr_id <> NEW.atr_id AND det_id <> NEW.det_id) THEN
        RAISE EXCEPTION 'La orden % ya tiene otra atraccion: cada atraccion se paga por separado', NEW.ord_id
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_orden_detalle_una_atraccion
    BEFORE INSERT OR UPDATE OF ord_id, atr_id ON orden_detalle
    FOR EACH ROW EXECUTE FUNCTION fn_orden_detalle_una_atraccion();

CREATE TABLE orden_cupon (
    ord_id       BIGINT      NOT NULL,
    cup_id       BIGINT      NOT NULL,               -- ID logico (Coupon)
    orc_usado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT pk_orden_cupon PRIMARY KEY (ord_id, cup_id),
    CONSTRAINT fk_orden_cupon_orden
        FOREIGN KEY (ord_id) REFERENCES orden (ord_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_orden_cupon_cup_id ON orden_cupon (cup_id);

-- Registro de operaciones idempotentes (evita cobros dobles).
-- El sujeto es un usuario web (JWT) o un cliente API (X-API-Key).
CREATE TABLE idempotencia (
    idem_clave        UUID         NOT NULL,         -- cabecera Idempotency-Key
    idem_sujeto_tipo  VARCHAR(12)  NOT NULL,         -- USUARIO, CLIENTE_API
    idem_sujeto       BIGINT       NOT NULL,         -- ID logico usu_id / cla_id (Identity)
    idem_operacion    VARCHAR(150) NOT NULL,
    idem_request_hash VARCHAR(64)  NOT NULL,
    idem_estado       VARCHAR(12)  NOT NULL DEFAULT 'IN_PROGRESS',
    idem_response     JSONB,
    idem_expira_en    TIMESTAMPTZ  NOT NULL,         -- 24 h segun el contrato
    idem_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_idempotencia PRIMARY KEY (idem_clave, idem_sujeto_tipo, idem_sujeto),
    CONSTRAINT idempotencia_sujeto_tipo_valido
        CHECK (idem_sujeto_tipo IN ('USUARIO', 'CLIENTE_API')),
    CONSTRAINT idempotencia_estado_valido
        CHECK (idem_estado IN ('IN_PROGRESS', 'DONE', 'FAILED'))
);
CREATE INDEX ix_idempotencia_expira_en ON idempotencia (idem_expira_en);

CREATE TRIGGER trg_orden_actualizado BEFORE UPDATE ON orden
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('ord_actualizado_en');

CREATE VIEW v_orden_financiero AS
SELECT o.ord_id, o.ord_numero, o.ord_fecha, o.usu_id, o.cla_id,
       COALESCE(SUM(det.det_subtotal), 0) AS calculado_subtotal,
       o.ord_subtotal, o.ord_descuento, o.ord_iva, o.ord_total,
       (o.ord_subtotal - o.ord_descuento + o.ord_iva) AS total_recalculado
FROM orden o
LEFT JOIN orden_detalle det ON det.ord_id = o.ord_id
GROUP BY o.ord_id, o.ord_numero, o.ord_fecha, o.usu_id, o.cla_id,
         o.ord_subtotal, o.ord_descuento, o.ord_iva, o.ord_total;

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('CREADA',      'Orden creada',      FALSE),
    ('PAGADA',      'Orden pagada',      TRUE),
    ('CANCELADA',   'Orden cancelada',   TRUE),
    ('REEMBOLSADA', 'Orden reembolsada', TRUE);


-- ============================================================================
--  11 · BOOKING SERVICE  (gRPC + REST /atracciones/reservas)
--  Tablas: estado, reserva, reserva_pasajero, idempotencia, outbox_evento
--  Relaciones internas: estado 1-N reserva, reserva 1-N reserva_pasajero
--  Referencias externas (ID logico): reserva.det_id -> orden_detalle (Order),
--                       reserva.dis_id -> disponibilidad (Inventory),
--                       reserva.gui_id -> guia (Catalog),
--                       idempotencia.idem_sujeto -> usuario o cliente_api (Identity)
--  La fecha, la hora y el slot_id se leen de disponibilidad (3FN).
--  outbox_evento alimenta GET /atracciones/eventos (CloudEvents v1.0) y se
--  escribe en la MISMA transaccion que el cambio de la reserva.
-- ============================================================================
\connect ms_booking

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Estados de la reserva = enum status del contrato v3 (maquina de 6 fases).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE reserva (
    res_id                 BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_uuid               UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- reservation_id
    res_codigo             VARCHAR(12)   NOT NULL UNIQUE,   -- reservation_code (PNR), ej. DEC-7F3K9Q
    det_id                 BIGINT        NOT NULL,          -- ID logico (Order)
    dis_id                 BIGINT        NOT NULL,          -- ID logico (Inventory)
    est_id                 SMALLINT      NOT NULL,
    gui_id                 BIGINT,                          -- ID logico (Catalog); NULL = sin guia
    res_saga_id            VARCHAR(40),                     -- saga_id de Booking Prototipo
    res_adultos            INTEGER       NOT NULL,          -- adult_count
    res_ninos              INTEGER       NOT NULL DEFAULT 0, -- child_count
    res_seniors            INTEGER       NOT NULL DEFAULT 0, -- senior_count
    res_estudiantes        INTEGER       NOT NULL DEFAULT 0, -- student_count
    res_infantes           INTEGER       NOT NULL DEFAULT 0, -- infant_count (ocupa cupo)
    res_numero_tickets     INTEGER       NOT NULL,          -- ticket_count
    res_precio_total       dom_importe   NOT NULL,          -- total_price (snapshot)
    res_requerimientos     VARCHAR(500),                    -- special_requirements
    res_voucher_qr         TEXT,                            -- voucher_qr_payload (firmado)
    -- Cancelacion (POST /reservas/{id}/cancel)
    res_motivo_cancelacion VARCHAR(255),                    -- reason
    res_cancelado_por      VARCHAR(20),                     -- solicitante
    res_cancelado_en       TIMESTAMPTZ,
    -- Check-in presencial (POST /reservas/{id}/checkin)
    res_checkin_en         TIMESTAMPTZ,                     -- hora_checkin
    res_checkin_documento  VARCHAR(20),                     -- documento_identidad presentado
    res_checkin_guia_codigo VARCHAR(30),                    -- guia_codigo
    res_checkin_dispositivo VARCHAR(60),                    -- scanner_device_id
    res_confirmado_en      TIMESTAMPTZ,
    res_creado_en          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    res_actualizado_en     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT reserva_pasajeros_validos
        CHECK (res_adultos >= 1 AND res_ninos >= 0 AND res_seniors >= 0
               AND res_estudiantes >= 0 AND res_infantes >= 0),
    CONSTRAINT reserva_total_coherente
        CHECK (res_numero_tickets = res_adultos + res_ninos + res_seniors
                                  + res_estudiantes + res_infantes),
    CONSTRAINT reserva_cancelado_por_valido
        CHECK (res_cancelado_por IS NULL
               OR res_cancelado_por IN ('CLIENTE', 'SAGA_ORCHESTRATOR', 'ADMIN')),
    CONSTRAINT reserva_cancelacion_coherente
        CHECK ((res_cancelado_en IS NULL) = (res_cancelado_por IS NULL)),
    CONSTRAINT reserva_checkin_coherente
        CHECK (res_checkin_en IS NULL OR res_checkin_documento IS NOT NULL),
    CONSTRAINT reserva_no_checkin_y_cancelada
        CHECK (res_checkin_en IS NULL OR res_cancelado_en IS NULL),
    CONSTRAINT fk_reserva_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_reserva_det_id  ON reserva (det_id);
CREATE INDEX ix_reserva_dis_id  ON reserva (dis_id);
CREATE INDEX ix_reserva_gui_id  ON reserva (gui_id);
CREATE INDEX ix_reserva_est_id  ON reserva (est_id);
CREATE INDEX ix_reserva_saga_id ON reserva (res_saga_id);

-- Pasajeros de la reserva. El titular (customer del contrato) lleva sus
-- datos de contacto; los acompanantes (passengers) solo nombre, documento
-- y tipo de boleto.
CREATE TABLE reserva_pasajero (
    pax_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_id               BIGINT       NOT NULL,
    pax_nombre           VARCHAR(120) NOT NULL,     -- full_name
    pax_tipo_documento   VARCHAR(10),               -- document_type: CEDULA, PASAPORTE, RUC
    pax_documento        VARCHAR(20),               -- document_id
    pax_correo           dom_correo,                -- email (titular)
    pax_telefono         dom_telefono,              -- phone (titular)
    pax_tipo_boleto      VARCHAR(10)  NOT NULL DEFAULT 'ADULT', -- ticket_type
    pax_fecha_nacimiento DATE,
    pax_es_titular       BOOLEAN      NOT NULL DEFAULT FALSE,
    CONSTRAINT reserva_pasajero_tipo_boleto_valido
        CHECK (pax_tipo_boleto IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT', 'STUDENT')),
    CONSTRAINT reserva_pasajero_tipo_documento_valido
        CHECK (pax_tipo_documento IS NULL
               OR pax_tipo_documento IN ('CEDULA', 'PASAPORTE', 'RUC')),
    CONSTRAINT reserva_pasajero_documento_valido CHECK (
        pax_documento IS NULL OR
        (pax_tipo_documento = 'CEDULA'    AND pax_documento ~ '^[0-9]{10}$') OR
        (pax_tipo_documento = 'RUC'       AND pax_documento ~ '^[0-9]{13}$') OR
        (pax_tipo_documento = 'PASAPORTE' AND pax_documento ~ '^[A-Z0-9]{6,9}$') OR
        (pax_tipo_documento IS NULL       AND pax_documento ~ '^[A-Z0-9]{6,13}$')
    ),
    -- El titular debe tener todos los datos obligatorios de CustomerContactDto
    CONSTRAINT reserva_pasajero_titular_completo CHECK (
        NOT pax_es_titular OR (pax_tipo_documento IS NOT NULL AND pax_documento IS NOT NULL
                               AND pax_correo IS NOT NULL AND pax_telefono IS NOT NULL)
    ),
    CONSTRAINT fk_reserva_pasajero_reserva
        FOREIGN KEY (res_id) REFERENCES reserva (res_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_reserva_pasajero_res_id ON reserva_pasajero (res_id);
CREATE INDEX ix_reserva_pasajero_documento ON reserva_pasajero (pax_documento);
CREATE INDEX ix_reserva_pasajero_correo ON reserva_pasajero (lower(pax_correo));
-- Un solo titular por reserva.
CREATE UNIQUE INDEX ux_reserva_pasajero_titular
    ON reserva_pasajero (res_id) WHERE pax_es_titular;

-- Idempotencia de POST /reservas, /cancel y /checkin (cabecera obligatoria).
CREATE TABLE idempotencia (
    idem_clave        UUID         NOT NULL,         -- cabecera Idempotency-Key
    idem_sujeto_tipo  VARCHAR(12)  NOT NULL,         -- USUARIO, CLIENTE_API
    idem_sujeto       BIGINT       NOT NULL,         -- ID logico usu_id / cla_id (Identity)
    idem_operacion    VARCHAR(150) NOT NULL,
    idem_request_hash VARCHAR(64)  NOT NULL,
    idem_estado       VARCHAR(12)  NOT NULL DEFAULT 'IN_PROGRESS',
    idem_response     JSONB,
    idem_expira_en    TIMESTAMPTZ  NOT NULL,         -- 24 h segun el contrato
    idem_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pk_idempotencia PRIMARY KEY (idem_clave, idem_sujeto_tipo, idem_sujeto),
    CONSTRAINT idempotencia_sujeto_tipo_valido
        CHECK (idem_sujeto_tipo IN ('USUARIO', 'CLIENTE_API')),
    CONSTRAINT idempotencia_estado_valido
        CHECK (idem_estado IN ('IN_PROGRESS', 'DONE', 'FAILED'))
);
CREATE INDEX ix_idempotencia_expira_en ON idempotencia (idem_expira_en);

-- Transactional Outbox (OutboxEventItem, CloudEvents v1.0).
-- evt_id es el sequence_number y el cursor "after" de GET /atracciones/eventos.
CREATE TABLE outbox_evento (
    evt_id             BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- sequence_number
    evt_uuid           UUID         NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- event_id
    evt_specversion    VARCHAR(5)   NOT NULL DEFAULT '1.0',
    evt_fuente         VARCHAR(120) NOT NULL DEFAULT '/api/v3/atracciones',   -- source
    evt_tipo           VARCHAR(30)  NOT NULL,                                 -- event_type
    evt_aggregate_id   VARCHAR(64)  NOT NULL,                                 -- aggregate_id
    evt_correlation_id VARCHAR(64)  NOT NULL,                                 -- correlation_id
    evt_payload        JSONB        NOT NULL,                                 -- payload / data
    evt_creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),                   -- timestamp
    evt_publicado_en   TIMESTAMPTZ,                     -- enviado a RabbitMQ / Kafka
    CONSTRAINT outbox_evento_tipo_valido
        CHECK (evt_tipo IN ('RESERVA_CREADA', 'RESERVA_CONFIRMADA',
                            'STOCK_ACTUALIZADO', 'RESERVA_CANCELADA'))
);
CREATE INDEX ix_outbox_evento_tipo ON outbox_evento (evt_tipo, evt_id);
CREATE INDEX ix_outbox_evento_pendiente
    ON outbox_evento (evt_id) WHERE evt_publicado_en IS NULL;

CREATE TRIGGER trg_reserva_actualizado BEFORE UPDATE ON reserva
    FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp('res_actualizado_en');

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('PENDING',    'Reserva pendiente',             FALSE),
    ('CONFIRMED',  'Reserva confirmada',            FALSE),
    ('CHECKED_IN', 'Check-in presencial realizado', FALSE),
    ('COMPLETED',  'Reserva completada',            TRUE),
    ('CANCELLED',  'Reserva cancelada',             TRUE),
    ('EXPIRED',    'Reserva expirada',              TRUE);


-- Turista de la reserva (cliente_api de Identity, solo compras de un socio),
-- canal de compra y aviso del check-in a Booking Central (con reintentos).
ALTER TABLE reserva ADD COLUMN cla_id_cliente BIGINT;   -- ID logico (Identity, cliente_api TURISTA); NULL en compras web
ALTER TABLE reserva ADD COLUMN res_canal VARCHAR(10) NOT NULL DEFAULT 'WEB'
    CONSTRAINT reserva_canal_valido CHECK (res_canal IN ('WEB', 'SOCIO'));
CREATE INDEX ix_reserva_cla_id_cliente ON reserva (cla_id_cliente);

CREATE TABLE notificacion_checkin (
    res_id            BIGINT       PRIMARY KEY
        CONSTRAINT fk_notificacion_checkin_reserva REFERENCES reserva (res_id) ON DELETE CASCADE,
    nch_payload       JSONB        NOT NULL,             -- cuerpo de POST /api/v3/reservas/{external_order_id}/checkin
    nch_intentos      INTEGER      NOT NULL DEFAULT 0,
    nch_ultimo_error  VARCHAR(500),
    nch_proximo_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    nch_enviado_en    TIMESTAMPTZ,
    nch_creado_en     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    nch_correlation_id VARCHAR(100),                     -- para seguir los reintentos en los logs
    CONSTRAINT notificacion_checkin_intentos_validos CHECK (nch_intentos >= 0)
);
CREATE INDEX ix_notificacion_checkin_pendiente ON notificacion_checkin (nch_proximo_en) WHERE nch_enviado_en IS NULL;


-- ============================================================================
--  12 · PAYMENT SERVICE  (REST)
--  Tablas: metodo_pago, estado, pago, pago_tarjeta, pago_transferencia
--  Relaciones internas: metodo_pago 1-N pago, estado 1-N pago,
--                       pago 1-1 pago_tarjeta, pago 1-1 pago_transferencia
--  Referencias externas (ID logico): pago.ord_id -> orden (Order)
--  La moneda del pago es la de la orden: se consulta a Order.
--  mpa_codigo = payment_method.method del contrato v3.
-- ============================================================================
\connect ms_payment

CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE TABLE metodo_pago (
    mpa_id             SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    mpa_codigo         VARCHAR(20) NOT NULL UNIQUE,  -- CREDIT_CARD, DEBIT_CARD, PAYPAL, TRANSFER
    mpa_nombre         VARCHAR(60) NOT NULL,
    mpa_requiere_datos BOOLEAN     NOT NULL DEFAULT FALSE,
    mpa_activo         BOOLEAN     NOT NULL DEFAULT TRUE
);

-- Estados propios del pago (sin est_grupo).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE pago (
    pag_id             BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_numero         VARCHAR(30)  NOT NULL UNIQUE,
    ord_id             BIGINT       NOT NULL,        -- ID logico (Order)
    mpa_id             SMALLINT     NOT NULL,
    est_id             SMALLINT     NOT NULL,
    pag_monto          dom_importe  NOT NULL,        -- moneda: la de la orden
    pag_referencia     VARCHAR(100),                 -- id de la pasarela
    pag_autorizacion   VARCHAR(100),
    pag_fecha          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    pag_aprobado_en    TIMESTAMPTZ,
    pag_rechazado_en   TIMESTAMPTZ,
    pag_motivo_rechazo VARCHAR(300),
    pag_creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT pago_monto_valido CHECK (pag_monto > 0),
    CONSTRAINT pago_aprobado_o_rechazado
        CHECK (pag_aprobado_en IS NULL OR pag_rechazado_en IS NULL),
    CONSTRAINT pago_motivo_solo_si_rechazado
        CHECK (pag_motivo_rechazo IS NULL OR pag_rechazado_en IS NOT NULL),
    CONSTRAINT fk_pago_metodo_pago
        FOREIGN KEY (mpa_id) REFERENCES metodo_pago (mpa_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_pago_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_pago_ord_id ON pago (ord_id);
CREATE INDEX ix_pago_mpa_id ON pago (mpa_id);
CREATE INDEX ix_pago_est_id ON pago (est_id);
CREATE INDEX ix_pago_fecha  ON pago (pag_fecha DESC);
-- Una orden tiene a lo sumo UN pago aprobado.
CREATE UNIQUE INDEX ux_pago_orden_aprobado
    ON pago (ord_id) WHERE pag_aprobado_en IS NOT NULL;

-- Tarjeta de credito o debito. NUNCA se guarda el numero (PCI-DSS).
CREATE TABLE pago_tarjeta (
    pat_id       BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id       BIGINT       NOT NULL,
    pat_marca    VARCHAR(20)  NOT NULL,              -- VISA, MASTERCARD, AMEX
    pat_ultimos4 CHAR(4)      NOT NULL,
    pat_titular  VARCHAR(120) NOT NULL,
    pat_mes      SMALLINT     NOT NULL,
    pat_anio     SMALLINT     NOT NULL,
    pat_pais     CHAR(2)      NOT NULL,
    CONSTRAINT pago_tarjeta_mes_valido  CHECK (pat_mes BETWEEN 1 AND 12),
    CONSTRAINT pago_tarjeta_anio_valido CHECK (pat_anio BETWEEN 2020 AND 2100),
    CONSTRAINT pago_tarjeta_ultimos4_formato CHECK (pat_ultimos4 ~ '^[0-9]{4}$'),
    CONSTRAINT uq_pago_tarjeta_pag_id UNIQUE (pag_id),          -- 1:1
    CONSTRAINT fk_pago_tarjeta_pago
        FOREIGN KEY (pag_id) REFERENCES pago (pag_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE pago_transferencia (
    ptr_id                  BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id                  BIGINT      NOT NULL,
    ptr_banco               VARCHAR(60) NOT NULL,
    ptr_numero_comprobante  VARCHAR(40) NOT NULL,
    ptr_fecha_transferencia DATE        NOT NULL,
    ptr_archivo_adjunto     VARCHAR(500),
    CONSTRAINT uq_pago_transferencia_pag_id UNIQUE (pag_id),    -- 1:1
    CONSTRAINT fk_pago_transferencia_pago
        FOREIGN KEY (pag_id) REFERENCES pago (pag_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

INSERT INTO metodo_pago (mpa_codigo, mpa_nombre, mpa_requiere_datos) VALUES
    ('CREDIT_CARD', 'Tarjeta de credito',     TRUE),
    ('DEBIT_CARD',  'Tarjeta de debito',      TRUE),
    ('PAYPAL',      'PayPal',                 FALSE),
    ('TRANSFER',    'Transferencia bancaria', TRUE);

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('PENDIENTE', 'Pago pendiente', FALSE),
    ('APROBADO',  'Pago aprobado',  TRUE),
    ('RECHAZADO', 'Pago rechazado', TRUE),
    ('FALLIDO',   'Pago fallido',   TRUE);


-- ============================================================================
--  13 · REFUND SERVICE  (REST)
--  Tablas: reembolso
--  Referencias externas (ID logico): pag_id -> pago (Payment)
--  rem_numero = reembolso_id del contrato (ej. REF-ATR-7F3K9Q).
--  Regla "no reembolsar mas de lo cobrado" (antes trg_reembolso_no_excede):
--  el servicio consulta a Payment el pag_monto antes de procesar.
-- ============================================================================
\connect ms_refund

CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE TABLE reembolso (
    rem_id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_id            BIGINT      NOT NULL,         -- ID logico (Payment)
    rem_numero        VARCHAR(30) NOT NULL UNIQUE,  -- reembolso_id
    rem_monto         dom_importe NOT NULL,         -- monto_reembolsado
    rem_motivo        VARCHAR(300),
    rem_referencia    VARCHAR(100),                 -- id del reembolso en la pasarela
    rem_solicitado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    rem_procesado_en  TIMESTAMPTZ,
    rem_creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT reembolso_monto_valido CHECK (rem_monto > 0)
);
CREATE INDEX ix_reembolso_pag_id ON reembolso (pag_id);


-- ============================================================================
--  14 · ELECTRONIC INVOICING SERVICE  (SOAP)
--  Tablas: estado, factura, factura_detalle
--  Relaciones internas: estado 1-N factura, factura 1-N factura_detalle
--  Referencias externas (ID logico): factura.ord_id -> orden (Order),
--                       factura.dfa_id -> dato_facturacion (Billing Profile),
--                       factura_detalle.det_id -> orden_detalle (Order)
-- ============================================================================
\connect ms_invoicing

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');
CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');
CREATE DOMAIN dom_porcentaje AS NUMERIC(5,2)
    CHECK (VALUE >= 0 AND VALUE <= 100);
CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

-- Estados propios de la factura (sin est_grupo).
CREATE TABLE estado (
    est_id     SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    est_codigo VARCHAR(20) NOT NULL UNIQUE,
    est_nombre VARCHAR(50) NOT NULL,
    est_final  BOOLEAN     NOT NULL DEFAULT FALSE
);

CREATE TABLE factura (
    fac_id               BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id               BIGINT       NOT NULL,      -- ID logico (Order)
    dfa_id               BIGINT,                     -- ID logico (Billing Profile)
    fac_numero           VARCHAR(20)  NOT NULL UNIQUE,
    fac_clave_acceso     VARCHAR(49),                -- clave de acceso SRI
    fac_autorizacion_sri VARCHAR(49),
    est_id               SMALLINT     NOT NULL,
    fac_emitida_en       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    fac_subtotal         dom_importe  NOT NULL,
    fac_descuento        dom_importe  NOT NULL DEFAULT 0,
    fac_iva              dom_importe  NOT NULL DEFAULT 0,
    fac_total            dom_importe  NOT NULL,
    -- Snapshot del comprador al momento de emitir
    fac_tipo_identificacion VARCHAR(20)  NOT NULL,
    fac_identificacion      VARCHAR(20)  NOT NULL,
    fac_razon_social        VARCHAR(150) NOT NULL,
    fac_correo              dom_correo   NOT NULL,
    fac_telefono            dom_telefono,
    CONSTRAINT factura_tipo_identificacion_valido
        CHECK (fac_tipo_identificacion IN ('CEDULA', 'RUC', 'PASAPORTE', 'CONSUMIDOR_FINAL')),
    CONSTRAINT factura_total_coherente
        CHECK (fac_total = fac_subtotal - fac_descuento + fac_iva),
    CONSTRAINT uq_factura_orden UNIQUE (ord_id),
    CONSTRAINT fk_factura_estado
        FOREIGN KEY (est_id) REFERENCES estado (est_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_factura_dfa_id ON factura (dfa_id);
CREATE INDEX ix_factura_est_id ON factura (est_id);

CREATE TABLE factura_detalle (
    fde_id              BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fac_id              BIGINT         NOT NULL,
    det_id              BIGINT         NOT NULL,     -- ID logico (Order)
    fde_codigo          VARCHAR(25)    NOT NULL,     -- codigo principal del producto (SRI)
    fde_descripcion     VARCHAR(300)   NOT NULL,
    fde_cantidad        INTEGER        NOT NULL,
    fde_precio_unitario dom_importe    NOT NULL,
    fde_descuento       dom_importe    NOT NULL DEFAULT 0,
    fde_subtotal        dom_importe    NOT NULL,
    fde_iva_porcentaje  dom_porcentaje NOT NULL DEFAULT 0,
    fde_iva             dom_importe    NOT NULL DEFAULT 0,
    fde_total           dom_importe    NOT NULL,
    CONSTRAINT factura_detalle_cantidad_valida CHECK (fde_cantidad > 0),
    CONSTRAINT factura_detalle_subtotal_coherente
        CHECK (fde_subtotal = fde_cantidad * fde_precio_unitario - fde_descuento),
    CONSTRAINT factura_detalle_total_coherente
        CHECK (fde_total = fde_subtotal + fde_iva),
    -- Una linea de orden se factura una sola vez
    CONSTRAINT uq_factura_detalle_det_id UNIQUE (det_id),
    CONSTRAINT fk_factura_detalle_factura
        FOREIGN KEY (fac_id) REFERENCES factura (fac_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);
CREATE INDEX ix_factura_detalle_fac_id ON factura_detalle (fac_id);

INSERT INTO estado (est_codigo, est_nombre, est_final) VALUES
    ('NO_PAGADA', 'Factura no pagada', FALSE),
    ('PAGADA',    'Factura pagada',    TRUE),
    ('ANULADA',   'Factura anulada',   TRUE);


-- ============================================================================
--  15 · SUPPORT SERVICE  (REST)
--  Tablas: mensaje_contacto
--  Referencias externas: ninguna
-- ============================================================================
\connect ms_support

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE TABLE mensaje_contacto (
    men_id        BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    men_nombre    VARCHAR(120)  NOT NULL,
    men_correo    dom_correo    NOT NULL,
    men_asunto    VARCHAR(30)   NOT NULL,
    men_cuerpo    VARCHAR(2000) NOT NULL,
    men_leido     BOOLEAN       NOT NULL DEFAULT FALSE,
    men_creado_en TIMESTAMPTZ   NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensaje_contacto_leido ON mensaje_contacto (men_leido);


-- ============================================================================
--  16 · AUDIT SERVICE  (REST · consumidor de eventos)
--  Tablas: bitacora
--  Referencias externas (ID logico): usu_id -> usuario (Identity)
--  bit_correlation_id guarda el X-Correlation-Id para rastrear una
--  transaccion entre servicios, RabbitMQ y Kafka.
-- ============================================================================
\connect ms_audit

CREATE TABLE bitacora (
    bit_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id             BIGINT,                      -- ID logico (Identity); NULL si es anonimo
    bit_accion         VARCHAR(60) NOT NULL,
    bit_entidad        VARCHAR(60) NOT NULL,
    bit_entidad_id     VARCHAR(64),
    bit_correlation_id VARCHAR(64),                 -- X-Correlation-Id
    bit_detalle        JSONB,
    bit_ip             VARCHAR(45),
    bit_creado_en      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_bitacora_usu_id      ON bitacora (usu_id);
CREATE INDEX ix_bitacora_fecha       ON bitacora (bit_creado_en DESC);
CREATE INDEX ix_bitacora_entidad     ON bitacora (bit_entidad, bit_entidad_id);
CREATE INDEX ix_bitacora_correlation ON bitacora (bit_correlation_id);
