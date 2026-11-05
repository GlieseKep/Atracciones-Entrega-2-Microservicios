import { gql } from './client';

export interface ContactMessage {
  nombre: string;
  correo: string;
  /** Máximo 30 caracteres. */
  asunto: string;
  cuerpo: string;
}

/** Mensaje de contacto para el equipo de soporte (ms-support). No requiere sesión. */
export const sendContactMessage = (body: ContactMessage) => gql.mutation<{ id: number }>('supportSendMessage', body);
