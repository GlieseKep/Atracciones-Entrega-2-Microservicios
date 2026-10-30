import {
  GraphQLError,
  Kind,
  type ASTVisitor,
  type FragmentDefinitionNode,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
} from 'graphql';
import type { ApolloServerPlugin } from '@apollo/server';
import { fieldExtensionsEstimator, getComplexity, simpleEstimator } from 'graphql-query-complexity';

/**
 * Regla de validación: rechaza operaciones más profundas que `maxDepth` (D3 ③). Los fragmentos se expanden y los
 * campos de introspección (`__schema`, `__type`) no cuentan.
 */
export function depthLimit(maxDepth: number) {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const def of context.getDocument().definitions) if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);

    const depthOf = (set: SelectionSetNode | undefined, depth: number, visited: Set<string>): number => {
      if (!set) return depth;
      let max = depth;
      for (const selection of set.selections) {
        if (selection.kind === Kind.FIELD) {
          if (selection.name.value.startsWith('__')) continue;
          max = Math.max(max, depthOf(selection.selectionSet, depth + 1, visited));
        } else if (selection.kind === Kind.INLINE_FRAGMENT) {
          max = Math.max(max, depthOf(selection.selectionSet, depth, visited));
        } else {
          const name = selection.name.value;
          const fragment = fragments.get(name);
          if (fragment && !visited.has(name)) max = Math.max(max, depthOf(fragment.selectionSet, depth, new Set([...visited, name])));
        }
      }
      return max;
    };

    return {
      OperationDefinition(node: OperationDefinitionNode) {
        const depth = depthOf(node.selectionSet, 0, new Set());
        if (depth > maxDepth) {
          context.reportError(new GraphQLError(`La operación tiene profundidad ${depth}; el máximo permitido es ${maxDepth}.`, {
            // Apollo usa GRAPHQL_VALIDATION_FAILED como `code` de todo error de validación: el motivo va en `reason`.
            nodes: [node], extensions: { reason: 'QUERY_TOO_DEEP', status: 400, http: { status: 400 } },
          }));
        }
      },
    };
  };
}

/**
 * Plugin de complejidad: cada campo cuesta 1 y los campos de lista multiplican el costo de sus hijos por el argumento
 * `limit` (o el `complexity` declarado en las extensiones del campo). Se evalúa antes de ejecutar.
 */
export function complexityLimit(maxComplexity: number): ApolloServerPlugin {
  return {
    async requestDidStart({ schema }: { schema: GraphQLSchema }) {
      return {
        async didResolveOperation({ request, document }) {
          const complexity = getComplexity({
            schema,
            operationName: request.operationName ?? undefined,
            query: document,
            variables: request.variables ?? {},
            estimators: [
              fieldExtensionsEstimator(),
              ({ args, childComplexity }) => (typeof args.limit === 'number' && childComplexity > 0 ? 1 + args.limit * childComplexity : undefined),
              simpleEstimator({ defaultComplexity: 1 }),
            ],
          });
          if (complexity > maxComplexity) {
            throw new GraphQLError(`La operación es demasiado compleja (${complexity}); el máximo permitido es ${maxComplexity}.`, {
              extensions: { code: 'BAD_REQUEST', reason: 'QUERY_TOO_COMPLEX', status: 400, http: { status: 400 } },
            });
          }
        },
      };
    },
  };
}
