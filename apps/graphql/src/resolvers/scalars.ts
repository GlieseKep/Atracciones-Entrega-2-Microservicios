import { GraphQLScalarType, Kind } from 'graphql';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const parseDate = (value: unknown): string => {
  if (typeof value !== 'string' || !DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new TypeError('Date debe tener el formato YYYY-MM-DD.');
  }
  return value;
};

export const scalars = {
  Date: new GraphQLScalarType({
    name: 'Date',
    serialize: (value) => String(value).slice(0, 10),
    parseValue: parseDate,
    parseLiteral: (ast) => parseDate(ast.kind === Kind.STRING ? ast.value : null),
  }),
  DateTime: new GraphQLScalarType({
    name: 'DateTime',
    serialize: (value) => (value instanceof Date ? value.toISOString() : new Date(String(value)).toISOString()),
    parseValue: (value) => new Date(String(value)).toISOString(),
  }),
  JSON: new GraphQLScalarType({
    name: 'JSON',
    serialize: (value) => value,
    parseValue: (value) => value,
  }),
};
