import type { PagedResponse } from '@/types/api';
import type { Customer, UpdateCustomerRequest } from '@/types/identity';
import type { Reservation, ReservationListParams } from '@/types/reservation';
import { http } from './client';

export const getMyCustomer = (signal?: AbortSignal) => http.get<Customer>('/customers/me', { signal });

export const updateMyCustomer = (body: UpdateCustomerRequest) => http.put<Customer>('/customers/me', body);

export const listMyReservations = (params: ReservationListParams = {}, signal?: AbortSignal) =>
  http.get<PagedResponse<Reservation>>('/customers/me/reservations', { query: { ...params }, signal });
