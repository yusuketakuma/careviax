import { ts, unresolvedPermissionMarker, unwrapExpression } from './core.mjs';

export function createPermissionCheckAnalyzer({
  analyzePermissionOptions,
  authPermissionEntrypoints,
  canonicalPermissionEvaluatorModules,
  containsNode,
  importedIdentifierNames,
  importedIdentifiers,
  resolveCallable,
  resolveExpression,
  resolveStaticScalar,
  resolveValueNode,
  selectObjectMember,
  source,
  staticPropertyName,
  variables,
  visibleDeclaration,
  visibleDestructuredValueBinding,
}) {
  const analyzePermissionChecks = (
    root,
    seen = new Set(),
    suppressRootUnresolvedWrapper = false,
  ) => {
    const values = new Set();
    const staticMemberName = (expression) =>
      ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : ts.isElementAccessExpression(expression)
          ? resolveStaticScalar(expression.argumentExpression)
          : undefined;
    const memberReceiver = (expression) =>
      ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)
        ? expression.expression
        : undefined;
    const resolvedMemberExpression = (expression) => {
      const resolved = resolveValueNode(expression);
      return resolved && memberReceiver(resolved) ? resolved : expression;
    };
    const isReflectReceiver = (expression) => {
      if (!expression) return false;
      const candidate = unwrapExpression(expression);
      if (ts.isIdentifier(candidate) && candidate.text === 'Reflect') return true;
      const resolved = resolveValueNode(candidate);
      return Boolean(
        resolved &&
        resolved !== candidate &&
        ts.isIdentifier(unwrapExpression(resolved)) &&
        unwrapExpression(resolved).text === 'Reflect',
      );
    };
    const isDestructuredReflectApply = (expression) => {
      const candidate = expression && unwrapExpression(expression);
      if (!candidate || !ts.isIdentifier(candidate)) return false;
      const binding = visibleDestructuredValueBinding(candidate.text, candidate);
      return Boolean(
        binding &&
        staticPropertyName(binding.propertyName) === 'apply' &&
        isReflectReceiver(binding.initializer),
      );
    };
    const isRegisteredObjectCallbackBoundary = (invocation) => {
      const registeredName = (name) =>
        /^(?:IntersectionObserver|MutationObserver|ReadableStream|ResizeObserver|TransformStream|WritableStream|runTask)$/.test(
          name,
        ) || /^(?:create|register)[A-Za-z0-9_]*(?:Handler|Hook|Stream|Task)$/.test(name);
      const resolveBoundary = (expression, boundarySeen = new Set()) => {
        if (!expression) return false;
        const candidate = unwrapExpression(expression);
        if (ts.isIdentifier(candidate)) {
          if (registeredName(candidate.text)) return true;
          const destructured = visibleDestructuredValueBinding(candidate.text, candidate);
          if (destructured) {
            const propertyName = staticPropertyName(destructured.propertyName, boundarySeen);
            if (typeof propertyName === 'string' && registeredName(propertyName)) return true;
            const selected = resolveValueNode(candidate, boundarySeen);
            if (selected && selected !== candidate) {
              return resolveBoundary(selected, boundarySeen);
            }
          }
          const declaration = visibleDeclaration(variables.get(candidate.text), candidate);
          if (declaration) {
            const key = `boundary:${declaration.pos}`;
            if (boundarySeen.has(key)) return false;
            const nextSeen = new Set(boundarySeen).add(key);
            if (resolveBoundary(declaration.initializer, nextSeen)) return true;
            let assignedBoundary = false;
            const visitAssignment = (node) => {
              if (assignedBoundary || node.pos >= invocation.pos) return;
              if (
                ts.isBinaryExpression(node) &&
                node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
                ts.isIdentifier(unwrapExpression(node.left)) &&
                visibleDeclaration(
                  variables.get(unwrapExpression(node.left).text),
                  unwrapExpression(node.left),
                ) === declaration &&
                resolveBoundary(node.right, nextSeen)
              ) {
                assignedBoundary = true;
                return;
              }
              ts.forEachChild(node, visitAssignment);
            };
            visitAssignment(source);
            return assignedBoundary;
          }
          if (importedIdentifiers.has(candidate.text)) {
            return registeredName(importedIdentifierNames.get(candidate.text) ?? candidate.text);
          }
          return false;
        }
        if (ts.isConditionalExpression(candidate)) {
          return (
            resolveBoundary(candidate.whenTrue, boundarySeen) ||
            resolveBoundary(candidate.whenFalse, boundarySeen)
          );
        }
        if (
          ts.isBinaryExpression(candidate) &&
          [
            ts.SyntaxKind.AmpersandAmpersandToken,
            ts.SyntaxKind.BarBarToken,
            ts.SyntaxKind.QuestionQuestionToken,
          ].includes(candidate.operatorToken.kind)
        ) {
          return (
            resolveBoundary(candidate.left, boundarySeen) ||
            resolveBoundary(candidate.right, boundarySeen)
          );
        }
        if (
          ts.isBinaryExpression(candidate) &&
          candidate.operatorToken.kind === ts.SyntaxKind.CommaToken
        ) {
          return resolveBoundary(candidate.right, boundarySeen);
        }
        if (ts.isCallExpression(candidate)) {
          if (
            ts.isPropertyAccessExpression(candidate.expression) &&
            ['call', 'apply'].includes(candidate.expression.name.text) &&
            resolveBoundary(candidate.expression.expression, boundarySeen)
          ) {
            return true;
          }
          if (
            ts.isPropertyAccessExpression(candidate.expression) &&
            ts.isIdentifier(candidate.expression.expression) &&
            candidate.expression.expression.text === 'Reflect' &&
            candidate.expression.name.text === 'apply' &&
            candidate.arguments[0] &&
            resolveBoundary(candidate.arguments[0], boundarySeen)
          ) {
            return true;
          }
          const bindReceiver =
            ts.isPropertyAccessExpression(candidate.expression) &&
            candidate.expression.name.text === 'bind'
              ? candidate.expression.expression
              : ts.isElementAccessExpression(candidate.expression) &&
                  resolveStaticScalar(candidate.expression.argumentExpression) === 'bind'
                ? candidate.expression.expression
                : undefined;
          if (bindReceiver && resolveBoundary(bindReceiver, boundarySeen)) return true;
          if (
            resolveBoundary(candidate.expression, boundarySeen) ||
            candidate.arguments.some((argument) => resolveBoundary(argument, boundarySeen))
          ) {
            return true;
          }
          const factoryCallable = resolveCallable(candidate.expression);
          const factoryTargets =
            factoryCallable.kind === 'target'
              ? [factoryCallable.target]
              : factoryCallable.kind === 'targets'
                ? factoryCallable.targets
                : [];
          for (const localFactory of factoryTargets) {
            if (
              ts.isArrowFunction(localFactory) &&
              !ts.isBlock(localFactory.body) &&
              resolveBoundary(localFactory.body, boundarySeen)
            ) {
              return true;
            }
            if (localFactory?.body && ts.isBlock(localFactory.body)) {
              let returnedBoundary = false;
              const visitReturn = (node) => {
                if (returnedBoundary) return;
                if (
                  node !== localFactory &&
                  (ts.isFunctionDeclaration(node) ||
                    ts.isFunctionExpression(node) ||
                    ts.isArrowFunction(node) ||
                    ts.isMethodDeclaration(node))
                ) {
                  return;
                }
                if (
                  ts.isReturnStatement(node) &&
                  node.expression &&
                  resolveBoundary(node.expression, boundarySeen)
                ) {
                  returnedBoundary = true;
                  return;
                }
                ts.forEachChild(node, visitReturn);
              };
              visitReturn(localFactory.body);
              if (returnedBoundary) return true;
            }
          }
          return false;
        }
        if (ts.isPropertyAccessExpression(candidate) && registeredName(candidate.name.text)) {
          return true;
        }
        if (ts.isElementAccessExpression(candidate)) {
          const propertyName = resolveStaticScalar(candidate.argumentExpression);
          if (typeof propertyName === 'string' && registeredName(propertyName)) return true;
        }
        const selected = resolveValueNode(candidate);
        return Boolean(
          selected && selected !== candidate && resolveBoundary(selected, boundarySeen),
        );
      };
      if (ts.isCallExpression(invocation)) {
        const invocationExpression = resolvedMemberExpression(invocation.expression);
        const invocationMember = staticMemberName(invocationExpression);
        const invocationReceiver = memberReceiver(invocationExpression);
        if (
          ['call', 'apply'].includes(invocationMember) &&
          invocationReceiver &&
          resolveBoundary(invocationReceiver)
        ) {
          return true;
        }
        if (
          isReflectReceiver(invocationReceiver) &&
          invocationMember === 'apply' &&
          invocation.arguments[0] &&
          resolveBoundary(invocation.arguments[0])
        ) {
          return true;
        }
        if (
          isDestructuredReflectApply(invocation.expression) &&
          invocation.arguments[0] &&
          resolveBoundary(invocation.arguments[0])
        ) {
          return true;
        }
      }
      if (invocation.expression && resolveBoundary(invocation.expression)) return true;
      if (ts.isNewExpression(invocation)) {
        const constructor = unwrapExpression(invocation.expression);
        if (ts.isCallExpression(constructor)) return true;
      }
      return false;
    };
    const registeredInvocationArguments = (invocation) => {
      if (!ts.isCallExpression(invocation)) return [...(invocation.arguments ?? [])];
      const invocationExpression = resolvedMemberExpression(invocation.expression);
      const invocationMember = staticMemberName(invocationExpression);
      const invocationReceiver = memberReceiver(invocationExpression);
      if (invocationMember === 'call') {
        return [...invocation.arguments].slice(1);
      }
      const isApply = invocationMember === 'apply';
      const isReflectApply =
        (isReflectReceiver(invocationReceiver) && invocationMember === 'apply') ||
        isDestructuredReflectApply(invocation.expression);
      if (isApply || isReflectApply) {
        const packed = invocation.arguments[isReflectApply ? 2 : 1];
        const resolved = packed && resolveValueNode(packed);
        return resolved && ts.isArrayLiteralExpression(resolved)
          ? [...resolved.elements].filter((element) => !ts.isOmittedExpression(element))
          : packed
            ? [packed]
            : [];
      }
      return [...invocation.arguments];
    };
    const rootIdentifier = (expression) => {
      let current = unwrapExpression(expression);
      while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
        current = unwrapExpression(current.expression);
      }
      return ts.isIdentifier(current) ? current : undefined;
    };
    const objectAliasWasMutated = (identifier, invocation) => {
      const rootDeclaration = visibleDeclaration(variables.get(identifier.text), identifier);
      if (!rootDeclaration) return true;
      const aliases = new Set([rootDeclaration]);
      const declarationForIdentifier = (candidate) =>
        candidate && ts.isIdentifier(candidate)
          ? visibleDeclaration(variables.get(candidate.text), candidate)
          : undefined;
      let changed = true;
      while (changed) {
        changed = false;
        const collectAliases = (node) => {
          if (node.pos >= invocation.pos) return;
          if (
            ts.isVariableDeclaration(node) &&
            ts.isIdentifier(node.name) &&
            node.initializer &&
            ts.isIdentifier(unwrapExpression(node.initializer))
          ) {
            const target = declarationForIdentifier(unwrapExpression(node.initializer));
            if (
              (aliases.has(node) || aliases.has(target)) &&
              !(aliases.has(node) && aliases.has(target))
            ) {
              aliases.add(node);
              if (target) aliases.add(target);
              changed = true;
            }
          }
          ts.forEachChild(node, collectAliases);
        };
        collectAliases(source);
      }
      const referencesAlias = (node) => {
        let found = false;
        const visitReference = (current) => {
          if (found) return;
          if (ts.isIdentifier(current)) {
            const parent = current.parent;
            const isPropertyName =
              (ts.isPropertyAccessExpression(parent) && parent.name === current) ||
              ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent)) &&
                parent.name === current) ||
              (ts.isVariableDeclaration(parent) && parent.name === current);
            if (!isPropertyName && aliases.has(declarationForIdentifier(current))) found = true;
            return;
          }
          ts.forEachChild(current, visitReference);
        };
        visitReference(node);
        return found;
      };
      const rootIsAlias = (expression) => {
        const root = rootIdentifier(expression);
        return Boolean(root && aliases.has(declarationForIdentifier(root)));
      };
      let mutated = false;
      const visitMutation = (node) => {
        if (mutated || node.pos >= invocation.pos) return;
        const enclosesInvocation = node !== source && containsNode(node, invocation);
        if (!enclosesInvocation && ts.isVariableDeclaration(node) && node.initializer) {
          const initializer = unwrapExpression(node.initializer);
          const directAlias =
            ts.isIdentifier(initializer) &&
            aliases.has(node) &&
            aliases.has(declarationForIdentifier(initializer));
          if (!directAlias && referencesAlias(initializer)) {
            mutated = true;
            return;
          }
        }
        if (
          !enclosesInvocation &&
          ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          (rootIsAlias(node.left) || referencesAlias(node.right))
        ) {
          mutated = true;
          return;
        }
        if (
          !enclosesInvocation &&
          ts.isCallExpression(node) &&
          (node.arguments.some((argument) => referencesAlias(argument)) ||
            (ts.isPropertyAccessExpression(node.expression) &&
              rootIsAlias(node.expression.expression)))
        ) {
          mutated = true;
          return;
        }
        if (
          !enclosesInvocation &&
          (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
          rootIsAlias(node.operand)
        ) {
          mutated = true;
          return;
        }
        if (!enclosesInvocation && ts.isDeleteExpression(node) && rootIsAlias(node.expression)) {
          mutated = true;
          return;
        }
        if (
          !enclosesInvocation &&
          ts.isReturnStatement(node) &&
          node.expression &&
          referencesAlias(node.expression)
        ) {
          mutated = true;
          return;
        }
        ts.forEachChild(node, visitMutation);
      };
      visitMutation(source);
      return mutated;
    };
    const objectCallbackArgumentNeedsFailClose = (argument, invocation) => {
      if (!isRegisteredObjectCallbackBoundary(invocation)) return false;
      const candidate = unwrapExpression(argument);
      if (ts.isObjectLiteralExpression(candidate)) {
        return candidate.properties.some((property) => ts.isSpreadAssignment(property));
      }
      if (
        ts.isStringLiteralLike(candidate) ||
        ts.isNumericLiteral(candidate) ||
        ts.isArrayLiteralExpression(candidate) ||
        ts.isArrowFunction(candidate) ||
        ts.isFunctionExpression(candidate) ||
        candidate.kind === ts.SyntaxKind.TrueKeyword ||
        candidate.kind === ts.SyntaxKind.FalseKeyword ||
        candidate.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(candidate) && candidate.text === 'undefined')
      ) {
        return false;
      }
      if (ts.isIdentifier(candidate)) {
        const resolved = resolveValueNode(candidate);
        if (
          resolved &&
          (ts.isArrowFunction(resolved) ||
            ts.isFunctionExpression(resolved) ||
            ts.isMethodDeclaration(resolved))
        ) {
          return false;
        }
        return (
          !resolved ||
          !ts.isObjectLiteralExpression(resolved) ||
          objectAliasWasMutated(candidate, invocation)
        );
      }
      return true;
    };
    const analyzeRegisteredCallableArgument = (argument, invocation, resolvedArgument) => {
      if (
        !isRegisteredObjectCallbackBoundary(invocation) ||
        (resolvedArgument && ts.isObjectLiteralExpression(resolvedArgument))
      ) {
        return;
      }
      const callback = unwrapExpression(argument);
      const explicitlyNonCallable =
        ts.isStringLiteralLike(callback) ||
        ts.isNumericLiteral(callback) ||
        ts.isArrayLiteralExpression(callback) ||
        callback.kind === ts.SyntaxKind.TrueKeyword ||
        callback.kind === ts.SyntaxKind.FalseKeyword ||
        callback.kind === ts.SyntaxKind.NullKeyword ||
        (ts.isIdentifier(callback) && callback.text === 'undefined');
      if (explicitlyNonCallable) return;
      const callable =
        ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)
          ? { kind: 'target', target: callback }
          : resolveCallable(callback);
      if (!['target', 'targets'].includes(callable.kind)) {
        values.add(unresolvedPermissionMarker(callback, source));
        return;
      }
      const targets = callable.kind === 'target' ? [callable.target] : callable.targets;
      for (const target of targets) {
        if (ts.isCallExpression(target) && resolveCallable(target.expression).kind !== 'auth') {
          values.add(unresolvedPermissionMarker(callback, source));
        }
        const key = `registered-callback:${invocation.pos}:${target.pos}`;
        if (seen.has(key)) continue;
        for (const value of analyzePermissionChecks(target, new Set(seen).add(key))) {
          values.add(value);
        }
      }
    };
    const analyzeObjectCallbackMembers = (objectLiteral, invocation) => {
      const callbackPropertyName = (property) => {
        if (
          ts.isMethodDeclaration(property) ||
          ts.isPropertyAssignment(property) ||
          ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)
        ) {
          return staticPropertyName(property.name);
        }
        if (ts.isShorthandPropertyAssignment(property)) return property.name.text;
        return undefined;
      };
      for (const property of objectLiteral.properties) {
        if (ts.isSpreadAssignment(property)) continue;
        const propertyName = callbackPropertyName(property);
        const registeredObjectCallbackBoundary = isRegisteredObjectCallbackBoundary(invocation);
        const unresolvedComputedProperty =
          'name' in property &&
          ts.isComputedPropertyName(property.name) &&
          propertyName === undefined;
        if (registeredObjectCallbackBoundary && unresolvedComputedProperty) {
          values.add(unresolvedPermissionMarker(property, source));
        }
        const member = ts.isMethodDeclaration(property)
          ? property
          : ts.isPropertyAssignment(property)
            ? unwrapExpression(property.initializer)
            : ts.isShorthandPropertyAssignment(property)
              ? property.name
              : ts.isGetAccessorDeclaration(property) || ts.isSetAccessorDeclaration(property)
                ? property
                : undefined;
        if (!member) continue;
        if (ts.isObjectLiteralExpression(member)) {
          analyzeObjectCallbackMembers(member, invocation);
          continue;
        }
        const callbackField =
          /^(?:action|after|authorize|before|callback|cancel|close|execute|flush|handler|load|on[A-Z_][A-Za-z0-9_]*|pull|run|setup|start|task|teardown|transform|validate|write)$/.test(
            propertyName ?? '',
          );
        if (
          registeredObjectCallbackBoundary &&
          callbackField &&
          (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member))
        ) {
          values.add(unresolvedPermissionMarker(member, source));
          const key = `object-accessor:${invocation.pos}:${member.pos}`;
          if (!seen.has(key)) {
            for (const value of analyzePermissionChecks(member, new Set(seen).add(key))) {
              values.add(value);
            }
          }
          continue;
        }
        const syntacticallyCallable =
          ts.isMethodDeclaration(member) ||
          ts.isArrowFunction(member) ||
          ts.isFunctionExpression(member) ||
          (registeredObjectCallbackBoundary && callbackField);
        if (!syntacticallyCallable) continue;
        const callable =
          ts.isMethodDeclaration(member) ||
          ts.isArrowFunction(member) ||
          ts.isFunctionExpression(member)
            ? { kind: 'target', target: member }
            : resolveCallable(member);
        if (!['target', 'targets'].includes(callable.kind)) {
          values.add(unresolvedPermissionMarker(member, source));
          continue;
        }
        const targets = callable.kind === 'target' ? [callable.target] : callable.targets;
        for (const target of targets) {
          if (ts.isCallExpression(target) && resolveCallable(target.expression).kind !== 'auth') {
            values.add(unresolvedPermissionMarker(member, source));
          }
          const key = `object-callback:${invocation.pos}:${target.pos}`;
          if (seen.has(key)) continue;
          for (const value of analyzePermissionChecks(target, new Set(seen).add(key))) {
            values.add(value);
          }
        }
      }
    };
    const visit = (node) => {
      if (
        node !== root &&
        (ts.isFunctionDeclaration(node) ||
          ts.isFunctionExpression(node) ||
          ts.isArrowFunction(node) ||
          ts.isMethodDeclaration(node))
      ) {
        return;
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression.getText(source);
        const callable = resolveCallable(node.expression);
        const permissionEvaluatorName =
          callable.kind === 'imported'
            ? callable.original
            : callable.kind === 'target' && ts.isFunctionDeclaration(callable.target)
              ? callable.target.name?.text
              : callee;
        const permissionEvaluatorLike =
          permissionEvaluatorName &&
          /(?:has|require|assert|check)[A-Za-z0-9_]*Permission/.test(permissionEvaluatorName);
        const canonicalPermissionEvaluator =
          permissionEvaluatorLike &&
          callable.kind === 'imported' &&
          canonicalPermissionEvaluatorModules.has(callable.moduleSpecifier);
        const authEntrypointName =
          callable.kind === 'imported'
            ? callable.original
            : callable.kind === 'auth'
              ? callable.name
              : callee.split('.').at(-1);
        const noncanonicalAuthEntrypointCall =
          authPermissionEntrypoints.has(authEntrypointName) && callable.kind !== 'auth';
        const hasPermissionOption = node.arguments.slice(1).some((argument) => {
          const option = resolveValueNode(argument);
          return (
            option &&
            ts.isObjectLiteralExpression(option) &&
            Boolean(selectObjectMember(option, 'permission').node)
          );
        });
        const wrapperShapedCall =
          hasPermissionOption ||
          (callable.kind === 'imported' &&
            /(?:secure|authWrapper|permissionWrapper|authGuard|permissionGuard)/i.test(
              `${callable.name}:${callable.original}`,
            ));
        if (
          wrapperShapedCall &&
          !(suppressRootUnresolvedWrapper && node === root) &&
          (callable.kind === 'imported' ||
            callable.kind === 'unresolved' ||
            callable.kind === 'shadowed_auth' ||
            callable.kind === 'shadowed_lexical')
        ) {
          values.add(unresolvedPermissionMarker(node, source));
        }
        if (noncanonicalAuthEntrypointCall) {
          values.add(unresolvedPermissionMarker(node, source));
        }
        if (
          callable.kind === 'auth' &&
          ['requireAuthContext', 'requireApiKeyOrAuthContext'].includes(callable.name)
        ) {
          for (const option of node.arguments.slice(1)) {
            for (const value of analyzePermissionOptions(option)) values.add(value);
          }
        }
        if (callable.kind === 'auth' && callable.name === 'withAuthContext') {
          for (const option of node.arguments.slice(1)) {
            for (const value of analyzePermissionOptions(option)) values.add(value);
          }
          const first = node.arguments[0] && unwrapExpression(node.arguments[0]);
          const resolvedHandler = resolveCallable(first);
          if (resolvedHandler.kind === 'target' || resolvedHandler.kind === 'targets') {
            const targets =
              resolvedHandler.kind === 'target'
                ? [resolvedHandler.target]
                : resolvedHandler.targets;
            for (const activeHandler of targets) {
              const key = `withAuthContext:${activeHandler.pos}`;
              if (seen.has(key)) continue;
              for (const value of analyzePermissionChecks(activeHandler, new Set(seen).add(key))) {
                values.add(value);
              }
            }
          }
        }
        if (canonicalPermissionEvaluator) {
          const resolved = new Set();
          const permissionArguments = /(?:^|[.])hasPermission$/.test(permissionEvaluatorName)
            ? node.arguments.slice(1)
            : node.arguments;
          for (const argument of permissionArguments) {
            for (const value of resolveExpression(argument)) resolved.add(value);
          }
          if (resolved.size === 0) values.add(unresolvedPermissionMarker(node, source));
          for (const value of resolved) values.add(value);
        } else if (permissionEvaluatorLike) {
          const nested = new Set();
          if (callable.kind === 'target' || callable.kind === 'targets') {
            const targets = callable.kind === 'target' ? [callable.target] : callable.targets;
            for (const target of targets) {
              const key = `permission-evaluator:${target.pos}`;
              if (seen.has(key)) continue;
              for (const value of analyzePermissionChecks(target, new Set(seen).add(key))) {
                nested.add(value);
              }
            }
          }
          if (nested.size === 0) values.add(unresolvedPermissionMarker(node, source));
          for (const value of nested) values.add(value);
        }
        if (callable.kind === 'target' || callable.kind === 'targets') {
          const targets = callable.kind === 'target' ? [callable.target] : callable.targets;
          for (const target of targets) {
            const key = `call:${target.pos}`;
            if (seen.has(key)) continue;
            const nextSeen = new Set(seen).add(key);
            for (const value of analyzePermissionChecks(target, nextSeen)) {
              values.add(value);
            }
          }
        }
        if (callable.kind === 'unresolved_alias') {
          values.add(unresolvedPermissionMarker(node.expression, source));
        }
        const callbackArgumentIndexes = new Set();
        const directExpression = unwrapExpression(node.expression);
        const transformExpression = resolvedMemberExpression(directExpression);
        const directMember = staticMemberName(transformExpression);
        const directReceiver = memberReceiver(transformExpression);
        const callOrApplyTarget =
          ((isReflectReceiver(directReceiver) && directMember === 'apply') ||
            isDestructuredReflectApply(directExpression)) &&
          node.arguments[0]
            ? unwrapExpression(node.arguments[0])
            : directReceiver && ['call', 'apply'].includes(directMember)
              ? unwrapExpression(directReceiver)
              : undefined;
        const callbackExpression = callOrApplyTarget ?? directExpression;
        const callbackArguments = callOrApplyTarget
          ? registeredInvocationArguments(node)
          : [...node.arguments];
        const callbackMethodName =
          staticMemberName(callbackExpression) ??
          (ts.isIdentifier(callbackExpression) ? callbackExpression.text : undefined);
        const callbackExpressionReceiver = memberReceiver(callbackExpression);
        const callbackReceiver =
          callbackExpressionReceiver && ts.isIdentifier(callbackExpressionReceiver)
            ? callbackExpressionReceiver.text
            : undefined;
        const callbackRoot = rootIdentifier(callbackExpression);
        const resolvedCallbackRoot = callbackRoot && resolveValueNode(callbackRoot);
        const importedCallbackReceiver =
          callbackRoot &&
          (importedIdentifiers.has(callbackRoot.text) ||
            (resolvedCallbackRoot &&
              ts.isIdentifier(resolvedCallbackRoot) &&
              importedIdentifiers.has(resolvedCallbackRoot.text)));
        const firstCallbackCandidate = callbackArguments[0];
        const firstCallbackCallable =
          firstCallbackCandidate && resolveCallable(unwrapExpression(firstCallbackCandidate));
        const firstCallbackLooksCallable =
          firstCallbackCandidate &&
          (['target', 'targets'].includes(firstCallbackCallable.kind) ||
            (firstCallbackCallable.kind === 'imported' &&
              /(?:callback|check|guard|handler|permission|require|validate)/i.test(
                `${firstCallbackCallable.name}:${firstCallbackCallable.original}`,
              )));
        const firstArgumentCallbackMethods = new Set([
          '$transaction',
          'catch',
          'every',
          'filter',
          'finally',
          'find',
          'findIndex',
          'findLast',
          'findLastIndex',
          'flatMap',
          'forEach',
          'map',
          'reduce',
          'reduceRight',
          'some',
          'sort',
          'subscribe',
          'toSorted',
          'transaction',
        ]);
        if (
          firstArgumentCallbackMethods.has(callbackMethodName) &&
          (!importedCallbackReceiver || firstCallbackLooksCallable)
        ) {
          callbackArgumentIndexes.add(0);
        }
        if (callbackMethodName === 'then') {
          callbackArgumentIndexes.add(0);
          callbackArgumentIndexes.add(1);
        }
        if (['replace', 'replaceAll'].includes(callbackMethodName)) {
          callbackArgumentIndexes.add(1);
        }
        if (
          [
            'addEventListener',
            'addListener',
            'on',
            'once',
            'prependListener',
            'prependOnceListener',
          ].includes(callbackMethodName)
        ) {
          callbackArgumentIndexes.add(1);
        }
        if (
          ['queueMicrotask', 'setImmediate', 'setInterval', 'setTimeout'].includes(
            callbackMethodName,
          ) &&
          !callbackReceiver
        ) {
          callbackArgumentIndexes.add(0);
        }
        if (
          ['Array', 'Object', 'Map'].includes(callbackReceiver) &&
          ['from', 'fromAsync', 'groupBy'].includes(callbackMethodName)
        ) {
          callbackArgumentIndexes.add(1);
        }
        if (callbackReceiver === 'JSON' && ['parse', 'stringify'].includes(callbackMethodName)) {
          callbackArgumentIndexes.add(1);
        }
        for (const [argumentIndex, argument] of callbackArguments.entries()) {
          const callback = unwrapExpression(argument);
          const activeCallbackPosition = callbackArgumentIndexes.has(argumentIndex);
          const resolvedCallback =
            ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)
              ? { kind: 'target', target: callback }
              : activeCallbackPosition || wrapperShapedCall
                ? resolveCallable(callback)
                : { kind: 'unresolved' };
          const resolvedCallbackValue = resolveValueNode(callback);
          const callbackDeclaration =
            ts.isIdentifier(callback) && visibleDeclaration(variables.get(callback.text), callback);
          const stableResolvedPrimitive =
            resolvedCallbackValue &&
            (ts.isStringLiteralLike(resolvedCallbackValue) ||
              ts.isNumericLiteral(resolvedCallbackValue) ||
              resolvedCallbackValue.kind === ts.SyntaxKind.TrueKeyword ||
              resolvedCallbackValue.kind === ts.SyntaxKind.FalseKeyword ||
              resolvedCallbackValue.kind === ts.SyntaxKind.NullKeyword) &&
            (!ts.isIdentifier(callback) ||
              (callbackDeclaration &&
                ts.isVariableDeclaration(callbackDeclaration) &&
                (callbackDeclaration.parent.flags & ts.NodeFlags.Const) !== 0));
          const explicitlyNonCallableCallbackValue =
            activeCallbackPosition &&
            (ts.isStringLiteralLike(callback) ||
              ts.isNumericLiteral(callback) ||
              ts.isArrayLiteralExpression(callback) ||
              ts.isObjectLiteralExpression(callback) ||
              (resolvedCallbackValue &&
                (ts.isArrayLiteralExpression(resolvedCallbackValue) ||
                  ts.isObjectLiteralExpression(resolvedCallbackValue))) ||
              stableResolvedPrimitive ||
              callback.kind === ts.SyntaxKind.TrueKeyword ||
              callback.kind === ts.SyntaxKind.FalseKeyword ||
              callback.kind === ts.SyntaxKind.NullKeyword ||
              (ts.isIdentifier(callback) && callback.text === 'undefined'));
          const explicitlyInertGlobalCallback =
            activeCallbackPosition &&
            resolvedCallback.kind === 'unresolved' &&
            ts.isIdentifier(callback) &&
            ['Boolean', 'Number', 'String'].includes(callback.text);
          const resolvedCallbackTargets =
            resolvedCallback.kind === 'target'
              ? [resolvedCallback.target]
              : resolvedCallback.kind === 'targets'
                ? resolvedCallback.targets
                : [];
          const opaqueFactoryResult =
            activeCallbackPosition &&
            resolvedCallbackTargets.some(
              (target) =>
                ts.isCallExpression(target) && resolveCallable(target.expression).kind !== 'auth',
            );
          if (
            activeCallbackPosition &&
            !explicitlyNonCallableCallbackValue &&
            !explicitlyInertGlobalCallback &&
            !['target', 'targets'].includes(resolvedCallback.kind)
          ) {
            values.add(unresolvedPermissionMarker(callback, source));
            continue;
          }
          if (explicitlyNonCallableCallbackValue || explicitlyInertGlobalCallback) continue;
          if (opaqueFactoryResult) values.add(unresolvedPermissionMarker(callback, source));
          if (wrapperShapedCall && resolvedCallback.kind === 'imported') {
            values.add(unresolvedPermissionMarker(callback, source));
            continue;
          }
          if (!['target', 'targets'].includes(resolvedCallback.kind)) continue;
          for (const callbackTarget of resolvedCallbackTargets) {
            const key = `callback:${callbackTarget.pos}`;
            if (seen.has(key)) continue;
            for (const value of analyzePermissionChecks(callbackTarget, new Set(seen).add(key))) {
              values.add(value);
            }
          }
        }
        for (const argument of registeredInvocationArguments(node)) {
          const resolvedArgument = resolveValueNode(argument);
          if (resolvedArgument && ts.isObjectLiteralExpression(resolvedArgument)) {
            analyzeObjectCallbackMembers(resolvedArgument, node);
          }
          if (objectCallbackArgumentNeedsFailClose(argument, node)) {
            values.add(unresolvedPermissionMarker(argument, source));
          }
          analyzeRegisteredCallableArgument(argument, node, resolvedArgument);
        }
      }
      if (ts.isNewExpression(node)) {
        const constructedFactory = unwrapExpression(node.expression);
        if (ts.isCallExpression(constructedFactory)) {
          const factory = resolveCallable(constructedFactory.expression);
          const hasExplicitRegisteredBoundaryArgument = constructedFactory.arguments.some(
            (argument) => {
              const candidate = unwrapExpression(argument);
              return (
                (ts.isIdentifier(candidate) &&
                  /^(?:IntersectionObserver|MutationObserver|ReadableStream|ResizeObserver|TransformStream|WritableStream|runTask)$/.test(
                    candidate.text,
                  )) ||
                (ts.isPropertyAccessExpression(candidate) &&
                  /^(?:IntersectionObserver|MutationObserver|ReadableStream|ResizeObserver|TransformStream|WritableStream|runTask)$/.test(
                    candidate.name.text,
                  ))
              );
            },
          );
          if (
            !['target', 'targets'].includes(factory.kind) &&
            !hasExplicitRegisteredBoundaryArgument
          ) {
            values.add(unresolvedPermissionMarker(constructedFactory, source));
          }
        }
        for (const argument of registeredInvocationArguments(node)) {
          const resolvedArgument = resolveValueNode(argument);
          if (resolvedArgument && ts.isObjectLiteralExpression(resolvedArgument)) {
            analyzeObjectCallbackMembers(resolvedArgument, node);
          }
          if (objectCallbackArgumentNeedsFailClose(argument, node)) {
            values.add(unresolvedPermissionMarker(argument, source));
          }
          analyzeRegisteredCallableArgument(argument, node, resolvedArgument);
        }
      }
      if (
        ts.isNewExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'Promise' &&
        node.arguments?.[0]
      ) {
        const callback = unwrapExpression(node.arguments[0]);
        const resolvedCallback =
          ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)
            ? { kind: 'target', target: callback }
            : resolveCallable(callback);
        if (!['target', 'targets'].includes(resolvedCallback.kind)) {
          values.add(unresolvedPermissionMarker(callback, source));
        } else {
          const callbackTargets =
            resolvedCallback.kind === 'target'
              ? [resolvedCallback.target]
              : resolvedCallback.targets;
          if (
            callbackTargets.some(
              (target) =>
                ts.isCallExpression(target) && resolveCallable(target.expression).kind !== 'auth',
            )
          ) {
            values.add(unresolvedPermissionMarker(callback, source));
          }
          for (const callbackTarget of callbackTargets) {
            const key = `promise-executor:${callbackTarget.pos}`;
            if (seen.has(key)) continue;
            for (const value of analyzePermissionChecks(callbackTarget, new Set(seen).add(key))) {
              values.add(value);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    if (root) visit(root);
    return values;
  };

  return analyzePermissionChecks;
}
