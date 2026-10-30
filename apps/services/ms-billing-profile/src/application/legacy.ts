import type { BillingProfileDto, LegacyBillingDto } from '../contract';

/** Perfil principal con la forma de `GET /usuarios/me/facturacion` de Identity. */
export const toLegacy = (profile: BillingProfileDto): LegacyBillingDto => ({
  tipo_documento: profile.tipo_identificacion,
  numero_documento: profile.identificacion,
  razon_social: profile.razon_social,
  email: profile.correo,
  telefono: profile.telefono,
  direccion: profile.direccion,
  actualizado_en: profile.actualizado_en,
});
