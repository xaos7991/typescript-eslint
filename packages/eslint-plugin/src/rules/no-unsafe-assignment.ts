import type { TSESTree } from '@typescript-eslint/utils';
import type * as ts from 'typescript';

import { AST_NODE_TYPES } from '@typescript-eslint/utils';
import * as tsutils from 'ts-api-utils';

import {
  createRule,
  getConstrainedTypeAtLocation,
  getContextualType,
  getParserServices,
  getThisExpression,
  isTypeAnyArrayType,
  isTypeAnyType,
  isTypeUnknownType,
  isUnsafeAssignment,
  nullThrows,
  NullThrowsReasons,
} from '../util';

const enum ComparisonType {
  /** Do no assignment comparison */
  None,
  /** Use the receiver's type for comparison */
  Basic,
  /** Use the sender's contextual type for comparison */
  Contextual,
}

export default createRule({
  name: 'no-unsafe-assignment',
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow assigning a value with type `any` to variables and properties',
      recommended: 'recommended',
      requiresTypeChecking: true,
    },
    messages: {
      anyAssignment: 'Unsafe assignment of an {{sender}} value.',
      anyAssignmentThis: [
        'Unsafe assignment of an {{sender}} value. `this` is typed as `any`.',
        'You can try to fix this by turning on the `noImplicitThis` compiler option, or adding a `this` parameter to the function.',
      ].join('\n'),
      unsafeArrayPattern:
        'Unsafe array destructuring of an {{sender}} array value.',
      unsafeArrayPatternFromTuple:
        'Unsafe array destructuring of a tuple element with an {{sender}} value.',
      unsafeArraySpread: 'Unsafe spread of an {{sender}} value in an array.',
      unsafeAssignment:
        'Unsafe assignment of type {{sender}} to a variable of type {{receiver}}.',
    },
    schema: [],
  },
  defaultOptions: [],
  create(context) {
    const services = getParserServices(context);
    const checker = services.program.getTypeChecker();
    const compilerOptions = services.program.getCompilerOptions();
    const isNoImplicitThis = tsutils.isStrictCompilerOptionEnabled(
      compilerOptions,
      'noImplicitThis',
    );

    // returns true if the assignment reported
    function checkArrayDestructureHelper(
      receiverNode: TSESTree.Node,
      senderNode: TSESTree.Node,
    ): boolean {
      if (receiverNode.type !== AST_NODE_TYPES.ArrayPattern) {
        return false;
      }

      const senderTsNode = services.esTreeNodeToTSNodeMap.get(senderNode);
      const senderType = services.getTypeAtLocation(senderNode);

      return checkArrayDestructure(receiverNode, senderType, senderTsNode);
    }

    // returns true if the assignment reported
    function checkArrayDestructure(
      receiverNode: TSESTree.ArrayPattern,
      senderType: ts.Type,
      senderNode: ts.Node,
    ): boolean {
      // any array
      // const [x] = ([] as any[]);
      if (isTypeAnyArrayType(senderType, checker)) {
        context.report({
          node: receiverNode,
          messageId: 'unsafeArrayPattern',
          data: createData(senderType),
        });
        return false;
      }

      if (!checker.isTupleType(senderType)) {
        return true;
      }

      const tupleElements = checker.getTypeArguments(senderType);

      // tuple with any
      // const [x] = [1 as any];
      let didReport = false;
      for (
        let receiverIndex = 0;
        receiverIndex < receiverNode.elements.length;
        receiverIndex += 1
      ) {
        const receiverElement = receiverNode.elements[receiverIndex];
        if (!receiverElement) {
          continue;
        }

        if (receiverElement.type === AST_NODE_TYPES.RestElement) {
          // don't handle rests as they're not a 1:1 assignment
          continue;
        }

        const senderType = tupleElements[receiverIndex] as ts.Type | undefined;
        if (!senderType) {
          continue;
        }

        // check for the any type first so we can handle [[[x]]] = [any]
        if (isTypeAnyType(senderType)) {
          context.report({
            node: receiverElement,
            messageId: 'unsafeArrayPatternFromTuple',
            data: createData(senderType),
          });
          // we want to report on every invalid element in the tuple
          didReport = true;
        } else if (receiverElement.type === AST_NODE_TYPES.ArrayPattern) {
          didReport = checkArrayDestructure(
            receiverElement,
            senderType,
            senderNode,
          );
        } else if (receiverElement.type === AST_NODE_TYPES.ObjectPattern) {
          didReport = checkObjectDestructure(
            receiverElement,
            senderType,
            senderNode,
          );
        }
      }

      return didReport;
    }

    // returns true if the assignment reported
    function checkObjectDestructureHelper(
      receiverNode: TSESTree.Node,
      senderNode: TSESTree.Node,
    ): boolean {
      if (receiverNode.type !== AST_NODE_TYPES.ObjectPattern) {
        return false;
      }

      const senderTsNode = services.esTreeNodeToTSNodeMap.get(senderNode);
      const senderType = services.getTypeAtLocation(senderNode);

      return checkObjectDestructure(receiverNode, senderType, senderTsNode);
    }

    // returns true if the assignment reported
    function checkObjectDestructure(
      receiverNode: TSESTree.ObjectPattern,
      senderType: ts.Type,
      senderNode: ts.Node,
    ): boolean {
      const properties = new Map(
        senderType
          .getProperties()
          .map(property => [
            property.getName(),
            checker.getTypeOfSymbolAtLocation(property, senderNode),
          ]),
      );

      let didReport = false;
      for (const receiverProperty of receiverNode.properties) {
        if (receiverProperty.type === AST_NODE_TYPES.RestElement) {
          // don't bother checking rest
          continue;
        }

        let key: string;
        if (!receiverProperty.computed) {
          key =
            receiverProperty.key.type === AST_NODE_TYPES.Identifier
              ? receiverProperty.key.name
              : String(receiverProperty.key.value);
        } else if (receiverProperty.key.type === AST_NODE_TYPES.Literal) {
          key = String(receiverProperty.key.value);
        } else if (
          receiverProperty.key.type === AST_NODE_TYPES.TemplateLiteral &&
          receiverProperty.key.quasis.length === 1
        ) {
          key = receiverProperty.key.quasis[0].value.cooked;
        } else {
          // can't figure out the name, so skip it
          continue;
        }

        const senderType = properties.get(key);
        if (!senderType) {
          continue;
        }

        // check for the any type first so we can handle {x: {y: z}} = {x: any}
        if (isTypeAnyType(senderType)) {
          context.report({
            node: receiverProperty.value,
            messageId: 'unsafeArrayPatternFromTuple',
            data: createData(senderType),
          });
          didReport = true;
        } else if (
          receiverProperty.value.type === AST_NODE_TYPES.ArrayPattern
        ) {
          didReport = checkArrayDestructure(
            receiverProperty.value,
            senderType,
            senderNode,
          );
        } else if (
          receiverProperty.value.type === AST_NODE_TYPES.ObjectPattern
        ) {
          didReport = checkObjectDestructure(
            receiverProperty.value,
            senderType,
            senderNode,
          );
        }
      }

      return didReport;
    }

    // returns true if the assignment reported
    function checkAssignment(
      receiverNode: TSESTree.Node,
      senderNode: TSESTree.Expression,
      reportingNode: TSESTree.Node,
      comparisonType: ComparisonType,
    ): boolean {
      const receiverTsNode = services.esTreeNodeToTSNodeMap.get(receiverNode);
      const receiverType =
        comparisonType === ComparisonType.Contextual
          ? (getContextualType(checker, receiverTsNode as ts.Expression) ??
            services.getTypeAtLocation(receiverNode))
          : services.getTypeAtLocation(receiverNode);
      const senderType = services.getTypeAtLocation(senderNode);

      if (isTypeAnyType(senderType)) {
        // handle cases when we assign any ==> unknown.
        if (isTypeUnknownType(receiverType)) {
          return false;
        }

        let messageId: 'anyAssignment' | 'anyAssignmentThis' = 'anyAssignment';

        if (!isNoImplicitThis) {
          // `var foo = this`
          const thisExpression = getThisExpression(senderNode);
          if (
            thisExpression &&
            isTypeAnyType(
              getConstrainedTypeAtLocation(services, thisExpression),
            )
          ) {
            messageId = 'anyAssignmentThis';
          }
        }

        context.report({
          node: reportingNode,
          messageId,
          data: createData(senderType),
        });

        return true;
      }

      if (comparisonType === ComparisonType.None) {
        return false;
      }

      const result = isUnsafeAssignment(
        senderType,
        receiverType,
        checker,
        senderNode,
      );
      if (!result) {
        return false;
      }

      const { receiver, sender } = result;
      context.report({
        node: reportingNode,
        messageId: 'unsafeAssignment',
        data: createData(sender, receiver),
      });
      return true;
    }

    function getComparisonType(
      typeAnnotation: TSESTree.TSTypeAnnotation | undefined,
    ): ComparisonType {
      return typeAnnotation
        ? // if there's a type annotation, we can do a comparison
          ComparisonType.Basic
        : // no type annotation means the variable's type will just be inferred, thus equal
          ComparisonType.None;
    }

    function createData(
      senderType: ts.Type,
      receiverType?: ts.Type,
    ): Readonly<Record<string, unknown>> | undefined {
      if (receiverType) {
        return {
          receiver: `\`${checker.typeToString(receiverType)}\``,
          sender: `\`${checker.typeToString(senderType)}\``,
        };
      }
      return {
        sender: tsutils.isIntrinsicErrorType(senderType)
          ? 'error typed'
          : '`any`',
      };
    }

    return {
      'AccessorProperty[value != null]'(
        node: { value: NonNullable<unknown> } & TSESTree.AccessorProperty,
      ): void {
        checkAssignment(
          node.key,
          node.value,
          node,
          getComparisonType(node.typeAnnotation),
        );
      },
      'AssignmentExpression[operator = "="], AssignmentPattern'(
        node: TSESTree.AssignmentExpression | TSESTree.AssignmentPattern,
      ): void {
        let didReport = checkAssignment(
          node.left,
          node.right,
          node,
          // the variable already has some form of a type to compare against
          ComparisonType.Basic,
        );

        if (!didReport) {
          didReport = checkArrayDestructureHelper(node.left, node.right);
        }
        if (!didReport) {
          checkObjectDestructureHelper(node.left, node.right);
        }
      },
      'PropertyDefinition[value != null]'(
        node: { value: NonNullable<unknown> } & TSESTree.PropertyDefinition,
      ): void {
        checkAssignment(
          node.key,
          node.value,
          node,
          getComparisonType(node.typeAnnotation),
        );
      },
      'VariableDeclarator[init != null]'(
        node: TSESTree.VariableDeclarator,
      ): void {
        const init = nullThrows(
          node.init,
          NullThrowsReasons.MissingToken(node.type, 'init'),
        );
        let didReport = checkAssignment(
          node.id,
          init,
          node,
          getComparisonType(node.id.typeAnnotation),
        );

        if (!didReport) {
          didReport = checkArrayDestructureHelper(node.id, init);
        }
        if (!didReport) {
          checkObjectDestructureHelper(node.id, init);
        }
      },
      // object pattern props are checked via assignments
      ':not(ObjectPattern) > Property'(node: TSESTree.Property): void {
        if (
          node.value.type === AST_NODE_TYPES.AssignmentPattern ||
          node.value.type === AST_NODE_TYPES.TSEmptyBodyFunctionExpression
        ) {
          // handled by other selector
          return;
        }

        checkAssignment(node.key, node.value, node, ComparisonType.Contextual);
      },
      'ArrayExpression > SpreadElement'(node: TSESTree.SpreadElement): void {
        const restType = services.getTypeAtLocation(node.argument);
        if (isTypeAnyType(restType) || isTypeAnyArrayType(restType, checker)) {
          context.report({
            node,
            messageId: 'unsafeArraySpread',
            data: createData(restType),
          });
        }
      },
      'JSXAttribute[value != null]'(node: TSESTree.JSXAttribute): void {
        const value = nullThrows(
          node.value,
          NullThrowsReasons.MissingToken(node.type, 'value'),
        );
        if (
          value.type !== AST_NODE_TYPES.JSXExpressionContainer ||
          value.expression.type === AST_NODE_TYPES.JSXEmptyExpression
        ) {
          return;
        }

        checkAssignment(
          node.name,
          value.expression,
          value.expression,
          ComparisonType.Contextual,
        );
      },
    };
  },
});
