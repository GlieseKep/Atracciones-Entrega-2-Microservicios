import { DEMO_ATTRACTIONS } from '@/features/attractions/demoCatalog';

/** Contenido editorial representativo (no proviene del API). */

const photo = (i: number, p = 0) => DEMO_ATTRACTIONS[i].photos[p].url;

export const DESTINATIONS = [
  { name: 'Quito', city: 'Quito', image: photo(4), caption: 'Capital colonial y volcanes' },
  { name: 'Cotopaxi y Quilotoa', city: 'Latacunga', image: photo(3), caption: 'Lagunas y nevados' },
  { name: 'Baños de Agua Santa', city: 'Baños de Agua Santa', image: photo(7), caption: 'Cascadas y aventura' },
  { name: 'Mindo', city: 'Mindo', image: photo(6), caption: 'Bosque nublado' },
  { name: 'Chimborazo', city: 'Riobamba', image: photo(8), caption: 'Vicuñas y glaciares' },
  { name: 'Mitad del Mundo', city: 'San Antonio de Pichincha', image: photo(1), caption: 'La línea ecuatorial' },
];

export const QUICK_CATEGORIES = [
  { label: 'Naturaleza', category: 'Naturaleza' },
  { label: 'Aventura', category: 'Aventura' },
  { label: 'Cultura e historia', category: 'Cultura' },
  { label: 'Gastronomía', category: 'Gastronomía' },
  { label: 'Fotografía', category: 'Fotografía' },
];

export const AUDIENCES = [
  {
    id: 'parejas',
    label: 'Para parejas',
    description: 'Atardeceres, miradores y noches coloniales para dos.',
    ids: ['de000000-0005-4000-8000-000000000005', 'a1b2c3d4-0001-4000-8000-000000000001', 'de000000-0010-4000-8000-000000000010', 'de000000-0004-4000-8000-000000000004'],
  },
  {
    id: 'familia',
    label: 'En familia',
    description: 'Planes cómodos, educativos y con mucho que descubrir.',
    ids: ['a1b2c3d4-0002-4000-8000-000000000002', 'de000000-0007-4000-8000-000000000007', 'de000000-0006-4000-8000-000000000006', 'a1b2c3d4-0001-4000-8000-000000000001'],
  },
  {
    id: 'fotografos',
    label: 'Para fotógrafos',
    description: 'Los encuadres más fotogénicos de los Andes.',
    ids: ['de000000-0004-4000-8000-000000000004', 'a1b2c3d4-0003-4000-8000-000000000003', 'de000000-0009-4000-8000-000000000009', 'de000000-0008-4000-8000-000000000008'],
  },
];

export const WHY_US = [
  { title: 'Disponibilidad garantizada', text: 'Consultamos los cupos en tiempo real antes de confirmar cada reserva.' },
  { title: 'Recomendaciones locales', text: 'Experiencias elegidas por guías y operadores de cada región.' },
  { title: 'Reservas seguras', text: 'Cuentas protegidas con contraseña cifrada y pagos simulados sin datos de tarjeta.' },
  { title: 'Experiencias verificadas', text: 'Opiniones de viajeros y operadores identificados en cada ficha.' },
];

export const TESTIMONIALS = [
  {
    name: 'Camila R.',
    origin: 'Guayaquil',
    rating: 5,
    date: 'agosto de 2026',
    title: 'La Laguna Quilotoa superó todas las fotos',
    text: 'El guía conocía cada mirador y paramos justo cuando el sol pegaba sobre el agua. Reservar fue rapidísimo.',
    image: photo(3, 1),
  },
  {
    name: 'Daniel M.',
    origin: 'Bogotá',
    rating: 5,
    date: 'julio de 2026',
    title: 'Quito de noche es otra ciudad',
    text: 'Las leyendas, el chocolate al final y la Plaza Grande iluminada. Lo recomiendo para la primera noche en la ciudad.',
    image: photo(4, 1),
  },
  {
    name: 'Laura y Andrés',
    origin: 'Madrid',
    rating: 4,
    date: 'junio de 2026',
    title: 'Mindo con niños, ¡un acierto!',
    text: 'La tarabita y los colibríes encantaron a los peques. Llevad chubasquero: el bosque nublado hace honor a su nombre.',
    image: photo(6, 1),
  },
];

export const STORIES = [
  {
    tag: 'Guía',
    title: 'Avenida de los Volcanes: cómo planear 5 días entre nevados',
    excerpt: 'Cotopaxi, Quilotoa y Chimborazo en una sola ruta. Qué ver, cuándo ir y cómo aclimatarte a la altura.',
    image: photo(2, 1),
    to: '/atracciones?categorias=Aventura',
  },
  {
    tag: 'Fotografía',
    title: 'Los 7 miradores más fotogénicos de Quito',
    excerpt: 'Del Panecillo a Cruz Loma: la hora dorada perfecta para cada uno y qué lente llevar.',
    image: photo(9),
    to: '/atracciones?ciudad=Quito',
  },
  {
    tag: 'Naturaleza',
    title: 'Cascadas de Baños: la ruta en bicicleta paso a paso',
    excerpt: 'Puentes colgantes, tarabitas y el imponente Pailón del Diablo a lo largo de 18 km.',
    image: photo(7, 1),
    to: '/atracciones?ciudad=Ba%C3%B1os%20de%20Agua%20Santa',
  },
];

export const FAQ = [
  {
    q: '¿Cuáles son las mejores cosas que hacer en Ecuador?',
    a: 'Entre las experiencias favoritas están subir en el TelefériQo de Quito, visitar la Laguna Quilotoa, la excursión al Parque Nacional Cotopaxi, el bosque nublado de Mindo y la ruta de las cascadas en Baños.',
  },
  {
    q: '¿Necesito iniciar sesión para reservar?',
    a: 'Puedes explorar sin cuenta. Para reservar o comprar necesitas una cuenta gratuita: créala en un minuto con tu correo y una contraseña.',
  },
  {
    q: '¿Qué diferencia hay entre reservar y comprar?',
    a: 'Con “Reservar ahora, pagar después” aseguras tus plazas sin pagar. Con “Comprar y pagar ahora” se crea un pedido con el precio calculado por el servidor y se procesa un pago simulado.',
  },
  {
    q: '¿Puedo cancelar mi reserva?',
    a: 'Las experiencias con “Cancelación gratuita” pueden cancelarse sin coste antes de su inicio desde Mis reservas. Las compras pagadas se cancelan desde el detalle del pedido cuando el estado lo permite.',
  },
  {
    q: '¿Cuál es la mejor época para visitar los Andes ecuatorianos?',
    a: 'De junio a septiembre suele haber cielos más despejados para ver los volcanes. Aun así, en la Sierra el clima cambia en el día: lleva capas de ropa y protección solar.',
  },
];
