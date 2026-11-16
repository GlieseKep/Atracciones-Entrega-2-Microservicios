import { readGatewayConfig } from '../src/config';

const SECRET = 'x'.repeat(32);

describe('gateway/config', () => {
  it('valores por defecto', () => {
    const config = readGatewayConfig({ INTERNAL_TOKEN_SECRET: SECRET, SERVICE_TOKEN: SECRET });
    expect(config).toMatchObject({
      port: 3000,
      upstreams: { partnerApi: 'http://127.0.0.1:3100', esb: 'http://127.0.0.1:3300', graphql: null },
      corsOrigins: [],
      apiKeyCacheMs: 60_000,
      tokenCacheMs: 30_000,
    });
  });

  it('secreto obligatorio faltante → error al arrancar', () => {
    expect(() => readGatewayConfig({ SERVICE_TOKEN: SECRET })).toThrow('INTERNAL_TOKEN_SECRET');
    expect(() => readGatewayConfig({ INTERNAL_TOKEN_SECRET: SECRET })).toThrow('SERVICE_TOKEN');
  });

  it('secreto de menos de 32 caracteres → error; CORS se limpia', () => {
    expect(() => readGatewayConfig({ INTERNAL_TOKEN_SECRET: 'corto', SERVICE_TOKEN: SECRET })).toThrow('al menos 32');
    expect(readGatewayConfig({ INTERNAL_TOKEN_SECRET: SECRET, SERVICE_TOKEN: SECRET, CORS_ORIGINS: ' https://a.com/ ,,https://b.com' }).corsOrigins).toEqual(['https://a.com', 'https://b.com']);
  });
});
