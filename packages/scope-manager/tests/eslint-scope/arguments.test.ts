import { ScopeType } from '../../src/index.js';
import { getRealVariables, parseAndAnalyze } from '../test-utils/index.js';

describe('arguments', () => {
  it('arguments are correctly materialized', () => {
    const { scopeManager } = parseAndAnalyze(`
      (function () {
        arguments;
      }());
    `);

    expect(scopeManager.scopes).toHaveLength(2);

    let scope = scopeManager.scopes[0];
    let variables = getRealVariables(scope.variables);
    assert.isScopeOfType(scope, ScopeType.global);
    expect(variables).toHaveLength(0);
    expect(scope.references).toHaveLength(0);

    scope = scopeManager.scopes[1];
    variables = getRealVariables(scope.variables);
    assert.isScopeOfType(scope, ScopeType.function);
    expect(variables).toHaveLength(1);
    expect(variables[0].name).toBe('arguments');
    expect(scope.references).toHaveLength(1);
    expect(scope.references[0].resolved).toBe(variables[0]);
  });
});
