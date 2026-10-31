import type { Attraction } from '@/types/attraction';

/**
 * Catálogo de demostración para navegar sin sesión (el contrato exige `attractions:read` incluso para leer).
 * Las tres primeras atracciones comparten id con el seed de desarrollo del API (CatalogSeeder),
 * así que el detalle y la reserva funcionan igual cuando el usuario inicia sesión.
 * Fotografías: Wikimedia Commons (licencias CC BY / CC BY-SA / CC0 / dominio público; ver `PHOTO_CREDITS`).
 */

const commons = (path: string, file: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/${file}/1280px-${file}`;

const quito = (address: string, lat: number, lon: number, city = 'Quito') => ({
  address,
  city,
  country: 'EC',
  coordinates: { latitude: lat, longitude: lon },
  type: 'MEETING_POINT',
});

export const DEMO_ATTRACTIONS: Attraction[] = [
  {
    id: 'a1b2c3d4-0001-4000-8000-000000000001',
    name: 'TelefériQo: subida al volcán Pichincha con vistas de Quito',
    longDescription:
      'Sube en telecabina desde el borde occidental de Quito hasta Cruz Loma, a más de 3.900 metros sobre el nivel del mar. En apenas unos minutos pasarás de la ciudad a los páramos andinos, con vistas de la capital y, en días despejados, de los volcanes Cotopaxi, Cayambe y Antisana. Arriba podrás caminar por senderos, tomar un canelazo caliente y fotografiar el atardecer sobre el valle.',
    duration: 'PT2H',
    price: { currency: 'USD', total: 9.5 },
    categories: ['Aventura', 'Naturaleza'],
    badges: ['Más vendido'],
    locations: [quito('Av. Occidental y La Gasca', -0.1925, -78.5195)],
    photos: [
      { url: commons('9/9b', 'Gondolas_of_the_TeleferiQo_in_Quito%2C_Ecuador.jpg') },
      { url: commons('3/30', 'Top_station_of_the_TeleferiQo_in_Quito%2C_Ecuador.jpg') },
      { url: commons('3/30', 'Curiquingue%2C_cerca_de_la_estaci%C3%B3n_del_Telef%C3%A9riQo.jpg') },
    ],
    operator: { id: 1001, name: 'Quito Tours (ejemplo)' },
    productType: 'SINGLE_TICKET',
    includes: ['Entrada'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: true,
    ratings: { numberOfReviews: 1250, score: 4.6 },
  },
  {
    id: 'a1b2c3d4-0002-4000-8000-000000000002',
    name: 'Ciudad Mitad del Mundo: visita guiada a la línea ecuatorial',
    longDescription:
      'Recorre con un guía local el monumento a la línea ecuatorial en San Antonio de Pichincha. Conoce la historia de la misión geodésica franco-española, visita los museos etnográficos y planetario, y toma la clásica foto con un pie en cada hemisferio. Incluye traslado desde Quito y entrada al complejo.',
    duration: 'PT3H',
    price: { currency: 'USD', total: 25 },
    categories: ['Cultura'],
    badges: [],
    locations: [quito('Av. Manuel Córdova Galarza', -0.0022, -78.4558, 'San Antonio de Pichincha')],
    photos: [
      { url: commons('a/ae', 'Mitad_del_Mundo%2C_Quito%2C_Ecuador%2C_2015-07-22%2C_DD_02.JPG') },
      { url: commons('4/48', 'Mitad_del_Mundo%2C_Quito%2C_Ecuador%2C_2015-07-22%2C_DD_04.JPG') },
      { url: commons('8/8e', 'Mitad_del_Mundo%2C_Quito%2C_Ecuador%2C_2015-07-22%2C_DD_22.JPG') },
    ],
    operator: { id: 1001, name: 'Quito Tours (ejemplo)' },
    productType: 'GUIDED_TOUR',
    includes: ['Guía', 'Transporte', 'Entrada'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: true,
    ratings: { numberOfReviews: 840, score: 4.4 },
  },
  {
    id: 'a1b2c3d4-0003-4000-8000-000000000003',
    name: 'Parque Nacional Cotopaxi: excursión de día completo desde Quito',
    longDescription:
      'Viaja por la Avenida de los Volcanes hasta el Parque Nacional Cotopaxi. Camina alrededor de la laguna de Limpiopungo, observa caballos salvajes y cóndores andinos y, si el clima lo permite, asciende hasta el refugio José Rivas a 4.864 metros. Un guía de montaña certificado te acompaña durante toda la jornada.',
    duration: 'P1D',
    price: { currency: 'USD', total: 75 },
    categories: ['Aventura', 'Naturaleza'],
    badges: ['Nuevo'],
    locations: [quito('Panamericana Sur km 45', -0.6844, -78.4378, 'Latacunga')],
    photos: [
      { url: commons('d/d9', 'Cotopaxi_01.jpg') },
      { url: commons('0/07', 'Cotopaxi_%2837399959476%29.jpg') },
      { url: commons('b/b2', 'Cotopaxi_02.jpg') },
    ],
    operator: { id: 1002, name: 'Andes Trips (ejemplo)' },
    productType: 'PACKAGE',
    includes: ['Guía', 'Transporte'],
    supportedLanguages: ['es'],
    freeCancellation: true,
    ratings: { numberOfReviews: 310, score: 4.8 },
  },
  {
    id: 'de000000-0004-4000-8000-000000000004',
    name: 'Laguna Quilotoa: caminata por el cráter y comunidades andinas',
    longDescription:
      'Descubre la laguna de aguas turquesa que llena el cráter del volcán Quilotoa. Caminarás por el borde del cráter, descenderás hasta la orilla y visitarás talleres de pintura indígena de Tigua. Almuerzo típico incluido en una comunidad local.',
    duration: 'PT10H',
    price: { currency: 'USD', total: 89 },
    categories: ['Naturaleza', 'Aventura'],
    badges: ['Probabilidad de agotarse'],
    locations: [quito('Mirador Shalalá, Quilotoa', -0.8584, -78.9047, 'Latacunga')],
    photos: [
      { url: commons('6/63', 'Quilotoa._Volc%C3%A1n_-_Laguna_Ecuador_%282%29.jpg') },
      { url: commons('3/36', 'Quilotoa._Volc%C3%A1n_-_Laguna_Ecuador_%285%29.jpg') },
      { url: commons('a/a7', 'Quilotoa._Volc%C3%A1n_-_Laguna_Ecuador_%287%29.jpg') },
    ],
    operator: { id: 1002, name: 'Andes Trips (ejemplo)' },
    productType: 'PACKAGE',
    includes: ['Guía', 'Transporte', 'Almuerzo'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: true,
    ratings: { numberOfReviews: 562, score: 4.9 },
  },
  {
    id: 'de000000-0005-4000-8000-000000000005',
    name: 'Centro Histórico de Quito de noche: tour a pie con leyendas',
    longDescription:
      'El primer Patrimonio Cultural de la Humanidad de la UNESCO se transforma de noche. Recorre la Plaza Grande iluminada, iglesias barrocas y callejones coloniales mientras tu guía narra leyendas quiteñas. Termina con una degustación de chocolate ecuatoriano.',
    duration: 'PT2H30M',
    price: { currency: 'USD', total: 22 },
    categories: ['Cultura', 'Gastronomía'],
    badges: ['Más vendido'],
    locations: [quito('Plaza de la Independencia', -0.2201, -78.5123)],
    photos: [
      {
        url: commons(
          'a/a5',
          'Plaza_de_la_Independencia_%28Quito%29_Historic_Center_at_night_%28El_Centro_Hist%C3%B3rico_de_Quito%29_pic.aa.jpg',
        ),
      },
      {
        url: commons(
          '7/7b',
          'Plaza_de_la_Independencia_%28Quito%29_Historic_Center_at_night_%28El_Centro_Hist%C3%B3rico_de_Quito%29_pic.g1.jpg',
        ),
      },
    ],
    operator: { id: 1001, name: 'Quito Tours (ejemplo)' },
    productType: 'GUIDED_TOUR',
    includes: ['Guía', 'Degustación'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: true,
    ratings: { numberOfReviews: 978, score: 4.7 },
  },
  {
    id: 'de000000-0006-4000-8000-000000000006',
    name: 'Basílica del Voto Nacional: subida a las torres y gárgolas',
    longDescription:
      'Sube a las torres de la mayor iglesia neogótica de América y descubre sus gárgolas inspiradas en la fauna ecuatoriana: tortugas, iguanas y armadillos. Desde el mirador del reloj tendrás una de las mejores vistas del centro de Quito y el Panecillo.',
    duration: 'PT1H30M',
    price: { currency: 'USD', total: 12 },
    categories: ['Cultura'],
    badges: [],
    locations: [quito('Calle Venezuela y Carchi', -0.2149, -78.5072)],
    photos: [
      { url: commons('5/5a', 'Bas%C3%ADlica_del_Voto_Nacional%2C_Quito_-_4.jpg') },
      { url: commons('c/c3', 'Vista_noroccidental._Bas%C3%ADlica_del_Voto_Nacional%2C_Quito_-_Ecuador.jpg') },
      { url: commons('2/29', 'Bas%C3%ADlica_del_Voto_Nacional%2C_Quito_-_5.jpg') },
    ],
    operator: { id: 1001, name: 'Quito Tours (ejemplo)' },
    productType: 'SINGLE_TICKET',
    includes: ['Entrada'],
    supportedLanguages: ['es'],
    freeCancellation: false,
    ratings: { numberOfReviews: 411, score: 4.5 },
  },
  {
    id: 'de000000-0007-4000-8000-000000000007',
    name: 'Bosque nublado de Mindo: cascadas, colibríes y tarabita',
    longDescription:
      'Escápate al bosque nublado de Mindo, uno de los lugares con mayor diversidad de aves del planeta. Cruza el valle en tarabita, camina hasta la ruta de las cascadas, observa colibríes en un jardín de néctar y visita una pequeña fábrica de chocolate artesanal.',
    duration: 'PT9H',
    price: { currency: 'USD', total: 65 },
    categories: ['Naturaleza', 'Aventura'],
    badges: [],
    locations: [quito('Vía Mindo – Tarabita', -0.0517, -78.7746, 'Mindo')],
    photos: [
      { url: commons('e/e4', 'Mindo-Cloud-Forest-03.jpg') },
      { url: commons('6/69', 'Mindo-Cloud-Forest-06.jpg') },
    ],
    operator: { id: 1002, name: 'Andes Trips (ejemplo)' },
    productType: 'PACKAGE',
    includes: ['Guía', 'Transporte', 'Almuerzo', 'Entrada'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: true,
    ratings: { numberOfReviews: 689, score: 4.8 },
  },
  {
    id: 'de000000-0008-4000-8000-000000000008',
    name: 'Baños: ruta de las cascadas y Pailón del Diablo',
    longDescription:
      'Recorre la Ruta de las Cascadas entre Baños y Río Verde. Cruza puentes colgantes, siente la fuerza del Pailón del Diablo desde sus miradores y opcionalmente vuela en canopy sobre el cañón del río Pastaza.',
    duration: 'PT6H',
    price: { currency: 'USD', total: 45 },
    categories: ['Aventura', 'Naturaleza'],
    badges: ['Probabilidad de agotarse'],
    locations: [quito('Río Verde, vía Baños – Puyo', -1.4019, -78.2969, 'Baños de Agua Santa')],
    photos: [
      { url: commons('8/84', 'The_base_of_Pail%C3%B3n_del_Diablo.jpg') },
      { url: commons('5/56', 'R%C3%ADo_Verde_Pail%C3%B3n_del_Diablo_trail_1.jpg') },
      { url: commons('0/0e', 'R%C3%ADo_Verde_Pail%C3%B3n_del_Diablo_trail_2.jpg') },
    ],
    operator: { id: 1002, name: 'Andes Trips (ejemplo)' },
    productType: 'GUIDED_TOUR',
    includes: ['Guía', 'Transporte'],
    supportedLanguages: ['es'],
    freeCancellation: true,
    ratings: { numberOfReviews: 254, score: 4.6 },
  },
  {
    id: 'de000000-0009-4000-8000-000000000009',
    name: 'Volcán Chimborazo: el punto más cercano al sol',
    longDescription:
      'Visita la Reserva de Producción de Fauna Chimborazo, hogar de vicuñas en libertad. Llega hasta el refugio Carrel y camina hacia el refugio Whymper a 5.000 metros, en el volcán cuya cumbre es el punto de la Tierra más alejado de su centro.',
    duration: 'P1D',
    price: { currency: 'USD', total: 95 },
    categories: ['Aventura', 'Naturaleza'],
    badges: [],
    locations: [quito('Reserva de Producción de Fauna Chimborazo', -1.4693, -78.8169, 'Riobamba')],
    photos: [
      { url: commons('9/9c', 'Chimborazo_04.jpg') },
      { url: commons('7/7c', 'Vicu%C3%B1a_-_Chimborazo%2C_Ecuador.jpg') },
      { url: commons('8/8f', 'Chimborazo_05.jpg') },
    ],
    operator: { id: 1002, name: 'Andes Trips (ejemplo)' },
    productType: 'PACKAGE',
    includes: ['Guía', 'Transporte', 'Almuerzo'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: false,
    ratings: { numberOfReviews: 147, score: 4.7 },
  },
  {
    id: 'de000000-0010-4000-8000-000000000010',
    name: 'Quito panorámico: El Panecillo, miradores y barrio La Ronda',
    longDescription:
      'Tour en vehículo privado por los mejores miradores de Quito: la Virgen del Panecillo, el mirador de Guápulo y el parque Itchimbía. Termina con un paseo por la calle colonial de La Ronda y una bebida tradicional.',
    duration: 'PT4H',
    price: { currency: 'USD', total: 35 },
    categories: ['Cultura', 'Fotografía'],
    badges: [],
    locations: [quito('El Panecillo', -0.2296, -78.5183)],
    photos: [{ url: commons('4/44', 'Quito_as_from_panecillo_Basilica.jpg') }],
    operator: { id: 1001, name: 'Quito Tours (ejemplo)' },
    productType: 'GUIDED_TOUR',
    includes: ['Guía', 'Transporte'],
    supportedLanguages: ['es', 'en'],
    freeCancellation: true,
    ratings: { numberOfReviews: 523, score: 4.5 },
  },
];

export const HERO_PHOTO = commons('4/44', 'Quito_as_from_panecillo_Basilica.jpg');

export const PHOTO_CREDITS =
  'Fotografías de Wikimedia Commons bajo licencias CC BY 2.0, CC BY-SA 2.5/3.0/4.0, CC0 y dominio público.';
