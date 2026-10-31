import type { IsoDateTime } from './api';

/** Tipos de identidad y perfil (AtraccionesService.Contracts/Identity). */

export interface RegisterProfileRequest {
  billingName?: string;
  billingEmail?: string;
  billingAddress?: string;
  taxId?: string;
}

export interface RegisterProfileResponse {
  id: string;
  email: string;
  status: string;
  customerId: string;
  createdAt: IsoDateTime;
}

export interface User {
  id: string;
  email: string;
  status: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface Customer {
  id: string;
  userId: string;
  billingName?: string | null;
  billingEmail?: string | null;
  billingAddress?: string | null;
  taxId?: string | null;
  paymentMethodReference?: string | null;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface UpdateCustomerRequest {
  billingName: string;
  billingEmail: string;
  billingAddress: string;
  taxId?: string;
  paymentMethodReference?: string;
}
