import { fieldName, OPERATIONS, type Operation } from './operations';

const field = (op: Operation) =>
  `  "${op.service}.${op.operation} del ESB."\n  ${fieldName(op)}(input: JSON${op.idempotent ? ', idempotencyKey: ID!' : ''}): JSON`;

const fields = (kind: Operation['kind']) => OPERATIONS.filter((op) => op.kind === kind).map(field).join('\n');

/**
 * Esquema GraphQL del portal. Cada operación del portal (`operations.ts`) es un campo con su entrada en `input`; la
 * respuesta es la del servicio, con los nombres de su contrato (`Plan/ms_*`). Los permisos los aplica cada servicio.
 */
export const typeDefs = /* GraphQL */ `
  "Valor JSON: la entrada o la respuesta de un servicio, con los nombres de su contrato."
  scalar JSON

  type ServiceHealth { service: String!, status: String!, latencyMs: Int!, databaseConnected: Boolean, error: String }
  type SystemHealth { status: String!, checkedAt: String!, services: [ServiceHealth!]! }

  type Query {
    "Usuario de la sesión, o null sin sesión o con una X-API-Key."
    me: JSON
    "Salud de cada servicio (rol ADMIN)."
    systemHealth: SystemHealth!
${fields('query')}
  }

  type Mutation {
${fields('mutation')}
  }
`;
