import { beforeEach, describe, expect, it } from 'vitest';
import type { PurchaseResponse } from '@/types/purchase';
import { claimsFrom } from '@/features/auth/session';
import { currentAccessToken, useAuthStore } from './authStore';
import { usePurchaseStore } from './purchaseStore';

const purchase = { orderId: 'o1', totalAmount: 19, currency: 'USD' } as PurchaseResponse;
const selection = { attractionId: 'a', date: '2099-01-01', time: '09:00', quantity: 2 };

describe('estado de compra directa', () => {
  beforeEach(() => usePurchaseStore.getState().reset());

  it('avanza a revisión al recibir el pedido del servidor', () => {
    const s = usePurchaseStore.getState();
    s.setSelection(selection);
    s.setPurchase(purchase);
    expect(usePurchaseStore.getState().step).toBe('review');
    expect(usePurchaseStore.getState().purchase?.totalAmount).toBe(19);
  });

  it('cambiar la selección invalida el pedido calculado', () => {
    const s = usePurchaseStore.getState();
    s.setSelection(selection);
    s.setPurchase(purchase);
    s.setSelection({ ...selection, quantity: 3 });
    expect(usePurchaseStore.getState().purchase).toBeNull();
  });

  it('repetir la misma selección conserva el pedido', () => {
    const s = usePurchaseStore.getState();
    s.setSelection(selection);
    s.setPurchase(purchase);
    s.setSelection({ ...selection });
    expect(usePurchaseStore.getState().purchase).not.toBeNull();
  });
});

describe('sesión de usuario', () => {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  const token = `x.${b64({ sub: 'u1', email: 'ana@example.com', scope: 'attractions:read attractions:book', exp: 9999999999 })}.sig`;

  beforeEach(() => useAuthStore.getState().clear());

  it('extrae claims y scopes del token', () => {
    const claims = claimsFrom(token);
    expect(claims.sub).toBe('u1');
    expect(claims.email).toBe('ana@example.com');
    expect(claims.scopes).toEqual(['attractions:read', 'attractions:book']);
  });

  it('mantiene el token solo en memoria (no en localStorage ni sessionStorage)', () => {
    useAuthStore.getState().setSession(token, Date.now() + 60_000, claimsFrom(token));
    expect(currentAccessToken()).toBe(token);
    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain(token);
  });

  it('descarta el token expirado y marca la sesión como expirada', () => {
    useAuthStore.getState().setSession(token, Date.now() - 1, claimsFrom(token));
    expect(currentAccessToken()).toBeNull();
    expect(useAuthStore.getState().sessionExpired).toBe(true);
  });
});
