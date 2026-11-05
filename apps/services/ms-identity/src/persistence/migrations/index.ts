import { IdentitySchema1796000000000 } from './1796000000000-IdentitySchema';
import { ClientesTuristas1796000000200 } from './1796000000200-ClientesTuristas';
import { IdentityOutbox1796000000300 } from './1796000000300-IdentityOutbox';

/** Migraciones en orden. Se registran como clases para que funcionen igual compiladas y en las pruebas. */
export const MIGRATIONS = [IdentitySchema1796000000000, ClientesTuristas1796000000200, IdentityOutbox1796000000300];
