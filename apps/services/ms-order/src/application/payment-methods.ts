import { AppError, type EsbClient } from '@atracciones/platform';
import type { MetodoCodigo } from '../contract';

interface Method {
  id: number;
  codigo: MetodoCodigo;
}

const CACHE_TTL_MS = 10 * 60_000;

/** `orden` guarda `mpa_id` y el contrato usa el código: se convierten con `GET /metodos-pago`, en caché. */
export class PaymentMethods {
  private methods: Method[] = [];
  private loadedAt = 0;

  constructor(private readonly esb: EsbClient) {}

  private async load(): Promise<Method[]> {
    if (this.methods.length === 0 || this.loadedAt + CACHE_TTL_MS < Date.now()) {
      try {
        this.methods = await this.esb.call<Method[]>('payment', 'listMethods');
        this.loadedAt = Date.now();
      } catch (error) {
        if (this.methods.length === 0) throw error;
      }
    }
    return this.methods;
  }

  async idOf(codigo: MetodoCodigo): Promise<number> {
    const method = (await this.load()).find((item) => item.codigo === codigo);
    if (!method) throw AppError.unprocessable('PAYMENT_METHOD_INACTIVE', `El método ${codigo} no está disponible.`);
    return method.id;
  }

  async codeOf(id: number | null): Promise<string> {
    if (id === null) return '';
    return (await this.load()).find((item) => item.id === id)?.codigo ?? '';
  }
}
