import { generateKeyPair, exportJWK, exportPKCS8, importPKCS8, calculateJwkThumbprint, SignJWT, type JWK, type KeyLike } from 'jose';
import { createPublicKey } from 'node:crypto';

export interface TokenSettings {
  issuer: string;
  audience: string;
  ttlSeconds: number;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  name: string;
  tipo: string;
  scopes: string[];
}

/**
 * Firma los access tokens con RS256 y publica la clave pública como JWKS (`/.well-known/jwks.json`): el Gateway los
 * verifica sin compartir ningún secreto (plan §3.1; reemplaza el HS256 de `apps/auth`).
 */
export class TokenIssuer {
  private constructor(
    private readonly privateKey: KeyLike,
    private readonly publicJwk: JWK,
    private readonly settings: TokenSettings,
  ) {}

  /** Usa la clave privada PEM (PKCS#8) indicada o, si no hay, genera una efímera (solo desarrollo y pruebas). */
  static async create(settings: TokenSettings, privateKeyPem?: string | null): Promise<TokenIssuer> {
    const privateKey = privateKeyPem
      ? await importPKCS8(privateKeyPem, 'RS256')
      : (await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })).privateKey;
    const pem = privateKeyPem ?? (await exportPKCS8(privateKey));
    const publicJwk = await exportJWK(createPublicKey(pem));
    const kid = await calculateJwkThumbprint(publicJwk);
    return new TokenIssuer(privateKey, { ...publicJwk, kid, alg: 'RS256', use: 'sig' }, settings);
  }

  /** Genera un par nuevo y devuelve la clave privada en PEM (para guardarla en un archivo o secreto). */
  static async generatePrivateKeyPem(): Promise<string> {
    const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
    return exportPKCS8(privateKey);
  }

  jwks(): { keys: JWK[] } {
    return { keys: [this.publicJwk] };
  }

  async issue(claims: AccessTokenClaims): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({ email: claims.email, name: claims.name, tipo: claims.tipo, scope: claims.scopes.join(' ') })
      .setProtectedHeader({ alg: 'RS256', kid: this.publicJwk.kid, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.settings.issuer)
      .setAudience(this.settings.audience)
      .setIssuedAt()
      .setExpirationTime(`${this.settings.ttlSeconds}s`)
      .sign(this.privateKey);
    return { token, expiresIn: this.settings.ttlSeconds };
  }
}
