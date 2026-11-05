-- ============================================================================
--  TOURGIRLS (SISTEMA DE ATRACCIONES TURÍSTICAS DEL ECUADOR)
--  MODELO DE BASE DE DATOS REESTRUCTURADO PARA ARQUITECTURA DE MICROSERVICIOS
--  Basado en: Contrato OpenAPI v2.0.0 (contracts/atracciones-openapi-v2.yaml)
--  Motor: PostgreSQL 14+   |   Codificación: UTF-8
-- ============================================================================
--
--  MAPA ARQUITECTÓNICO DE MICROSERVICIOS Y PROTOCOLOS DE INTEGRACIÓN
--  ---------------------------------------------------------------------------
--  Conforme al contrato oficial OpenAPI v2 y los lineamientos de la cátedra
--  (Semana 8 & Consideraciones RDA2), el sistema monolítico se descompone en
--  los siguientes Bounded Contexts con sus respectivas tecnologías:
--
--  ┌─────────────────────────────────────────────────────────────────────────┐
--  │ 1. MS_CATALOG (Catálogo, Búsqueda y Ficha Técnica)                     │
--  │    - Tecnología: RESTful HTTP/JSON (OpenAPI 3.0.3, HATEOAS Nivel 3)     │
--  │    - Endpoints: GET /atracciones/categorias/arbol, POST /search, etc.   │
--  │    - Tablas: categoria, atraccion, atraccion_itinerario, inclusion,     │
--  │              idioma, tarifa, atraccion_foto, resena, geografia.         │
--  ├─────────────────────────────────────────────────────────────────────────┤
--  │ 2. MS_INVENTORY (Inventario, Disponibilidad y Turnos Horarios)         │
--  │    - Tecnologías Híbridas:                                              │
--  │      a) gRPC sobre HTTP/2 (Puerto 50051, Protobuf 3):                    │
--  │         Servicio inventory.InventoryStockService (PushStockUpdate)      │
--  │         para ingesta de cupos en tiempo real hacia Booking Prototipo.   │
--  │      b) REST HTTP/JSON: GET /atracciones/{id}/availability              │
--  │    - Tablas: horario, disponibilidad, fecha_bloqueada.                  │
--  ├─────────────────────────────────────────────────────────────────────────┤
--  │ 3. MS_BOOKING_CHECKIN (Reservas, Sagas Distribuidas y Check-in)         │
--  │    - Tecnologías:                                                       │
--  │      a) RESTful HTTP/JSON: POST /reservas (201 Created / 409 Conflict), │
--  │         POST /reservas/{id}/cancel (Saga LIFO), POST /checkin.          │
--  │      b) SOA / Event-Driven Architecture (EDA): Transactional Outbox     │
--  │         en GET /atracciones/eventos hacia Apache Kafka y RabbitMQ.      │
--  │    - Tablas: reserva, reserva_pasajero, outbox_evento, idempotencia_m2m.│
--  ├─────────────────────────────────────────────────────────────────────────┤
--  │ 4. MS_PROMOTIONS_B2B (Alianzas Comerciales B2B y Combos Multidominio)   │
--  │    - Tecnología: RESTful HTTP/JSON                                      │
--  │    - Endpoints: GET/PUT /atracciones/promociones/contrato (RDA2 pág 149)│
--  │    - Tablas: acuerdo_promocion_b2b.                                     │
--  ├─────────────────────────────────────────────────────────────────────────┤
--  │ 5. MS_CORE_ECOMMERCE (Identidad, Facturación SRI y Carrito B2C Local)   │
--  │    - Tecnologías: REST HTTP/JSON + SOA Facturación Electrónica SRI      │
--  │      (SOAP/XML y firma digital XAdES-BES para comprobantes del SRI).    │
--  │    - Tablas: usuario, rol, orden, pago, factura, factura_detalle, etc.  │
--  ├─────────────────────────────────────────────────────────────────────────┤
--  │ 6. MS_OBSERVABILITY (Telemetría de Nodo y Monitor de Salud)             │
--  │    - Tecnología: REST HTTP/JSON (GET /atracciones/health para semáforo) │
--  │    - Tablas: nodo_telemetria_log.                                       │
--  └─────────────────────────────────────────────────────────────────────────┘
-- ============================================================================

-- ============================================================================
--  SECCIÓN 0 · EXTENSIONES Y DOMINIOS BASE
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE DOMAIN dom_correo AS VARCHAR(160)
    CHECK (VALUE ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$');

CREATE DOMAIN dom_documento AS VARCHAR(20)
    CHECK (VALUE ~ '^[0-9]{10}$' OR VALUE ~ '^[A-Z]{1,2}[0-9]{6,9}$');

CREATE DOMAIN dom_ruc AS VARCHAR(13)
    CHECK (VALUE ~ '^[0-9]{13}$');

CREATE DOMAIN dom_telefono AS VARCHAR(20)
    CHECK (VALUE ~ '^\+?[0-9]{7,15}$');

CREATE DOMAIN dom_moneda AS CHAR(3)
    CHECK (VALUE ~ '^[A-Z]{3}$');

CREATE DOMAIN dom_porcentaje AS NUMERIC(5,2)
    CHECK (VALUE >= 0 AND VALUE <= 100);

CREATE DOMAIN dom_importe AS NUMERIC(12,2)
    CHECK (VALUE >= 0);

CREATE TYPE tipo_identificacion_fiscal AS ENUM (
    'CEDULA', 
    'RUC', 
    'PASAPORTE', 
    'CONSUMIDOR_FINAL'
);


-- ============================================================================
--  MICROSERVICIO 1: CATÁLOGO Y EXPERIENCIAS TURÍSTICAS (MS_CATALOG)
--  Tecnología: RESTful HTTP/JSON (OpenAPI Specification 3.0.3, HATEOAS Nivel 3)
--  Descripción: Gestiona la taxonomía jerárquica de categorías, la ficha
--               técnica de atracciones, itinerarios, puntos de encuentro GPS,
--               atributos de accesibilidad y valoraciones de 4 pilares.
-- ============================================================================

-- Geografía base (Región -> Provincia -> Ciudad)
CREATE TABLE region (
    reg_id      SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reg_nombre  VARCHAR(30)  NOT NULL UNIQUE,
    reg_codigo  CHAR(2)      NOT NULL UNIQUE,
    CONSTRAINT region_nombre_no_vacio CHECK (btrim(reg_nombre) <> '')
);

CREATE TABLE provincia (
    prov_id       SMALLINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prov_nombre   VARCHAR(60)    NOT NULL UNIQUE,
    prov_codigo   CHAR(2)        NOT NULL UNIQUE,
    reg_id        SMALLINT       NOT NULL,
    prov_activa   BOOLEAN        NOT NULL DEFAULT TRUE,
    CONSTRAINT fk_provincia_region
        FOREIGN KEY (reg_id) REFERENCES region (reg_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_provincia_reg_id ON provincia (reg_id);

CREATE TABLE ciudad (
    ciu_id       SMALLINT    GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ciu_nombre   VARCHAR(80) NOT NULL,
    ciu_codigo   CHAR(6)     NOT NULL UNIQUE,
    prov_id      SMALLINT    NOT NULL,
    ciu_activa   BOOLEAN     NOT NULL DEFAULT TRUE,
    ciu_descripcion VARCHAR(500),
    ciu_imagen   VARCHAR(500),
    CONSTRAINT uq_ciudad_provincia_nombre UNIQUE (prov_id, ciu_nombre),
    CONSTRAINT uq_ciudad_id_provincia UNIQUE (ciu_id, prov_id),
    CONSTRAINT fk_ciudad_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_ciudad_prov_id ON ciudad (prov_id);

-- Empresa operadora del tour
CREATE TABLE operador (
    ope_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ope_codigo    INTEGER      NOT NULL UNIQUE,
    ope_nombre    VARCHAR(150) NOT NULL,
    ope_ruc       dom_ruc      UNIQUE,
    ope_correo    dom_correo,
    ope_telefono  dom_telefono,
    ope_direccion VARCHAR(255),
    prov_id       SMALLINT     NOT NULL,
    ope_activo    BOOLEAN      NOT NULL DEFAULT TRUE,
    ope_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ope_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_operador_provincia
        FOREIGN KEY (prov_id) REFERENCES provincia (prov_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);
CREATE INDEX ix_operador_prov_id ON operador (prov_id);

-- Taxonomía Jerárquica Recursiva de Categorías
-- Integra las tres banderas booleanas OBLIGATORIAS dictadas por la cátedra RDA2
CREATE TABLE categoria (
    cat_id             INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    cat_padre_id       INTEGER,                          -- autorreferencia para árbol
    cat_nombre         VARCHAR(80)  NOT NULL,
    cat_slug           VARCHAR(80)  NOT NULL UNIQUE,
    cat_descripcion    VARCHAR(255),
    cat_icono          VARCHAR(40)  NOT NULL DEFAULT 'compass',
    cat_orden          SMALLINT     NOT NULL DEFAULT 0,
    cat_activa         BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Banderas de inclusión de cátedra requeridas por el contrato v2
    cat_incluye_comida     BOOLEAN  NOT NULL DEFAULT FALSE,
    cat_incluye_transporte BOOLEAN  NOT NULL DEFAULT FALSE,
    cat_incluye_guia       BOOLEAN  NOT NULL DEFAULT FALSE,
    CONSTRAINT fk_categoria_padre
        FOREIGN KEY (cat_padre_id) REFERENCES categoria (cat_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT categoria_no_es_ella_misma CHECK (cat_padre_id IS DISTINCT FROM cat_id)
);
CREATE INDEX ix_categoria_cat_padre_id ON categoria (cat_padre_id);

CREATE TABLE idioma (
    idi_id     SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    idi_codigo CHAR(2)      NOT NULL UNIQUE,        -- ISO 639-1
    idi_nombre VARCHAR(50)  NOT NULL
);

CREATE TABLE inclusion (
    inc_id     INTEGER     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inc_tipo   VARCHAR(20) NOT NULL,                -- INCLUYE, NO_INCLUYE, RECOMENDACION
    inc_nombre VARCHAR(150) NOT NULL,
    inc_orden  SMALLINT    NOT NULL DEFAULT 0,
    CONSTRAINT uq_inclusion_tipo_nombre UNIQUE (inc_tipo, inc_nombre),
    CONSTRAINT inclusion_tipo_valido
        CHECK (inc_tipo IN ('INCLUYE', 'NO_INCLUYE', 'RECOMENDACION'))
);
CREATE INDEX ix_inclusion_inc_tipo ON inclusion (inc_tipo);

-- Ficha Técnica Canónica de Atracción Turística
CREATE TABLE atraccion (
    atr_id                      BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_uuid                    UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- ID público del contrato
    atr_codigo_publico          VARCHAR(30)   NOT NULL UNIQUE DEFAULT ('ATR-' || upper(substr(md5(random()::text), 1, 8))),
    atr_nombre                  VARCHAR(200)  NOT NULL,
    atr_slug                    VARCHAR(220)  NOT NULL UNIQUE,
    atr_descripcion             TEXT          NOT NULL,
    atr_descripcion_corta       VARCHAR(280),
    atr_tipo                    VARCHAR(30)   NOT NULL,   -- GUIDED_TOUR, ADMISSION, DAY_TRIP, TRANSPORT, PACKAGE
    atr_estado                  VARCHAR(20)   NOT NULL DEFAULT 'PUBLICADA',  -- BORRADOR, PUBLICADA, INACTIVA
    
    -- Ubicación física general
    atr_latitud                 NUMERIC(10,6) NOT NULL,
    atr_longitud                NUMERIC(10,6) NOT NULL,
    atr_direccion               VARCHAR(255),
    
    -- Punto de encuentro geoespacial enriquecido (MeetingPointGeo)
    atr_punto_encuentro         VARCHAR(255)  NOT NULL,
    atr_meeting_point_latitud   NUMERIC(10,6),
    atr_meeting_point_longitud  NUMERIC(10,6),
    atr_arrival_instructions    TEXT,
    atr_google_maps_url         VARCHAR(500),
    
    atr_duracion_horas          NUMERIC(5,2)  NOT NULL,
    atr_moneda                  dom_moneda    NOT NULL DEFAULT 'USD',
    prov_id                     SMALLINT      NOT NULL,
    ciu_id                      SMALLINT      NOT NULL,
    ope_id                      BIGINT        NOT NULL,
    
    -- Políticas de cancelación
    atr_cancelacion_gratuita    BOOLEAN       NOT NULL DEFAULT TRUE,
    atr_horas_cancelacion       SMALLINT      NOT NULL DEFAULT 24,
    atr_descripcion_cancelacion VARCHAR(255)  DEFAULT 'Cancelación gratuita hasta 24 horas antes con reembolso total.',
    
    -- Atributos de accesibilidad universal (AccessibilityAttributes)
    atr_accesible_silla_ruedas      BOOLEAN   NOT NULL DEFAULT FALSE,
    atr_accesible_coche_bebe        BOOLEAN   NOT NULL DEFAULT FALSE,
    atr_admite_animales_asistencia  BOOLEAN   NOT NULL DEFAULT TRUE,
    
    -- Políticas de combos y paquetes turísticos multidominio
    atr_permite_paquete             BOOLEAN   NOT NULL DEFAULT TRUE,
    atr_porcentaje_descuento_paquete NUMERIC(5,2) NOT NULL DEFAULT 15.00,
    
    -- Métricas y Calificaciones desglosadas en 4 pilares (Escala 1 al 10 según contrato)
    atr_calificacion_promedio   NUMERIC(3,1)  NOT NULL DEFAULT 9.5,
    atr_score_limpieza          NUMERIC(3,1)  NOT NULL DEFAULT 9.6,
    atr_score_servicio          NUMERIC(3,1)  NOT NULL DEFAULT 9.8,
    atr_score_calidad_precio    NUMERIC(3,1)  NOT NULL DEFAULT 9.4,
    atr_score_puntualidad       NUMERIC(3,1)  NOT NULL DEFAULT 9.7,
    atr_numero_resenas          INTEGER       NOT NULL DEFAULT 0,
    
    atr_destacada               BOOLEAN       NOT NULL DEFAULT FALSE,
    atr_creado_en               TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_actualizado_en          TIMESTAMPTZ   NOT NULL DEFAULT now(),
    atr_eliminado_en            TIMESTAMPTZ,
    
    CONSTRAINT atraccion_duracion_valida CHECK (atr_duracion_horas > 0 AND atr_duracion_horas <= 720),
    CONSTRAINT atraccion_calificacion_valida CHECK (atr_calificacion_promedio BETWEEN 0 AND 10),
    CONSTRAINT atraccion_tipo_valido CHECK (atr_tipo IN ('GUIDED_TOUR', 'ADMISSION', 'DAY_TRIP', 'TRANSPORT', 'PACKAGE')),
    CONSTRAINT atraccion_estado_valido CHECK (atr_estado IN ('BORRADOR', 'PUBLICADA', 'INACTIVA')),
    CONSTRAINT fk_atraccion_provincia FOREIGN KEY (prov_id) REFERENCES provincia (prov_id) ON DELETE RESTRICT,
    CONSTRAINT fk_atraccion_ciudad FOREIGN KEY (ciu_id, prov_id) REFERENCES ciudad (ciu_id, prov_id) ON DELETE RESTRICT,
    CONSTRAINT fk_atraccion_operador FOREIGN KEY (ope_id) REFERENCES operador (ope_id) ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_ciu_id ON atraccion (ciu_id);
CREATE INDEX ix_atraccion_estado ON atraccion (atr_estado);
CREATE INDEX ix_atraccion_slug ON atraccion (atr_slug);
CREATE INDEX ix_atraccion_busqueda ON atraccion USING gin ((atr_nombre || ' ' || atr_descripcion) gin_trgm_ops);

-- Itinerario cronológico secuencial paso a paso (ItineraryStop)
CREATE TABLE atraccion_itinerario (
    iti_id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id           BIGINT       NOT NULL,
    iti_stop_number  SMALLINT     NOT NULL,
    iti_time         VARCHAR(20)  NOT NULL,            -- Ej: "09:00 a.m."
    iti_title        VARCHAR(150) NOT NULL,
    iti_description  TEXT,
    iti_duration_min INTEGER      NOT NULL DEFAULT 30,
    iti_location_name VARCHAR(150),
    CONSTRAINT uq_itinerario_atraccion_stop UNIQUE (atr_id, iti_stop_number),
    CONSTRAINT fk_itinerario_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_itinerario_atr_id ON atraccion_itinerario (atr_id);

CREATE TABLE atraccion_categoria (
    atr_id     BIGINT   NOT NULL,
    cat_id     INTEGER  NOT NULL,
    CONSTRAINT pk_atraccion_categoria PRIMARY KEY (atr_id, cat_id),
    CONSTRAINT fk_atraccion_categoria_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_categoria_categoria FOREIGN KEY (cat_id) REFERENCES categoria (cat_id) ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_categoria_cat_id ON atraccion_categoria (cat_id);

CREATE TABLE atraccion_idioma (
    atr_id     BIGINT   NOT NULL,
    idi_id     SMALLINT NOT NULL,
    CONSTRAINT pk_atraccion_idioma PRIMARY KEY (atr_id, idi_id),
    CONSTRAINT fk_atraccion_idioma_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_idioma_idioma FOREIGN KEY (idi_id) REFERENCES idioma (idi_id) ON DELETE RESTRICT
);
CREATE INDEX ix_atraccion_idioma_idi_id ON atraccion_idioma (idi_id);

CREATE TABLE atraccion_inclusion (
    atr_id     BIGINT   NOT NULL,
    inc_id     INTEGER  NOT NULL,
    CONSTRAINT pk_atraccion_inclusion PRIMARY KEY (atr_id, inc_id),
    CONSTRAINT fk_atraccion_inclusion_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE,
    CONSTRAINT fk_atraccion_inclusion_inclusion FOREIGN KEY (inc_id) REFERENCES inclusion (inc_id) ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_inclusion_inc_id ON atraccion_inclusion (inc_id);

CREATE TABLE atraccion_foto (
    fot_id        BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id        BIGINT       NOT NULL,
    fot_url       VARCHAR(500) NOT NULL,
    fot_alt       VARCHAR(200) NOT NULL,
    fot_orden     SMALLINT     NOT NULL DEFAULT 0,
    CONSTRAINT fk_atraccion_foto_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE
);
CREATE INDEX ix_atraccion_foto_atr_id ON atraccion_foto (atr_id);

-- Tarifario desglosado por grupo de edad (TarifaBaseDesglosada)
-- Permite los 4 tipos de boleto exigidos: ADULTO, NINO, SENIOR e INFANTE ($0.00 con cupo legal)
CREATE TABLE tarifa (
    tar_id            BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id            BIGINT      NOT NULL,
    tar_tipo          VARCHAR(20) NOT NULL,             -- ADULT, CHILD, SENIOR, INFANT
    tar_precio        dom_importe NOT NULL,
    tar_moneda        dom_moneda  NOT NULL DEFAULT 'USD',
    tar_vigente_desde DATE        NOT NULL DEFAULT CURRENT_DATE,
    tar_vigente_hasta DATE,
    CONSTRAINT uq_tarifa_atraccion_tipo_desde UNIQUE (atr_id, tar_tipo, tar_vigente_desde),
    CONSTRAINT tarifa_tipo_valido CHECK (tar_tipo IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT', 'GRUPO')),
    CONSTRAINT fk_tarifa_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE
);
CREATE INDEX ix_tarifa_atr_id ON tarifa (atr_id);

-- Reseñas con desglose de 4 pilares
CREATE TABLE resena (
    ren_id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id              BIGINT        NOT NULL,
    ren_autor_nombre    VARCHAR(120)  NOT NULL,
    ren_comentario      VARCHAR(1000) NOT NULL,
    ren_puntuacion      NUMERIC(3,1)  NOT NULL CHECK (ren_puntuacion BETWEEN 1 AND 10),
    ren_limpieza        NUMERIC(3,1)  NOT NULL DEFAULT 10.0 CHECK (ren_limpieza BETWEEN 1 AND 10),
    ren_servicio        NUMERIC(3,1)  NOT NULL DEFAULT 10.0 CHECK (ren_servicio BETWEEN 1 AND 10),
    ren_calidad_precio  NUMERIC(3,1)  NOT NULL DEFAULT 10.0 CHECK (ren_calidad_precio BETWEEN 1 AND 10),
    ren_puntualidad     NUMERIC(3,1)  NOT NULL DEFAULT 10.0 CHECK (ren_puntualidad BETWEEN 1 AND 10),
    ren_visible         BOOLEAN       NOT NULL DEFAULT TRUE,
    ren_creado_en       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_resena_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE
);
CREATE INDEX ix_resena_atr_id ON resena (atr_id);


-- ============================================================================
--  MICROSERVICIO 2: INVENTARIO, DISPONIBILIDAD Y TURNOS (MS_INVENTORY)
--  Tecnologías:
--    1. gRPC sobre HTTP/2 (Puerto 50051) -> Ingesta bidireccional y continua
--       de cupos remanentes hacia Booking Prototipo (InventoryStockService).
--    2. REST HTTP/JSON -> Consulta de franjas horarias (GET /availability).
-- ============================================================================

-- Horarios o turnos base (plantilla)
CREATE TABLE horario (
    hor_id          BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id          BIGINT      NOT NULL,
    hor_hora        TIME        NOT NULL,            -- Ej: 10:30:00
    hor_hora_texto  VARCHAR(20) NOT NULL,            -- Ej: "10:30 a.m."
    hor_cupo_base   INTEGER     NOT NULL DEFAULT 25,
    hor_activo      BOOLEAN     NOT NULL DEFAULT TRUE,
    CONSTRAINT horario_cupo_positivo CHECK (hor_cupo_base > 0),
    CONSTRAINT uq_horario_atraccion_hora UNIQUE (atr_id, hor_hora),
    CONSTRAINT fk_horario_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE
);
CREATE INDEX ix_horario_atr_id ON horario (atr_id);

-- Franjas horarias operativas e inventario en tiempo real (TimeSlotItem)
CREATE TABLE disponibilidad (
    dis_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    dis_slot_id         VARCHAR(50) NOT NULL UNIQUE,     -- Ej: "slot-20261025-1030"
    atr_id              BIGINT      NOT NULL,
    hor_id              BIGINT      NOT NULL,
    dis_fecha           DATE        NOT NULL,
    dis_hora            TIME        NOT NULL,
    dis_hora_texto      VARCHAR(20) NOT NULL,            -- Ej: "10:30 a.m."
    dis_cupo_total      INTEGER     NOT NULL,
    dis_cupo_reservado  INTEGER     NOT NULL DEFAULT 0,
    -- Columna computada de cupos disponibles
    dis_cupos_disponibles INTEGER   GENERATED ALWAYS AS (dis_cupo_total - dis_cupo_reservado) STORED,
    dis_estado          VARCHAR(20) NOT NULL DEFAULT 'DISPONIBLE', -- DISPONIBLE, ULTIMOS_CUPOS, AGOTADO
    dis_cerrada         BOOLEAN     NOT NULL DEFAULT FALSE,
    dis_version_bloqueo BIGINT      NOT NULL DEFAULT 1,  -- Concurrencia optimista
    dis_actualizado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_disponibilidad_slot UNIQUE (atr_id, dis_fecha, hor_id),
    CONSTRAINT disponibilidad_cupos_validos CHECK (dis_cupo_total > 0 AND dis_cupo_reservado >= 0 AND dis_cupo_reservado <= dis_cupo_total),
    CONSTRAINT disponibilidad_estado_valido CHECK (dis_estado IN ('DISPONIBLE', 'ULTIMOS_CUPOS', 'AGOTADO')),
    CONSTRAINT fk_disponibilidad_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE,
    CONSTRAINT fk_disponibilidad_horario FOREIGN KEY (hor_id) REFERENCES horario (hor_id) ON DELETE CASCADE
);
CREATE INDEX ix_disponibilidad_consulta ON disponibilidad (atr_id, dis_fecha, dis_estado);
CREATE INDEX ix_disponibilidad_slot_id ON disponibilidad (dis_slot_id);

CREATE TABLE fecha_bloqueada (
    fb_id       BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    atr_id      BIGINT       NOT NULL,
    fb_fecha    DATE         NOT NULL,
    fb_motivo   VARCHAR(200) NOT NULL,
    fb_creado_en TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_fecha_bloqueada_atraccion_fecha UNIQUE (atr_id, fb_fecha),
    CONSTRAINT fk_fecha_bloqueada_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE CASCADE
);
CREATE INDEX ix_fecha_bloqueada_atr_id ON fecha_bloqueada (atr_id);


-- ============================================================================
--  MICROSERVICIO 3: RESERVAS, SAGAS Y CHECK-IN PRESENCIAL (MS_BOOKING_CHECKIN)
--  Tecnologías:
--    1. RESTful HTTP/JSON: POST /atracciones/reservas (201 Created / 409 Conflict),
--       POST /reservas/{id}/cancel (Rollback Saga LIFO), POST /checkin.
--    2. SOA / EDA (Event-Driven Architecture): Transactional Outbox Pattern
--       en GET /atracciones/eventos hacia Apache Kafka y RabbitMQ.
-- ============================================================================

-- Tabla de idempotencia M2M para peticiones de agregadores y gateways
CREATE TABLE idempotencia_m2m (
    idem_clave          UUID         PRIMARY KEY,        -- Cabecera Idempotency-Key
    idem_client_id      VARCHAR(100) NOT NULL,           -- Identificador del nodo o Gateway
    idem_operacion      VARCHAR(150) NOT NULL,           -- Ej: "POST /atracciones/reservas"
    idem_request_hash   VARCHAR(64)  NOT NULL,           -- Hash SHA-256 del payload
    idem_estado         VARCHAR(15)  NOT NULL DEFAULT 'IN_PROGRESS', -- IN_PROGRESS, DONE, FAILED
    idem_http_code      INTEGER,                         -- 201, 409, 400
    idem_response_body  JSONB,                           -- Caché de respuesta idéntica
    idem_expira_en      TIMESTAMPTZ  NOT NULL,           -- TTL 24 horas
    idem_creado_en      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT idempotencia_estado_valido CHECK (idem_estado IN ('IN_PROGRESS', 'DONE', 'FAILED'))
);
CREATE INDEX ix_idempotencia_m2m_expira ON idempotencia_m2m (idem_expira_en);

-- Registro Canónico de Reservas y Transacciones Distribuidas (Sagas)
CREATE TABLE reserva (
    res_id                  BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_uuid                UUID          NOT NULL UNIQUE DEFAULT gen_random_uuid(), -- ID público (reservation_id)
    res_codigo              VARCHAR(16)   NOT NULL UNIQUE, -- Localizador PNR amigable (ej: "DEC-7F3K9Q")
    
    -- Correlación con agregador externo Booking Prototipo (MANDATO OBLIGATORIO)
    external_order_id       VARCHAR(64)   NOT NULL,        -- Conciliación Booking (ej: "ORD-DILAN-8721")
    saga_id                 VARCHAR(64),                   -- ID de Saga distribuida (ej: "SAGA-7K2X9M")
    
    -- Referencias de producto e inventario (desacopladas para microservicios)
    atr_id                  BIGINT        NOT NULL,
    dis_id                  BIGINT        NOT NULL,
    
    -- Estado canónico de ciclo de vida
    res_estado              VARCHAR(20)   NOT NULL DEFAULT 'CONFIRMED', -- CONFIRMED, CHECKED_IN, CANCELLED
    
    -- Coordenadas de fecha y franja horaria
    res_fecha               DATE          NOT NULL,
    res_hora                VARCHAR(20)   NOT NULL,        -- Ej: "10:30 a.m."
    
    -- Desglose por los 4 grupos etarios del contrato
    res_adultos             INTEGER       NOT NULL DEFAULT 1,
    res_ninos               INTEGER       NOT NULL DEFAULT 0,
    res_seniors             INTEGER       NOT NULL DEFAULT 0,
    res_infantes            INTEGER       NOT NULL DEFAULT 0,
    res_numero_tickets      INTEGER       NOT NULL,
    
    -- Importes liquidados
    res_precio_unitario     dom_importe   NOT NULL,
    res_total_price         dom_importe   NOT NULL,
    res_moneda              dom_moneda    NOT NULL DEFAULT 'USD',
    
    -- Datos del Titular (CustomerContactDto)
    res_titular_nombre      VARCHAR(150)  NOT NULL,
    res_titular_email       dom_correo    NOT NULL,
    res_titular_telefono    dom_telefono  NOT NULL,
    res_titular_tipo_doc    VARCHAR(20)   NOT NULL DEFAULT 'CEDULA', -- CEDULA, PASAPORTE, RUC
    res_titular_documento   VARCHAR(20)   NOT NULL,
    
    -- Operación y Logística
    res_guia_asignado       VARCHAR(150)  NOT NULL DEFAULT 'Lic. Carlos Morales (Credencial Mintur #5541)',
    res_punto_encuentro     VARCHAR(255)  NOT NULL,
    res_metodo_pago         VARCHAR(30)   NOT NULL DEFAULT 'SOA_BOOKING_GATEWAY',
    res_requerimientos_esp  TEXT,
    
    -- Vouchers digitales y calendario
    res_voucher_qr_payload  TEXT          NOT NULL,
    res_voucher_qr_url      VARCHAR(500),
    res_ics_calendar_url    VARCHAR(500),
    
    -- Check-in Presencial en Punto de Encuentro (MANDATO RDA2 §4)
    res_checkin_en          TIMESTAMPTZ,
    res_checkin_guia_codigo VARCHAR(50),
    res_checkin_device_id   VARCHAR(50),
    res_pase_abordar_qr     VARCHAR(500),
    
    -- Compensación Saga y cancelación
    res_motivo_cancelacion  VARCHAR(255),
    res_solicitante_cancel  VARCHAR(30),  -- CLIENTE, SAGA_ORCHESTRATOR, ADMIN
    res_cancelado_en        TIMESTAMPTZ,
    
    res_creado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    res_actualizado_en      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    
    CONSTRAINT reserva_conteo_tickets_valido CHECK (
        res_adultos >= 1 AND res_ninos >= 0 AND res_seniors >= 0 AND res_infantes >= 0
        AND res_numero_tickets = (res_adultos + res_ninos + res_seniors + res_infantes)
    ),
    CONSTRAINT reserva_estado_valido CHECK (res_estado IN ('CONFIRMED', 'CHECKED_IN', 'CANCELLED')),
    CONSTRAINT fk_reserva_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE RESTRICT,
    CONSTRAINT fk_reserva_disponibilidad FOREIGN KEY (dis_id) REFERENCES disponibilidad (dis_id) ON DELETE RESTRICT
);
CREATE INDEX ix_reserva_codigo ON reserva (res_codigo);
CREATE INDEX ix_reserva_external_order_id ON reserva (external_order_id);
CREATE INDEX ix_reserva_saga_id ON reserva (saga_id);
CREATE INDEX ix_reserva_fecha_hora ON reserva (res_fecha, res_hora);
CREATE INDEX ix_reserva_estado ON reserva (res_estado);

-- Acompañantes y Pasajeros individuales (PassengerItem)
CREATE TABLE reserva_pasajero (
    pax_id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    res_id           BIGINT       NOT NULL,
    pax_nombre       VARCHAR(150) NOT NULL,
    pax_documento    VARCHAR(20),
    pax_tipo_ticket  VARCHAR(20)  NOT NULL, -- ADULT, CHILD, SENIOR, INFANT
    pax_es_titular   BOOLEAN      NOT NULL DEFAULT FALSE,
    CONSTRAINT pax_tipo_ticket_valido CHECK (pax_tipo_ticket IN ('ADULT', 'CHILD', 'SENIOR', 'INFANT')),
    CONSTRAINT fk_reserva_pasajero_reserva FOREIGN KEY (res_id) REFERENCES reserva (res_id) ON DELETE CASCADE
);
CREATE INDEX ix_reserva_pasajero_res_id ON reserva_pasajero (res_id);

-- Tabla de Eventos Outbox (Patrón Transactional Outbox para EDA)
-- Alimenta el endpoint GET /atracciones/eventos y streaming a RabbitMQ / Kafka
CREATE TABLE outbox_evento (
    evt_id           BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY, -- sequence_number monótono para cursor 'after'
    evt_uuid         UUID         NOT NULL DEFAULT gen_random_uuid(),
    evt_tipo         VARCHAR(50)  NOT NULL, -- RESERVA_CREADA, RESERVA_CONFIRMADA, STOCK_ACTUALIZADO, RESERVA_CANCELADA
    evt_aggregate_id VARCHAR(64)  NOT NULL, -- Código PNR o ID de atracción
    evt_correlation_id VARCHAR(100),
    evt_payload      JSONB        NOT NULL,
    evt_creado_en    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    evt_publicado    BOOLEAN      NOT NULL DEFAULT FALSE,
    evt_publicado_en TIMESTAMPTZ
);
CREATE INDEX ix_outbox_cursor ON outbox_evento (evt_id);
CREATE INDEX ix_outbox_pendientes ON outbox_evento (evt_publicado) WHERE NOT evt_publicado;


-- ============================================================================
--  MICROSERVICIO 4: ALIANZAS Y PROMOCIONES COMERCIALES B2B (MS_PROMOTIONS_B2B)
--  Tecnología: RESTful HTTP/JSON
--  Descripción: Formaliza el mandato de la cátedra (Consideraciones RDA2 pág. 149):
--               Cuestionario de una sola vez sobre aceptación de combos y
--               porcentaje máximo de descuento acordado con Booking Prototipo.
-- ============================================================================

CREATE TABLE acuerdo_promocion_b2b (
    prb_id                      INTEGER      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    prb_proveedor_id            VARCHAR(60)  NOT NULL UNIQUE, -- Ej: "proveedor-atracciones-dilan"
    prb_nombre_comercial        VARCHAR(120) NOT NULL DEFAULT 'TourGirls Tours & Experiences',
    prb_permite_promociones     BOOLEAN      NOT NULL DEFAULT TRUE,
    prb_porcentaje_descuento_maximo NUMERIC(5,2) NOT NULL DEFAULT 15.00,
    prb_destinos_habilitados    JSONB        NOT NULL DEFAULT '["Quito", "Baños", "Cuenca", "Galápagos"]'::jsonb,
    prb_fecha_acuerdo           DATE         NOT NULL DEFAULT CURRENT_DATE,
    prb_vigencia_hasta          DATE         NOT NULL DEFAULT '2027-12-31',
    prb_condiciones_combo       TEXT         DEFAULT 'Aplica en paquetes multidominio combinados con al menos 48h de anticipación.',
    prb_contacto_nombre         VARCHAR(120) DEFAULT 'Dilan Mendoza',
    prb_contacto_email          dom_correo   DEFAULT 'dilan.mendoza@tourgirls.com',
    prb_contacto_telefono       dom_telefono DEFAULT '+593998765432',
    prb_actualizado_en          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT prb_descuento_valido CHECK (prb_porcentaje_descuento_maximo BETWEEN 0 AND 50)
);


-- ============================================================================
--  MICROSERVICIO 5: IDENTIDAD, FACTURACIÓN Y E-COMMERCE B2C (MS_CORE_ECOMMERCE)
--  Tecnologías:
--    1. REST HTTP/JSON: Checkout local web/móvil para venta directa.
--    2. SOA / SOAP XML (Facturación SRI): Generación de comprobante tributario
--       electrónico con clave de acceso de 49 dígitos para el SRI del Ecuador.
-- ============================================================================

CREATE TABLE rol (
    rol_id          SMALLINT     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rol_nombre      VARCHAR(30)  NOT NULL UNIQUE,
    rol_descripcion VARCHAR(200) NOT NULL,
    rol_activo      BOOLEAN      NOT NULL DEFAULT TRUE
);

CREATE TABLE usuario (
    usu_id          BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_correo      dom_correo    NOT NULL UNIQUE,
    usu_password    VARCHAR(100)  NOT NULL,
    usu_nombre      VARCHAR(120)  NOT NULL,
    usu_apellido    VARCHAR(120)  NOT NULL,
    usu_documento   dom_documento UNIQUE,
    usu_telefono    dom_telefono,
    usu_activo      BOOLEAN       NOT NULL DEFAULT TRUE,
    usu_creado_en   TIMESTAMPTZ   NOT NULL DEFAULT now(),
    usu_actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuario_rol (
    usu_id       BIGINT   NOT NULL,
    rol_id       SMALLINT NOT NULL,
    CONSTRAINT pk_usuario_rol PRIMARY KEY (usu_id, rol_id),
    CONSTRAINT fk_usuario_rol_usuario FOREIGN KEY (usu_id) REFERENCES usuario (usu_id) ON DELETE CASCADE,
    CONSTRAINT fk_usuario_rol_rol FOREIGN KEY (rol_id) REFERENCES rol (rol_id) ON DELETE RESTRICT
);

CREATE TABLE dato_facturacion (
    dfa_id                  BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    usu_id                  BIGINT        NOT NULL,
    dfa_tipo_identificacion tipo_identificacion_fiscal NOT NULL DEFAULT 'CEDULA',
    dfa_identificacion      VARCHAR(20)   NOT NULL,
    dfa_razon_social        VARCHAR(150)  NOT NULL,
    dfa_correo              dom_correo    NOT NULL,
    dfa_telefono            dom_telefono,
    dfa_direccion           VARCHAR(255)  NOT NULL,
    dfa_creado_en           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_dato_facturacion_usuario FOREIGN KEY (usu_id) REFERENCES usuario (usu_id) ON DELETE CASCADE
);

CREATE TABLE orden (
    ord_id              BIGINT        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_numero          VARCHAR(25)   NOT NULL UNIQUE,
    usu_id              BIGINT        NOT NULL,
    ord_estado          VARCHAR(20)   NOT NULL DEFAULT 'CREADA',
    ord_subtotal        dom_importe   NOT NULL DEFAULT 0,
    ord_descuento       dom_importe   NOT NULL DEFAULT 0,
    ord_iva             dom_importe   NOT NULL DEFAULT 0,
    ord_total           dom_importe   NOT NULL DEFAULT 0,
    ord_moneda          dom_moneda    NOT NULL DEFAULT 'USD',
    ord_fecha           TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT fk_orden_usuario FOREIGN KEY (usu_id) REFERENCES usuario (usu_id) ON DELETE RESTRICT
);
CREATE INDEX ix_orden_usu_id ON orden (usu_id);

CREATE TABLE orden_detalle (
    det_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id              BIGINT      NOT NULL,
    atr_id              BIGINT      NOT NULL,
    det_descripcion     VARCHAR(255) NOT NULL,
    det_cantidad        INTEGER     NOT NULL,
    det_precio_unitario dom_importe NOT NULL,
    det_subtotal        dom_importe NOT NULL,
    CONSTRAINT fk_orden_detalle_orden FOREIGN KEY (ord_id) REFERENCES orden (ord_id) ON DELETE CASCADE,
    CONSTRAINT fk_orden_detalle_atraccion FOREIGN KEY (atr_id) REFERENCES atraccion (atr_id) ON DELETE RESTRICT
);

CREATE TABLE pago (
    pag_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pag_numero          VARCHAR(35) NOT NULL UNIQUE,
    ord_id              BIGINT      NOT NULL,
    pag_monto           dom_importe NOT NULL,
    pag_estado          VARCHAR(20) NOT NULL DEFAULT 'APROBADO',
    pag_referencia      VARCHAR(100),
    pag_fecha           TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_pago_orden FOREIGN KEY (ord_id) REFERENCES orden (ord_id) ON DELETE CASCADE
);

-- Facturación Electrónica SRI (SOA XML/XAdES)
CREATE TABLE factura (
    fac_id              BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ord_id              BIGINT      NOT NULL UNIQUE,
    fac_numero          VARCHAR(20) NOT NULL UNIQUE,
    fac_clave_acceso    VARCHAR(49),                -- Clave de acceso de 49 dígitos del SRI
    fac_autorizacion_sri VARCHAR(49),
    fac_estado          VARCHAR(20) NOT NULL DEFAULT 'AUTORIZADA',
    fac_subtotal        dom_importe NOT NULL,
    fac_iva             dom_importe NOT NULL DEFAULT 0,
    fac_total           dom_importe NOT NULL,
    fac_razon_social    VARCHAR(150),
    fac_ruc             dom_ruc,
    fac_emitida_en      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT fk_factura_orden FOREIGN KEY (ord_id) REFERENCES orden (ord_id) ON DELETE RESTRICT
);

CREATE TABLE factura_detalle (
    fde_id              BIGINT         GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fac_id              BIGINT         NOT NULL,
    fde_codigo          VARCHAR(25)    NOT NULL,
    fde_descripcion     VARCHAR(300)   NOT NULL,
    fde_cantidad        INTEGER        NOT NULL,
    fde_precio_unitario dom_importe    NOT NULL,
    fde_subtotal        dom_importe    NOT NULL,
    fde_iva             dom_importe    NOT NULL DEFAULT 0,
    fde_total           dom_importe    NOT NULL,
    CONSTRAINT fk_factura_detalle_factura FOREIGN KEY (fac_id) REFERENCES factura (fac_id) ON DELETE CASCADE
);


-- ============================================================================
--  MICROSERVICIO 6: TELEMETRÍA Y OBSERVABILIDAD DE NODO (MS_OBSERVABILITY)
--  Tecnología: REST HTTP/JSON
--  Descripción: Alimenta el endpoint GET /atracciones/health para el semáforo
--               del monitor de nodos de Booking Prototipo (🟢 UP, 🟡 DEGRADED, 🔴 DOWN).
-- ============================================================================

CREATE TABLE nodo_telemetria_log (
    tel_id              BIGINT       GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tel_node_id         VARCHAR(50)  NOT NULL DEFAULT 'node-tourgirls-atracciones-01',
    tel_node_code       VARCHAR(50)  NOT NULL DEFAULT 'TOURGIRLS_ATRACCIONES',
    tel_version         VARCHAR(20)  NOT NULL DEFAULT '2.0.0',
    tel_status          VARCHAR(15)  NOT NULL DEFAULT 'UP', -- UP, DEGRADED, DOWN
    tel_latency_ms      INTEGER      NOT NULL DEFAULT 15,
    tel_memory_usage_mb NUMERIC(6,2) NOT NULL DEFAULT 128.5,
    tel_uptime_seconds  BIGINT       NOT NULL DEFAULT 86400,
    tel_database_ok     BOOLEAN      NOT NULL DEFAULT TRUE,
    tel_timestamp       TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX ix_nodo_telemetria_time ON nodo_telemetria_log (tel_timestamp DESC);


-- ============================================================================
--  TRIGGERS DE ACTUALIZACIÓN AUTOMÁTICA DE TIMESTAMP
-- ============================================================================

CREATE OR REPLACE FUNCTION fn_actualizar_timestamp_v2()
RETURNS TRIGGER AS $$
BEGIN
    NEW := jsonb_populate_record(NEW, jsonb_build_object(TG_ARGV[0], now()));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
    par TEXT[];
BEGIN
    FOREACH par SLICE 1 IN ARRAY ARRAY[
        ['operador',              'ope_actualizado_en'],
        ['atraccion',             'atr_actualizado_en'],
        ['disponibilidad',        'dis_actualizado_en'],
        ['reserva',               'res_actualizado_en'],
        ['acuerdo_promocion_b2b', 'prb_actualizado_en'],
        ['usuario',               'usu_actualizado_en']
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_%s_act BEFORE UPDATE ON %I
             FOR EACH ROW EXECUTE FUNCTION fn_actualizar_timestamp_v2(%L)',
            par[1], par[1], par[2]);
    END LOOP;
END $$;


-- ============================================================================
--  DATOS SEMILLA (SEEDS) INICIALES
-- ============================================================================

-- Regiones y Provincias
INSERT INTO region (reg_nombre, reg_codigo) VALUES
    ('SIERRA', 'SI'), ('COSTA', 'CO'), ('AMAZONIA', 'AM'), ('GALAPAGOS', 'GA');

INSERT INTO provincia (prov_nombre, prov_codigo, reg_id) VALUES
    ('Pichincha',  '19', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Tungurahua', '23', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Azuay',      '01', (SELECT reg_id FROM region WHERE reg_codigo='SI')),
    ('Galápagos',  '09', (SELECT reg_id FROM region WHERE reg_codigo='GA'));

INSERT INTO ciudad (ciu_nombre, ciu_codigo, prov_id) VALUES
    ('Quito',  '170150', (SELECT prov_id FROM provincia WHERE prov_nombre='Pichincha')),
    ('Baños',  '180150', (SELECT prov_id FROM provincia WHERE prov_nombre='Tungurahua')),
    ('Cuenca', '010100', (SELECT prov_id FROM provincia WHERE prov_nombre='Azuay'));

-- Operador oficial de Dilan Mendoza
INSERT INTO operador (ope_codigo, ope_nombre, ope_ruc, ope_correo, ope_telefono, prov_id) VALUES
    (101, 'TourGirls Tours & Experiences', '1792348123001', 'soporte@tourgirls.com', '+593991234567',
     (SELECT prov_id FROM provincia WHERE prov_nombre='Pichincha'));

-- Categorías con BANDERAS OBLIGATORIAS de cátedra
INSERT INTO categoria (cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden, cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia) VALUES
    ('Tours y Experiencias Guiadas', 'tours-experiencias', 'Recorridos guiados por la ciudad y patrimonio.', 'compass', 1, FALSE, TRUE, TRUE),
    ('Aventura Extrema y Naturaleza', 'aventura-extrema', 'Deportes de aventura y senderismo.', 'mountain', 2, TRUE, TRUE, TRUE),
    ('Cultura y Museos', 'cultura-museos', 'Entradas directas a centros históricos y museos.', 'landmark', 3, FALSE, FALSE, FALSE);

-- Subcategoría hija de Tours Gastronómicos
INSERT INTO categoria (cat_padre_id, cat_nombre, cat_slug, cat_descripcion, cat_icono, cat_orden, cat_incluye_comida, cat_incluye_transporte, cat_incluye_guia) VALUES
    (1, 'Tours Gastronómicos y Catas', 'tours-gastronomicos', 'Degustaciones de comida típica y cacao fino.', 'utensils', 1, TRUE, FALSE, TRUE);

-- Idiomas
INSERT INTO idioma (idi_codigo, idi_nombre) VALUES
    ('es', 'Español'), ('en', 'Inglés'), ('fr', 'Francés');

-- Inclusiones
INSERT INTO inclusion (inc_tipo, inc_nombre, inc_orden) VALUES
    ('INCLUYE', 'Transporte turístico panorámico ida y vuelta', 1),
    ('INCLUYE', 'Guía oficial certificado bilingüe', 2),
    ('INCLUYE', 'Degustación guiada de chocolate fino de aroma', 3),
    ('NO_INCLUYE', 'Propinas voluntarias', 1),
    ('RECOMENDACION', 'Llevar ropa cómoda y protector solar', 1);

-- Atracción principal de ejemplo: "Quito City Bus Tour & Mitad del Mundo Oficial"
INSERT INTO atraccion (
    atr_uuid, atr_codigo_publico, atr_nombre, atr_slug, atr_descripcion, atr_descripcion_corta,
    atr_tipo, atr_estado, atr_latitud, atr_longitud, atr_direccion,
    atr_punto_encuentro, atr_meeting_point_latitud, atr_meeting_point_longitud,
    atr_arrival_instructions, atr_google_maps_url, atr_duracion_horas,
    prov_id, ciu_id, ope_id, atr_cancelacion_gratuita, atr_horas_cancelacion,
    atr_accesible_silla_ruedas, atr_accesible_coche_bebe, atr_admite_animales_asistencia,
    atr_permite_paquete, atr_porcentaje_descuento_paquete,
    atr_calificacion_promedio, atr_score_limpieza, atr_score_servicio, atr_score_calidad_precio, atr_score_puntualidad, atr_numero_resenas
) VALUES (
    'a1b2c3d4-e5f6-7890-1234-567890abcdef',
    'PRhu4UBTWPBC',
    'Quito City Bus Tour & Mitad del Mundo Oficial',
    'quito-city-bus-tour-mitad-del-mundo',
    'Disfruta de la mejor experiencia turística de la capital ecuatoriana en bus panorámico con guía bilingüe certificado.',
    'Recorrido de dos pisos por el Centro Histórico y la Ciudad Mitad del Mundo.',
    'GUIDED_TOUR',
    'PUBLICADA',
    -0.178652, -78.483120,
    'Boulevard Naciones Unidas y Av. Shyris, Quito',
    'Boulevard Naciones Unidas y Av. Shyris (Parada Quinde)',
    -0.178652, -78.483120,
    'Presentarse con 15 minutos de anticipación junto al totem informativo rojo de TourGirls.',
    'https://maps.google.com/?q=-0.178652,-78.483120',
    7.00,
    (SELECT prov_id FROM provincia WHERE prov_nombre='Pichincha'),
    (SELECT ciu_id FROM ciudad WHERE ciu_nombre='Quito'),
    1,
    TRUE, 24,
    TRUE, TRUE, TRUE,
    TRUE, 15.00,
    9.8, 9.9, 9.8, 9.6, 9.7, 1250
);

-- Itinerario cronológico de la atracción
INSERT INTO atraccion_itinerario (atr_id, iti_stop_number, iti_time, iti_title, iti_description, iti_duration_min, iti_lugar_nombre) VALUES
    (1, 1, '09:00 a.m.', 'Punto de encuentro y salida', 'Recepción de pasajeros, verificación de vouchers QR y bienvenida.', 30, 'Boulevard Naciones Unidas'),
    (1, 2, '10:00 a.m.', 'Recorrido Centro Histórico', 'Visita panorámica a la Basílica del Voto Nacional y Plaza Grande.', 90, 'Centro Histórico de Quito'),
    (1, 3, '12:30 p.m.', 'Monumento a la Mitad del Mundo', 'Experimentos de gravedad en la línea ecuatorial y museo de sitio.', 120, 'Ciudad Mitad del Mundo');

-- Tarifas desglosadas por las 4 categorías
INSERT INTO tarifa (atr_id, tar_tipo, tar_precio, tar_vigente_desde) VALUES
    (1, 'ADULT',   30.00, CURRENT_DATE),
    (1, 'CHILD',   15.00, CURRENT_DATE),
    (1, 'SENIOR',  18.00, CURRENT_DATE),
    (1, 'INFANT',   0.00, CURRENT_DATE);

-- Horarios base
INSERT INTO horario (atr_id, hor_hora, hor_hora_texto, hor_cupo_base) VALUES
    (1, '09:00:00', '09:00 a.m.', 25),
    (1, '10:30:00', '10:30 a.m.', 25),
    (1, '14:00:00', '02:00 p.m.', 20);

-- Disponibilidad para fecha modelo (2026-10-25)
INSERT INTO disponibilidad (dis_slot_id, atr_id, hor_id, dis_fecha, dis_hora, dis_hora_texto, dis_cupo_total, dis_cupo_reservado, dis_estado) VALUES
    ('slot-20261025-0900', 1, 1, '2026-10-25', '09:00:00', '09:00 a.m.', 25, 5, 'DISPONIBLE'),
    ('slot-20261025-1030', 1, 2, '2026-10-25', '10:30:00', '10:30 a.m.', 25, 17, 'DISPONIBLE'),
    ('slot-20261025-1400', 1, 3, '2026-10-25', '14:00:00', '02:00 p.m.', 20, 18, 'ULTIMOS_CUPOS');

-- Cuestionario de Promociones B2B pactado (Consideraciones RDA2 pág. 149)
INSERT INTO acuerdo_promocion_b2b (
    prb_proveedor_id, prb_nombre_comercial, prb_permite_promociones,
    prb_porcentaje_descuento_maximo, prb_destinos_habilitados, prb_vigencia_hasta
) VALUES (
    'proveedor-atracciones-dilan',
    'TourGirls',
    TRUE,
    15.00,
    '["Quito", "Baños", "Cuenca", "Galápagos"]'::jsonb,
    '2027-12-31'
);

-- Estado de telemetría inicial para el monitor de nodos
INSERT INTO nodo_telemetria_log (tel_node_id, tel_node_code, tel_status, tel_latency_ms) VALUES
    ('node-tourgirls-atracciones-01', 'TOURGIRLS_ATRACCIONES', 'UP', 18);
