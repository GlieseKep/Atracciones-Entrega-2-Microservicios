import { AppError, type EsbClient } from '@atracciones/platform';
import type { Buyer, IdType } from '../contract';

interface Profile {
  id: number;
  tipo_identificacion: IdType;
  identificacion: string;
  razon_social: string;
  correo: string;
  telefono: string | null;
}

const FINAL_CONSUMER_ID = '9999999999999';

/** Con `usu_id`, el perfil principal de Billing Profile. Sin perfil, o en una orden B2B, consumidor final. */
export async function resolveBuyer(esb: EsbClient, usuId: number, correoDefecto: string): Promise<Buyer> {
  const finalConsumer: Buyer = { dfaId: null, tipo: 'CONSUMIDOR_FINAL', identificacion: FINAL_CONSUMER_ID, razonSocial: 'CONSUMIDOR FINAL', correo: correoDefecto, telefono: null };
  if (usuId === 0) return finalConsumer;
  try {
    const profile = await esb.call<Profile>('billing', 'getPrincipal', { usuId });
    return { dfaId: profile.id, tipo: profile.tipo_identificacion, identificacion: profile.identificacion, razonSocial: profile.razon_social, correo: profile.correo, telefono: profile.telefono };
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return finalConsumer;
    throw error;
  }
}
