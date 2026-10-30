import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { ROLES, type RolNombre } from '../contract';

export interface AccessClaims {
  usuId: number;
  sesId: string;
  roles: RolNombre[];
}

const key = (secret: string) => new TextEncoder().encode(secret);

/** JWT de acceso (RFC 7519, HS256): `sub`, `sid`, `roles`, `iat`, `exp`. */
export const signAccessToken = (claims: AccessClaims, secret: string, ttlSeconds: number) =>
  new SignJWT({ sid: claims.sesId, roles: claims.roles })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(claims.usuId))
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(key(secret));

/** Comprueba firma y expiración; `null` si el token no es válido. */
export async function verifyAccessToken(token: string, secret: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, key(secret), { algorithms: ['HS256'] });
    const usuId = Number(payload.sub);
    if (!Number.isSafeInteger(usuId) || typeof payload.sid !== 'string') return null;
    const roles = Array.isArray(payload.roles) ? payload.roles.filter((r): r is RolNombre => ROLES.includes(r)) : [];
    return { usuId, sesId: payload.sid, roles };
  } catch {
    return null;
  }
}

/** Valor aleatorio de 32 bytes para refresh tokens, enlaces y claves de API. */
export const randomToken = () => randomBytes(32).toString('base64url');

/** Lo único que se guarda de esos valores. */
export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
