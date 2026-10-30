import { AppError } from '@atracciones/platform';
import type { GraphqlContext } from '../context';
import type { BillingDto, ProfileDto } from '../dto';
import { toProfile } from '../mappers';

const toBilling = (b: BillingDto) => ({
  documentType: b.tipo_documento, documentId: b.numero_documento, legalName: b.razon_social, email: b.email, phone: b.telefono, address: b.direccion, updatedAt: b.actualizado_en,
});

export const accountResolvers = {
  Query: {
    /** Usuario de la sesión (`null` sin sesión o si la credencial es una X-API-Key de socio). */
    me: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      if (ctx.principal?.tipo !== 'USUARIO') return null;
      try {
        return toProfile(await ctx.esb.call<ProfileDto>('identity', 'getProfile'), ctx.principal.scopes);
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return null;
        throw error;
      }
    },
    myBilling: async (_: unknown, __: unknown, ctx: GraphqlContext) => {
      ctx.requireUser();
      const { facturacion } = await ctx.esb.call<{ facturacion: BillingDto | null }>('identity', 'getBilling');
      return facturacion ? toBilling(facturacion) : null;
    },
  },
  Mutation: {
    updateProfile: async (_: unknown, args: { fullName: string }, ctx: GraphqlContext) => {
      ctx.requireUser();
      return toProfile(await ctx.esb.call<ProfileDto>('identity', 'updateProfile', { nombre_completo: args.fullName }), ctx.principal!.scopes);
    },
    saveBilling: async (_: unknown, { input }: { input: Record<string, string | null> }, ctx: GraphqlContext) => {
      ctx.requireUser();
      return toBilling(await ctx.esb.call<BillingDto>('identity', 'saveBilling', {
        tipo_documento: input.documentType, numero_documento: input.documentId, razon_social: input.legalName, email: input.email,
        telefono: input.phone ?? null, direccion: input.address ?? null,
      }));
    },
  },
};
