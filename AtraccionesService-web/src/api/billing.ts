import type { BillingProfile, BillingProfileInput } from '@/types/billing';
import { gql } from './client';

/** Perfiles de facturación del usuario (ms-billing-profile). */

export const listBillingProfiles = (signal?: AbortSignal) => gql.query<BillingProfile[]>('billingListProfiles', {}, { signal });

export const createBillingProfile = (body: BillingProfileInput) => gql.mutation<BillingProfile>('billingCreateProfile', body);

export const replaceBillingProfile = (id: number, body: BillingProfileInput) => gql.mutation<BillingProfile>('billingReplaceProfile', { id, ...body });

export const deleteBillingProfile = (id: number) => gql.mutation<void>('billingDeleteProfile', { id });

export const markPrincipalBillingProfile = (id: number) => gql.mutation<BillingProfile>('billingMarkPrincipal', { id });
