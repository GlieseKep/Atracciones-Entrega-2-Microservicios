// Carga el catálogo inicial a través del Gateway (GraphQL), con un usuario ADMIN: operador, atracciones, tarifas, horarios
// y publicación. Las atracciones son las destacadas de Ecuador en TripAdvisor (solo nombre y lugar); las descripciones,
// precios y horarios son propios, y las fotos son de relleno (picsum.photos) hasta que se carguen las reales.
//
// Uso (Cloud Shell, desde la carpeta del repositorio, después de `npm ci`):
//   GATEWAY_URL=https://tourgirls-gateway-mm.azurewebsites.net \
//   LOCATION_DATABASE_URL=$(az webapp config appsettings list -g rg-tourgirls -n tourgirls-ms-location-mm \
//     --query "[?name=='DATABASE_URL'].value" -o tsv) \
//   node tools/seed-atracciones.mjs
// Pide el correo y la contraseña del ADMIN. Se puede repetir: lo que ya existe se omite.
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline/promises';

const require = createRequire(import.meta.url);
const gateway = (process.env.GATEWAY_URL ?? 'https://tourgirls-gateway-mm.azurewebsites.net').replace(/\/$/, '');
const OPERATOR = 'ope-tourgirls';

/** Ciudades que faltan en ms_location (el seed del servicio no las trae). */
const NEW_CITIES = [
  { nombre: 'Puerto Ayora', codigo: '200350', provincia: 'Galápagos' },
  { nombre: 'Mindo', codigo: '170751', provincia: 'Pichincha' },
  { nombre: 'Puerto López', codigo: '131950', provincia: 'Manabí' },
];

const C = { aventura: 'cat-aventura-100', cultural: 'cat-cultural-100', naturales: 'cat-naturales-100', playas: 'cat-playas-100', montana: 'cat-montana-100' };

/** [nombre, ciudad, lat, lon, tipo, horas, categorías, incluye {comida, transporte, guía}, precios {adulto, niño, senior}, horas de salida, cupo, punto de encuentro, descripción] */
const ATTRACTIONS = [
  ['Tortuga Bay: caminata y playa', 'Puerto Ayora', -0.7600, -90.3300, 'GUIDED_TOUR', 4, [C.playas, C.naturales], [false, false, true], [35, 20, 30], ['08:00', '13:00'], 20,
    'Inicio del sendero a Tortuga Bay, Puerto Ayora',
    'Caminata guiada de 2,5 km por un sendero de lava y cactus hasta una de las playas de arena blanca más amplias de Galápagos. En la bahía Mansa se puede nadar en aguas tranquilas y observar iguanas marinas, pelícanos y tiburones de punta blanca juveniles desde la orilla.'],
  ['Museo Templo del Sol Pintor Ortega Maila', 'Quito', -0.0020, -78.4470, 'ADMISSION', 1.5, [C.cultural], [false, false, true], [8, 4, 6], ['09:00', '11:00', '14:00', '16:00'], 30,
    'Entrada del museo, vía a la Mitad del Mundo',
    'Visita guiada a un museo que reúne pintura y escultura inspiradas en la cosmovisión andina, en una construcción que recrea un templo solar. El recorrido explica los ciclos agrícolas, los equinoccios y los símbolos de los pueblos precolombinos de la zona ecuatorial.'],
  ['TelefériQo Quito y mirador del Pichincha', 'Quito', -0.1920, -78.5190, 'ADMISSION', 2, [C.aventura, C.montana], [false, false, false], [9, 6, 7], ['09:00', '10:30', '12:00', '14:00'], 40,
    'Estación base del TelefériQo, Av. Occidental',
    'Ascenso en cabina desde los 3.000 hasta los 3.945 m en las faldas del volcán Pichincha. Desde la cima hay vistas de Quito y, con cielo despejado, de los volcanes Cotopaxi, Antisana y Cayambe. Se recomienda ropa abrigada por el viento y el frío de altura.'],
  ['Iglesia de la Compañía de Jesús', 'Quito', -0.2205, -78.5134, 'ADMISSION', 1, [C.cultural], [false, false, true], [6, 3, 4], ['09:30', '11:30', '15:00'], 25,
    'Calle García Moreno y Sucre, Centro Histórico',
    'Recorrido por uno de los templos barrocos más importantes de América, con su interior recubierto de pan de oro, retablos tallados y la obra de la Escuela Quiteña. El guía explica su construcción a lo largo de más de 160 años y la restauración tras los incendios y terremotos.'],
  ['Cascada Pailón del Diablo', 'Baños', -1.3930, -78.3420, 'DAY_TRIP', 5, [C.aventura, C.naturales], [false, true, true], [25, 15, 20], ['08:30', '13:30'], 25,
    'Parque central de Baños de Agua Santa',
    'Salida en transporte por la Ruta de las Cascadas, con paradas en miradores y la tarabita de la cascada Manto de la Novia. Termina con una caminata por el bosque nublado hasta el Pailón del Diablo, donde un sendero y puentes colgantes llegan a pocos metros de la caída de agua.'],
  ['Centro Histórico de Quito a pie', 'Quito', -0.2200, -78.5125, 'GUIDED_TOUR', 3, [C.cultural], [false, false, true], [20, 10, 15], ['09:00', '14:00'], 20,
    'Plaza Grande, frente a la Catedral Metropolitana',
    'Recorrido a pie por el primer sitio declarado Patrimonio Cultural de la Humanidad: Plaza Grande, Palacio de Carondelet, calle La Ronda, San Francisco y sus iglesias coloniales. Incluye historias de la fundación de la ciudad y paradas para probar dulces tradicionales.'],
  ['Museo Intiñan en la línea ecuatorial', 'Quito', -0.0021, -78.4480, 'ADMISSION', 1.5, [C.cultural], [false, false, true], [7, 4, 5], ['09:00', '10:30', '12:00', '14:30', '16:00'], 30,
    'Entrada del museo, San Antonio de Pichincha',
    'Museo al aire libre sobre la línea ecuatorial, con muestras de culturas ancestrales, una cabaña tradicional y experimentos sobre el equinoccio y la latitud cero. La visita es guiada y dura alrededor de hora y media.'],
  ['Basílica del Voto Nacional y sus torres', 'Quito', -0.2148, -78.5072, 'ADMISSION', 1.5, [C.cultural], [false, false, false], [5, 2.5, 3], ['09:00', '11:00', '13:00', '15:00'], 30,
    'Calle Venezuela y Carchi, Centro Histórico',
    'Visita a la mayor basílica neogótica de Ecuador, decorada con gárgolas de animales de las islas Galápagos y de la Amazonía. Se sube por escaleras y pasarelas hasta las torres, con vista de todo el Centro Histórico y el Panecillo.'],
  ['Parque Nacional Cajas: lagunas y páramo', 'Cuenca', -2.7800, -79.2000, 'DAY_TRIP', 7, [C.naturales, C.montana], [true, true, true], [55, 35, 45], ['07:30'], 16,
    'Parque Calderón, Cuenca',
    'Excursión de día completo al páramo andino, con caminata alrededor de la laguna Toreadora y por bosques de polylepis. Incluye transporte desde Cuenca, guía naturalista y almuerzo de trucha en la vía de regreso. Altitud de hasta 4.000 m.'],
  ['Kicker Rock (León Dormido): snorkel', 'Puerto Baquerizo Moreno', -0.7780, -89.5180, 'DAY_TRIP', 8, [C.aventura, C.playas, C.naturales], [true, true, true], [160, 120, 150], ['07:30'], 16,
    'Muelle de Puerto Baquerizo Moreno',
    'Navegación hasta la formación volcánica del León Dormido para hacer snorkel en su canal, donde es frecuente ver tortugas marinas, lobos marinos, rayas y tiburones de Galápagos. Incluye equipo de snorkel, traje de neopreno, almuerzo a bordo y parada en una playa.'],
  ['Laguna Quilotoa: mirador y descenso al cráter', 'Latacunga', -0.8600, -78.9000, 'DAY_TRIP', 9, [C.aventura, C.montana, C.naturales], [true, true, true], [60, 40, 50], ['07:00'], 16,
    'Parque Vicente León, Latacunga',
    'Viaje al cráter del volcán Quilotoa, ocupado por una laguna de color verde esmeralda. Se baja por el sendero hasta la orilla y se sube a pie o en mula. Incluye paradas en comunidades kichwas de Tigua y almuerzo típico.'],
  ['Reserva El Chato: tortugas gigantes', 'Puerto Ayora', -0.6740, -90.4020, 'GUIDED_TOUR', 3, [C.naturales], [false, true, true], [40, 25, 35], ['09:00', '14:00'], 20,
    'Malecón de Puerto Ayora',
    'Visita a la parte alta de Santa Cruz para ver tortugas gigantes en libertad en sus pastizales. Incluye el recorrido por los túneles de lava cercanos y transporte desde Puerto Ayora.'],
  ['Parque Nacional Cotopaxi', 'Latacunga', -0.6800, -78.4400, 'DAY_TRIP', 8, [C.aventura, C.montana], [true, true, true], [65, 45, 55], ['07:00'], 16,
    'Parque Vicente León, Latacunga',
    'Excursión al parque del volcán Cotopaxi: caminata por la laguna de Limpiopungo y ascenso opcional hasta el refugio José Rivas, a 4.864 m. Incluye transporte, guía de montaña y almuerzo. Requiere buena condición física.'],
  ['Parque Histórico Guayaquil', 'Guayaquil', -2.1440, -79.8620, 'ADMISSION', 2.5, [C.cultural, C.naturales], [false, false, true], [12, 6, 8], ['09:30', '11:30', '14:00'], 30,
    'Entrada del parque, Av. Esmeraldas, Samborondón',
    'Recorrido por tres zonas: la vida silvestre del manglar, una hacienda cacaotera tradicional y el Guayaquil de comienzos del siglo XX con sus casas de madera restauradas.'],
  ['Estación Científica Charles Darwin', 'Puerto Ayora', -0.7430, -90.3030, 'GUIDED_TOUR', 2, [C.naturales, C.cultural], [false, false, true], [20, 10, 15], ['08:30', '10:30', '14:30'], 25,
    'Entrada de la estación, Av. Charles Darwin',
    'Visita guiada al centro de investigación y crianza de tortugas gigantes. Se recorren los corrales de tortugas juveniles y la exhibición sobre la conservación de las especies endémicas del archipiélago.'],
  ['Refugio Paz de las Aves: avistamiento', 'Mindo', -0.0400, -78.7600, 'GUIDED_TOUR', 4, [C.naturales], [true, false, true], [45, 30, 40], ['06:00'], 12,
    'Entrada del refugio, vía Calacalí–La Independencia',
    'Salida al amanecer para observar el gallito de la peña en su lugar de exhibición y aves del bosque nublado, guiada por la familia que administra el refugio. Termina con desayuno típico mientras llegan los colibríes a los comederos.'],
  ['Reserva Maquipucuna: bosque nublado', 'Quito', 0.1250, -78.6290, 'DAY_TRIP', 6, [C.naturales, C.aventura], [true, true, true], [50, 35, 45], ['07:30'], 16,
    'Parque El Ejido, Quito',
    'Caminata por senderos del bosque nublado de la reserva, con ríos, cascadas y gran variedad de orquídeas y aves. Incluye transporte desde Quito, guía naturalista y almuerzo.'],
  ['Playa Los Frailes y Parque Machalilla', 'Puerto López', -1.4960, -80.7860, 'DAY_TRIP', 5, [C.playas, C.naturales], [false, true, true], [30, 18, 25], ['08:30'], 20,
    'Malecón de Puerto López',
    'Visita a una de las playas mejor conservadas de la costa ecuatoriana, dentro del Parque Nacional Machalilla. Incluye el sendero a los miradores de la Tortuguita y playa Negra, y tiempo libre para nadar.'],
];

const ask = async () => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const email = process.env.ADMIN_EMAIL ?? (await rl.question('Correo del ADMIN: '));
  const password = process.env.ADMIN_PASSWORD ?? (await rl.question('Contraseña del ADMIN: '));
  rl.close();
  return { email: email.trim(), password };
};

async function http(path, { body, token } = {}) {
  const response = await fetch(`${gateway}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status} ${json?.detail ?? text.slice(0, 200)}`);
  return json;
}

/** Llama a un campo de GraphQL (`<servicio><Operación>`); devuelve el error con su código en lugar de lanzarlo. */
const QUERIES = new Set(['locationListCities', 'locationListProvinces', 'catalogAdminListAttractions']);

const gql = (token) => async (field, input, idempotencyKey) => {
  const mutation = !QUERIES.has(field);
  const args = idempotencyKey ? '(input: $i, idempotencyKey: $k)' : '(input: $i)';
  const vars = idempotencyKey ? '($i: JSON, $k: ID!)' : '($i: JSON)';
  const { data, errors } = await http('/graphql', {
    token,
    body: { query: `${mutation ? 'mutation' : 'query'}${vars} { ${field}${args} }`, variables: { i: input, k: idempotencyKey } },
  });
  if (errors?.length) return { error: errors[0] };
  return { data: data[field] };
};

const itemsOf = (value) => (Array.isArray(value) ? value : value?.items ?? value?.data ?? []);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function addCities() {
  if (!process.env.LOCATION_DATABASE_URL) {
    console.log('Sin LOCATION_DATABASE_URL: no se agregan ciudades (las atracciones de esas ciudades fallarán).');
    return;
  }
  const { Client } = require('pg');
  const client = new Client({ connectionString: process.env.LOCATION_DATABASE_URL, ssl: { rejectUnauthorized: true } });
  await client.connect();
  try {
    for (const city of NEW_CITIES) {
      const { rowCount } = await client.query(
        `INSERT INTO ciudad (ciu_nombre, ciu_codigo, prov_id) SELECT $1, $2, prov_id FROM provincia WHERE prov_nombre = $3 ON CONFLICT DO NOTHING`,
        [city.nombre, city.codigo, city.provincia],
      );
      console.log(`${rowCount ? 'Ciudad creada' : 'Ciudad ya existía'}: ${city.nombre}`);
    }
  } finally {
    await client.end();
  }
}

async function main() {
  await addCities();
  const { email, password } = await ask();
  const session = await http('/api/v3/auth/login', { body: { correo: email, password } });
  const call = gql(session.access_token);

  const cities = new Map(itemsOf((await call('locationListCities', {})).data).map((c) => [c.nombre, c.id]));
  const provinces = itemsOf((await call('locationListProvinces', {})).data);
  const pichincha = provinces.find((p) => p.nombre === 'Pichincha');

  const operator = await call('catalogCreateOperator', {
    id: OPERATOR, nombre_comercial: 'TourGirls Ecuador', prov_id: pichincha?.id, direccion: 'Quito, Ecuador',
  });
  console.log(operator.error ? `Operador: ${operator.error.extensions?.reason ?? operator.error.message}` : `Operador creado: ${OPERATOR}`);

  const existing = new Map(itemsOf((await call('catalogAdminListAttractions', { limit: 100 })).data).map((a) => [a.nombre ?? a.name, a]));
  let ok = 0;
  for (const [nombre, ciudad, lat, lon, tipo, horas, categorias, [comida, transporte, guia], [adulto, nino, senior], salidas, cupo, encuentro, descripcion] of ATTRACTIONS) {
    try {
      let attraction = existing.get(nombre);
      if (!attraction) {
        const ciuId = cities.get(ciudad);
        if (!ciuId) throw new Error(`no existe la ciudad ${ciudad}`);
        const created = await call('catalogAdminCreateAttraction', {
          name: nombre,
          description: descripcion,
          short_description: descripcion.split('. ')[0].slice(0, 277).replace(/\.?$/, '.'),
          tipo,
          latitude: lat,
          longitude: lon,
          meeting_point: encuentro,
          duration_hours: horas,
          ciu_id: ciuId,
          operador: OPERATOR,
          categorias,
          idiomas: ['es', 'en'],
          fotos: [{ url: `https://picsum.photos/seed/${encodeURIComponent(nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-'))}/1200/800`, alt: nombre, orden: 0 }],
          inclusions: { includes_food: comida, includes_transport: transporte, includes_guide: guia },
          cancellation_policy: { free_cancellation: true, deadline_hours: 24, description: 'Cancelación gratuita hasta 24 horas antes de la salida.' },
        });
        if (created.error) throw new Error(created.error.extensions?.reason ?? created.error.message);
        attraction = created.data;
      }
      const id = attraction.id;

      const price = await call('pricingSetPriceTable', { attraction_id: id, adult: adulto, child: nino, senior });
      if (price.error) throw new Error(`tarifa: ${price.error.message}`);

      for (const hora of salidas) {
        const schedule = await call('inventorySaveSchedule', { hor_id: 0, atraccion_id: id, hora: `${hora}:00`, cupo });
        if (schedule.error && schedule.error.extensions?.status !== 409) throw new Error(`horario ${hora}: ${schedule.error.message}`);
      }

      // La tarifa llega a Catalog por el evento TARIFA_ACTUALIZADA: se reintenta hasta que se pueda publicar.
      let published = null;
      for (let attempt = 0; attempt < 15 && !published; attempt++) {
        const state = await call('catalogAdminSetAttractionState', { id, estado: 'PUBLICADA' });
        if (!state.error) published = state.data;
        else if (state.error.extensions?.reason === 'ATTRACTION_NOT_PUBLISHABLE') await sleep(3000);
        else throw new Error(`publicar: ${state.error.message}`);
      }
      if (!published) throw new Error('no se pudo publicar: la tarifa no llegó a Catalog (revisa RabbitMQ)');
      ok++;
      console.log(`OK ${id} ${nombre}`);
    } catch (error) {
      console.log(`ERROR ${nombre}: ${error.message}`);
    }
  }
  console.log(`=== ${ok} de ${ATTRACTIONS.length} atracciones publicadas ===`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
