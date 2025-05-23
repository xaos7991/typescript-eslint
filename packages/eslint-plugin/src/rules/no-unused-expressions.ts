import { AST_NODE_TYPES, TSESTree } from '@typescript-eslint/utils';

import type {
  InferMessageIdsTypeFromRule,
  InferOptionsTypeFromRule,
} from '../util';

import { createRule } from '../util';
import { getESLintCoreRule } from '../util/getESLintCoreRule';

const baseRule = getESLintCoreRule('no-unused-expressions');

export type MessageIds = InferMessageIdsTypeFromRule<typeof baseRule>;
export type Options = InferOptionsTypeFromRule<typeof baseRule>;

const defaultOptions: Options = [
  {
    allowShortCircuit: false,
    allowTaggedTemplates: false,
    allowTernary: false,
  },
];

export default createRule<Options, MessageIds>({
  name: 'no-unused-expressions',
  meta: {
    type: 'suggestion',
    defaultOptions,
    docs: {
      description: 'Disallow unused expressions',
      extendsBaseRule: true,
      recommended: 'recommended',
    },
    hasSuggestions: baseRule.meta.hasSuggestions,
    messages: baseRule.meta.messages,
    schema: baseRule.meta.schema,
  },
  defaultOptions,
  create(context, [{ allowShortCircuit = false, allowTernary = false }]) {
    const rules = baseRule.create(context);

    function isValidExpression(node: TSESTree.Node): boolean {
      if (allowShortCircuit && node.type === AST_NODE_TYPES.LogicalExpression) {
        return isValidExpression(node.right);
      }
      if (allowTernary && node.type === AST_NODE_TYPES.ConditionalExpression) {
        return (
          isValidExpression(node.alternate) &&
          isValidExpression(node.consequent)
        );
      }
      return (
        (node.type === AST_NODE_TYPES.ChainExpression &&
          node.expression.type === AST_NODE_TYPES.CallExpression) ||
        node.type === AST_NODE_TYPES.ImportExpression
      );
    }

    return {
      ExpressionStatement(node): void {
        if (node.directive || isValidExpression(node.expression)) {
          return;
        }

        const expressionType = node.expression.type;

        if (
          expressionType ===
            TSESTree.AST_NODE_TYPES.TSInstantiationExpression ||
          expressionType === TSESTree.AST_NODE_TYPES.TSAsExpression ||
          expressionType === TSESTree.AST_NODE_TYPES.TSNonNullExpression ||
          expressionType === TSESTree.AST_NODE_TYPES.TSTypeAssertion
        ) {
          rules.ExpressionStatement({
            ...node,
            expression: node.expression.expression,
          });
          return;
        }

        rules.ExpressionStatement(node);
      },
    };
  },
});
