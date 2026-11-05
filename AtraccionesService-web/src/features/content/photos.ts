/**
 * Fotografías decorativas (portada e inicio de sesión). No son datos del catálogo: las fotos de cada atracción llegan
 * en `photos` del contrato v3.
 */

const commons = (path: string, file: string) =>
  `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/${file}/1280px-${file}`;

export const HERO_PHOTO = commons('4/44', 'Quito_as_from_panecillo_Basilica.jpg');

export const AUTH_PHOTO = commons('6/63', 'Quilotoa._Volc%C3%A1n_-_Laguna_Ecuador_%282%29.jpg');

export const PHOTO_CREDITS = 'Fotografías de portada: Wikimedia Commons (CC BY-SA y dominio público).';

/** Variante más ligera de una foto de Wikimedia (las de otros orígenes se usan tal cual). */
export const photoAt = (url: string, width: 330 | 500 | 960 | 1280) => url.replace(/\/1280px-/, `/${width}px-`);
