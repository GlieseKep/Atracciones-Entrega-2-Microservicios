import type { Logger } from '@atracciones/platform';

export interface Mailer {
  sendVerification(correo: string, link: string): Promise<void>;
  sendPasswordRecovery(correo: string, link: string): Promise<void>;
}

/** Implementación de desarrollo: escribe el enlace en el log. */
export class LogMailer implements Mailer {
  constructor(private readonly logger: Logger) {}

  async sendVerification(correo: string, link: string): Promise<void> {
    this.logger.info('correo de verificación', { correo, link });
  }

  async sendPasswordRecovery(correo: string, link: string): Promise<void> {
    this.logger.info('correo de recuperación', { correo, link });
  }
}
