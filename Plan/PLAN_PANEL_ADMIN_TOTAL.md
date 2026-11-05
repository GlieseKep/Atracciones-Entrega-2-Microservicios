# Plan · Administrar más datos desde el panel

| | |
|---|---|
| Fecha | 2026-11-05 |
| Origen | Segunda auditoría del panel, ajustada con las respuestas del usuario |
| Base | Lectura de `AtraccionesService-web/src/pages/admin`, `src/api/admin.ts`, `apps/graphql/src/operations.ts`, los servicios y los SQL de `Plan/ms_*` |
| Estado | Programado (pasos 1 a 3 de la sección 6). Solo se compiló: nada se probó en ejecución. Falta desplegar y comprobar |

## 1. Resumen

El panel ya cubre lo operativo: reservas, pedidos, pagos, facturas, reseñas, horarios y tarifas. Este plan añade tres secciones nuevas y amplía las existentes.

| Sección nueva | Hoy en el panel | Hoy en el backend |
|---|---|---|
| Qué incluye | Solo marcarlos en el editor | Se puede crear; no se puede eliminar |
| Categorías | Solo marcarlas en el editor | Se puede crear y editar; el panel no lo usa |
| Idiomas | Solo marcarlos en el editor | Solo lectura |

## 2. Qué se agrega al panel

### 2.1 Secciones nuevas

**Qué incluye** (`/admin/incluye`)
- Lista de lo que puede incluir una atracción, por ejemplo «Almuerzo típico», «Seguro» o «Fotos del recorrido».
- **Agregar** uno nuevo y **quitarlo solo si ninguna atracción lo usa**. La lista muestra cuántas atracciones usan cada uno; si alguna lo usa, no se puede quitar.
- **Alimentación, transporte y guía** aparecen en la lista como fijos, sin opción de quitar, porque son banderas del contrato v3.

**En el editor de atracción**
- Todo se ve como casillas de lo que sí incluye: las tres fijas y las nuevas, en un solo grupo.
- Marcar una de las fijas guarda la bandera (`includes_food`, `includes_transport`, `includes_guide`).
- Marcar una nueva la guarda en `atraccion_inclusion`, y llega al portal y a Booking en `inclusions_list`, que ya existe en el contrato. El contrato no cambia.

**Categorías** (`/admin/categorias`)
- Árbol de categorías y subcategorías.
- Crear, editar nombre, descripción, icono y orden; activar o desactivar.
- Marcar sus banderas de comida, transporte y guía.
- El slug y la categoría padre no se editan después de crear.

**Idiomas** (`/admin/idiomas`)
- Crear, renombrar y quitar si ninguna atracción lo usa.

### 2.2 Secciones existentes que se amplían

| Sección | Se agrega | Backend |
|---|---|---|
| Catálogo, editor | Texto alternativo por foto (hoy se genera solo) y ordenar fotos | Ya lo acepta |
| Catálogo, tarifas | Historial de tarifas | `pricingListTariffs` ya existe |
| Usuarios | Editar nombre, apellido y teléfono | Falta la ruta |
| Usuarios | Enviar correo para restablecer la contraseña | Ya existe la recuperación pública |
| Socios | Renombrar y regenerar la clave | Faltan las rutas |
| Guías y operadores | Ver los usuarios vinculados y elegirlos con un buscador en lugar de escribir el ID | Falta listar los vínculos; el buscador usa `identityListUsers` |
| Cupones | Editar tipo y valor (hoy solo fechas, usos y activo) | Ampliar el PATCH; no cambia órdenes ya pagadas |

### 2.3 Lo que se queda como está

| Dato | Motivo |
|---|---|
| Ubicaciones (regiones, provincias, ciudades) | Decidido por el usuario. Ver la nota de abajo |
| Preguntas frecuentes y fotos de portada | Decidido por el usuario |
| IVA, RUC y razón social | Decidido por el usuario: siguen como variables de entorno |
| Slug y categoría padre tras crear | Decidido por el usuario |
| Métodos de pago | Decidido por el usuario |
| Tipos de atracción, estados y roles | El contrato o el código dependen de esos nombres |
| Órdenes, pagos y facturas | Son registros contables: se corrigen con cancelación o reembolso |

**Nota sobre ubicaciones:** la ciudad no se calcula con la latitud y la longitud. En el editor se elige de una lista (`ciu_id`), y la latitud y la longitud solo guardan el punto de encuentro. Una ciudad que no esté en `ms_location` no se puede elegir, y agregarla sigue requiriendo SQL.

## 3. Cambios de backend

| Servicio | Cambio |
|---|---|
| ms-catalog | `GET /inclusiones` con el número de atracciones que usan cada una; `DELETE /inclusiones/:id`, que responde 409 `INCLUSION_IN_USE` si alguna la usa; `POST`, `PATCH` y `DELETE /idiomas`; listado de categorías con las inactivas; listado de usuarios de un operador |
| ms-identity | Editar datos de un usuario; renombrar socio y regenerar clave |
| ms-coupon | Tipo y valor en el PATCH |
| ESB y GraphQL | Registrar cada operación nueva en `esb-routes.ts` y `operations.ts`, sin caché para lo que lee el panel |
| Documentación | OpenAPI y SQL de cada servicio, más sus migraciones |

## 4. Detalles que hay que resolver al programar

1. **Otros tipos de la tabla `inclusion`.** También guarda `NO_INCLUYE` y `RECOMENDACION`. La sección nueva solo maneja `INCLUYE`, y el editor debe conservar los otros ya marcados al guardar, aunque no los muestre: `NO_INCLUYE` sigue llegando en `exclusions_list`.
2. **Quitar de forma segura.** La clave foránea borra en cascada, así que sin comprobar se quitaría de las atracciones sin avisar. La comprobación y el borrado van en la misma transacción. Una atracción eliminada (borrado lógico) no cuenta como uso. Con idiomas se hace lo mismo.
3. **Nombres repetidos.** Se debe avisar al escribir «Alimentación», «Transporte» o «Guía», para no duplicar las fijas. Los demás ya los rechaza la restricción única.
4. **Cachés.** GraphQL guarda idiomas e inclusiones 5 minutos y categorías 1 minuto. El panel debe ver lo creado al momento; en el portal puede tardar esos minutos.
5. **Caché de la Partner API.** Se invalida con eventos `catalog.*`, y no encontré eventos publicados en ms-catalog. Un cambio de categoría puede tardar en llegar a Booking. Conviene comprobarlo en ejecución.

## 5. Decisiones

| # | Tema | Estado |
|---|---|---|
| D1 | Qué incluye | **Decidido:** sección propia para agregar y quitar si no se usa; en la atracción, casillas de lo que sí incluye |
| D2 | Bitácora de estos cambios | **Decidido:** no se incluye ahora. Ninguno de estos cambios queda en la bitácora, tampoco los de usuarios y socios |
| D3 | Preguntas frecuentes y portada | **Decidido:** no se tocan |
| D4 | IVA y datos fiscales | **Decidido:** no van al panel |
| D5 | Slug y categoría padre | **Decidido:** no se tocan |
| D6 | Métodos de pago | **Decidido:** no se tocan |
| D7 | Ubicaciones | **Decidido:** no se tocan |

## 6. Orden de trabajo

1. **Qué incluye:** backend, sección y casillas del editor.
2. **Categorías e idiomas.**
3. **Ampliaciones de la sección 2.2:** fotos y tarifas, que casi no necesitan backend; después usuarios, socios, guías y cupones.
4. Compilar, desplegar y comprobar. No se escriben pruebas automáticas, según la preferencia del proyecto.
