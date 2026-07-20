import { existsSync, lstatSync } from 'node:fs';

import { parseApiPermissionContracts } from './api-permission-contracts.mjs';
import {
  ALL_ROLE_VALUES,
  assert,
  DETECTORS,
  matchingEvidence,
  OVERRIDE_FLAGS,
  path,
  PERMISSION_CAPABILITIES,
  PHOS_ROLES,
  PLATFORM_ROLES,
  rawRoleSemanticEvidence,
  readRepoBuffer,
  readRepoFile,
  safePath,
  sha256,
  sourceKind,
  stableJson,
  TENANT_ROLES,
  ts,
  unwrapExpression,
  walkFiles,
} from './core.mjs';

export function sourceExactValues(detector, sourcePath, content, repoRoot = process.cwd()) {
  const values = new Set();
  const roleSets = {
    tenant_role: TENANT_ROLES,
    platform_role: PLATFORM_ROLES,
    phos_role: PHOS_ROLES,
    role_projection: ALL_ROLE_VALUES,
    mapping_precedence: ALL_ROLE_VALUES,
    service_job: ALL_ROLE_VALUES,
    ui_role_affordance: ALL_ROLE_VALUES,
  };
  for (const value of roleSets[detector] ?? []) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const member = value.toUpperCase();
    if (
      new RegExp(
        `(?:['\"]${escaped}['\"]|\\b(?:MemberRole|PlatformOperatorRole|UserRole)\\.${member}\\b)`,
        'i',
      ).test(content)
    ) {
      values.add(value);
    }
  }
  if (detector === 'raw_role_semantics') {
    for (const evidence of rawRoleSemanticEvidence(sourcePath, content)) {
      const value = evidence.match(/^value=([^;]+);/)?.[1];
      if (value) values.add(value);
    }
  }
  if (detector === 'permission_capability') {
    const effective = new Set(
      parseApiPermissionContracts(sourcePath, content, repoRoot).flatMap(
        (contract) => contract.permissions,
      ),
    );
    for (const permission of effective) {
      if (permission.startsWith('unknown_permission:')) values.add(`effective:${permission}`);
    }
    for (const permission of PERMISSION_CAPABILITIES) {
      if (effective.has(permission)) values.add(`effective:${permission}`);
      else if (new RegExp(`\\b${permission}\\b`).test(content)) {
        values.add(`supporting_literal:${permission}`);
      }
    }
  }
  if (detector === 'phos_scope') {
    for (const value of parsePhosScopes(content)) values.add(value);
  }
  if (detector === 'override_flag') {
    for (const value of OVERRIDE_FLAGS) {
      if (new RegExp(`\\b${value}\\b`).test(content)) values.add(value);
    }
  }
  const detectorMarkers = {
    identity_role_claim: [
      'custom:role',
      'phos_role',
      'member_role',
      'authz_contract_version',
      'authz_epoch',
      'session_version',
    ],
    qualification: [
      'PharmacistCredential',
      'certification_type',
      'qualification_version',
      'qualification_status',
      'is_licensed_pharmacist',
    ],
    long_lived_or_offline: [
      'text/event-stream',
      'ReadableStream',
      'offlineActionQueue',
      'offlineEvidenceQueue',
      'authz epoch',
    ],
    rls_authz: [
      'tenant_isolation',
      'setRlsContext',
      'target_org_id',
      'BYPASSRLS',
      'requirePlatformOperator',
    ],
  };
  for (const marker of detectorMarkers[detector] ?? []) {
    if (content.toLowerCase().includes(marker.toLowerCase())) values.add(`marker:${marker}`);
  }
  if (values.size === 0) {
    values.add(`not_applicable:${detector}:no-enumerated-value:${sourcePath}`);
  }
  return [...values].sort();
}

export function sourceRouteMethodPurpose(sourcePath, content, detector, repoRoot = process.cwd()) {
  const routeMatch = sourcePath.match(/^src\/app\/(api(?:\/.*)?)\/route\.[cm]?[jt]sx?$/);
  if (!routeMatch) return `not_applicable:non-route-source:${sourcePath}`;
  const methods = [
    ...content.matchAll(
      /\bexport\s+(?:async\s+function|const)\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b/g,
    ),
  ].map((match) => match[1]);
  if (detector === 'permission_capability') {
    const contracts = parseApiPermissionContracts(sourcePath, content, repoRoot);
    const tuples = contracts
      .map(
        ({ method, permissions }) =>
          `${method}[${permissions.length > 0 ? permissions.join('|') : 'no-effective-permission-observed'}]`,
      )
      .join(';');
    return `${tuples || 'NO_EXPORTED_METHOD'} /${routeMatch[1]} purpose=legacy_unspecified_pending_review`;
  }
  return `${[...new Set(methods)].sort().join(',') || 'NO_EXPORTED_METHOD'} /${routeMatch[1]} purpose=legacy_unspecified_pending_review`;
}

export function sourceTestRefs(repoRoot, sourcePath) {
  const candidates = [];
  if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourcePath)) candidates.push(sourcePath);
  const extension = path.extname(sourcePath);
  const stem = sourcePath.slice(0, -extension.length);
  candidates.push(`${stem}.test${extension}`, `${stem}.spec${extension}`);
  if (/\/route\.[cm]?[jt]sx?$/.test(sourcePath)) {
    candidates.push(sourcePath.replace(/\/route(\.[cm]?[jt]sx?)$/, '/route.test$1'));
  }
  const existing = [...new Set(candidates)].filter((candidate) => {
    const resolved = safePath(repoRoot, candidate, 'test candidate');
    return existsSync(resolved.absolute) && lstatSync(resolved.absolute).isFile();
  });
  return existing.length > 0 ? existing.sort() : [`uncovered:no-focused-test:${sourcePath}`];
}

export function assertNoUnsupportedRoleAccess(sourcePath, content) {
  if (!/[.](?:[cm]?[jt]sx?)$/.test(sourcePath) || !/\bUserRole\b/.test(content)) return;
  const source = ts.createSourceFile(
    sourcePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    sourceKind(sourcePath),
  );
  const aliases = new Set(['UserRole']);
  let changed = true;
  while (changed) {
    changed = false;
    const collect = (node) => {
      if (
        ts.isImportSpecifier(node) &&
        (node.propertyName?.text ?? node.name.text) === 'UserRole'
      ) {
        if (!aliases.has(node.name.text)) {
          aliases.add(node.name.text);
          changed = true;
        }
      }
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        ts.isIdentifier(node.initializer) &&
        aliases.has(node.initializer.text) &&
        !aliases.has(node.name.text)
      ) {
        aliases.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, collect);
    };
    collect(source);
  }
  const failures = [];
  const visit = (node) => {
    if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      aliases.has(node.expression.text) &&
      node.argumentExpression &&
      !ts.isStringLiteralLike(node.argumentExpression)
    ) {
      const position = source.getLineAndCharacterOfPosition(node.getStart(source));
      failures.push(`${sourcePath}:${position.line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(failures.length === 0, 'unsupported dynamic UserRole access', failures);
}

export function discoverSurfaces(repoRoot, scope) {
  const files = walkFiles(repoRoot, scope.source_roots, scope.excluded_path_patterns);
  const entries = [];
  for (const sourcePath of files) {
    const content = readRepoFile(repoRoot, sourcePath);
    assertNoUnsupportedRoleAccess(sourcePath, content);
    const detected = new Set();
    for (const detector of DETECTORS) {
      const haystack = detector.pathAware ? `${sourcePath}\n${content}` : content;
      const lexicalEvidence = matchingEvidence(haystack, detector.expression);
      const evidence =
        detector.id === 'permission_capability' && lexicalEvidence.length > 0
          ? [
              ...sourceExactValues(detector.id, sourcePath, content, repoRoot),
              sourceRouteMethodPurpose(sourcePath, content, detector.id, repoRoot),
            ]
          : lexicalEvidence;
      if (evidence.length === 0) continue;
      detected.add(detector.id);
      entries.push({
        detector: detector.id,
        path: sourcePath,
        evidence_sha256: sha256(evidence.join('\n')),
      });
    }
    if (!detected.has('permission_capability')) {
      const permissionContracts = parseApiPermissionContracts(sourcePath, content, repoRoot);
      if (permissionContracts.some((contract) => contract.permissions.length > 0)) {
        const evidence = [
          ...sourceExactValues('permission_capability', sourcePath, content, repoRoot),
          sourceRouteMethodPurpose(sourcePath, content, 'permission_capability', repoRoot),
        ];
        entries.push({
          detector: 'permission_capability',
          path: sourcePath,
          evidence_sha256: sha256(evidence.join('\n')),
        });
      }
    }
    const rawEvidence = rawRoleSemanticEvidence(sourcePath, content);
    if (rawEvidence.length > 0) {
      entries.push({
        detector: 'raw_role_semantics',
        path: sourcePath,
        evidence_sha256: sha256(rawEvidence.join('\n')),
      });
    }
  }
  return entries.sort((left, right) =>
    `${left.detector}:${left.path}`.localeCompare(`${right.detector}:${right.path}`),
  );
}

export function discoverNonRuntimeAuthzContracts(repoRoot) {
  const contracts = [];
  for (const sourcePath of walkFiles(repoRoot, ['.'], [])) {
    const classes = [];
    if (/(?:^|\/)seed(?:\.[^/]+)?\.[cm]?[jt]sx?$/.test(sourcePath)) classes.push('seed');
    if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(sourcePath)) classes.push('test');
    if (/(?:^|\/)(?:fixtures?(?:\/|$)|[^/]*fixtures?[^/]*\.[^/]+$)/.test(sourcePath)) {
      classes.push('fixture');
    }
    if (
      /^tools\/scripts\/(?:(?:check-authz-account-model-v1-inventory|check-human-maintained-file-size)(?:\.mjs|\.d\.mts)|authz-account-model-v1-inventory\/[^/]+\.mjs)$/.test(
        sourcePath,
      )
    ) {
      classes.push('tooling');
    }
    if (classes.length === 0) continue;
    const content = readRepoFile(repoRoot, sourcePath, 'non-runtime authz contract');
    const detectors = DETECTORS.filter((detector) => {
      const haystack = detector.pathAware ? `${sourcePath}\n${content}` : content;
      return matchingEvidence(haystack, detector.expression).length > 0;
    }).map((detector) => detector.id);
    if (rawRoleSemanticEvidence(sourcePath, content).length > 0) {
      detectors.push('raw_role_semantics');
    }
    const uniqueDetectors = [...new Set(detectors)].sort();
    if (uniqueDetectors.length === 0) continue;
    contracts.push({
      path: sourcePath,
      classes: classes.sort(),
      detectors: uniqueDetectors,
      sha256: sha256(readRepoBuffer(repoRoot, sourcePath, 'non-runtime authz contract')),
    });
  }
  return contracts.sort((left, right) => left.path.localeCompare(right.path));
}

function executableSqlText(
  content,
  { includeStringContents = false, includeDynamicExecuteStrings = false } = {},
) {
  let output = '';
  let index = 0;
  let blockDepth = 0;
  while (index < content.length) {
    if (blockDepth > 0) {
      if (content.startsWith('/*', index)) {
        blockDepth += 1;
        index += 2;
      } else if (content.startsWith('*/', index)) {
        blockDepth -= 1;
        index += 2;
      } else {
        index += 1;
      }
      if (blockDepth === 0) output += ' ';
      continue;
    }
    if (content.startsWith('--', index)) {
      const newline = content.indexOf('\n', index + 2);
      index = newline === -1 ? content.length : newline;
      output += ' ';
      continue;
    }
    if (content.startsWith('/*', index)) {
      blockDepth = 1;
      index += 2;
      continue;
    }
    const dollar = content.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
    if (dollar) {
      const end = content.indexOf(dollar, index + dollar.length);
      if (end === -1) break;
      const body = content.slice(index + dollar.length, end);
      if (/\bDO(?:\s+LANGUAGE\s+[A-Za-z_][A-Za-z0-9_$]*)?\s*$/i.test(output)) {
        output += ` ${executableSqlText(body, { includeStringContents: true })} `;
      } else {
        output += ' ';
      }
      index = end + dollar.length;
      continue;
    }
    if (content[index] === "'") {
      const executableDoString =
        !includeStringContents &&
        /\bDO(?:\s+LANGUAGE\s+[A-Za-z_][A-Za-z0-9_$]*)?\s*E?$/i.test(output);
      const executableDynamicSql =
        includeDynamicExecuteStrings &&
        /\bEXECUTE(?:\s+IMMEDIATE)?(?:\s+format\s*\([^)]*)?\s*$/i.test(output);
      index += 1;
      let stringContent = '';
      while (index < content.length) {
        if (content[index] !== "'") {
          stringContent += content[index];
          index += 1;
          continue;
        }
        if (content[index + 1] === "'") {
          stringContent += "'";
          index += 2;
          continue;
        }
        index += 1;
        break;
      }
      output +=
        includeStringContents || executableDoString || executableDynamicSql
          ? ` ${executableSqlText(stringContent, { includeStringContents: true })} `
          : ' ';
      continue;
    }
    output += content[index];
    index += 1;
  }
  return output;
}

function hasAuthzFunctionContract(content, executableContent) {
  const knownAuthzName = (name) =>
    /(?:^|\.)(?:app_(?:enforced|current|require|rls|auth)|ph_os_(?:write|redact|prevent)|reject_)/i.test(
      name,
    );
  const lifecycle = [
    ...executableContent.matchAll(
      /\b(?:CREATE(?:\s+OR\s+REPLACE)?|ALTER|DROP)\s+FUNCTION\s+([^\s(]+)/gi,
    ),
  ];
  if (lifecycle.some((match) => knownAuthzName(match[1]))) return true;
  if (/\bSECURITY\s+DEFINER\b/i.test(executableContent)) return true;

  const definitions = content.matchAll(
    /\bCREATE(?:\s+OR\s+REPLACE)?\s+FUNCTION\s+([^\s(]+)[\s\S]*?\bAS\s+(\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)([\s\S]*?)\2/gi,
  );
  for (const match of definitions) {
    if (knownAuthzName(match[1])) return true;
    const body = executableSqlText(match[3], { includeDynamicExecuteStrings: true });
    if (
      /\bEXECUTE\b/i.test(body) ||
      /\b(?:CREATE|ALTER|DROP)\s+POLICY\b|\b(?:ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b|\b(?:GRANT|REVOKE)\b[\s\S]*?\b(?:TO|FROM)\b/i.test(
        body,
      ) ||
      /\b(?:current_setting|set_config|org_id|tenant_id|user_id|permission|role|audit|redact|immutable|mutation)\b/i.test(
        body,
      )
    ) {
      return true;
    }
  }
  return false;
}

export function discoverMigrationAuthzContracts(repoRoot) {
  const contracts = [];
  for (const sourcePath of walkFiles(repoRoot, ['prisma/migrations'], [])) {
    if (!/\/migration\.sql$/.test(sourcePath)) continue;
    const content = readRepoFile(repoRoot, sourcePath, 'migration authz contract');
    const executableContent = executableSqlText(content);
    const detectors = DETECTORS.filter((detector) => {
      const haystack = detector.pathAware
        ? `${sourcePath}\n${executableContent}`
        : executableContent;
      return matchingEvidence(haystack, detector.expression).length > 0;
    }).map((detector) => detector.id);
    if (rawRoleSemanticEvidence(sourcePath, executableContent).length > 0) {
      detectors.push('raw_role_semantics');
    }
    const uniqueDetectors = [...new Set(detectors)].sort();
    const definesRoleEnum =
      /\b(?:MemberRole|PlatformOperatorRole)\b/.test(executableContent) ||
      /\b(?:CREATE|ALTER|DROP)\s+ROLE\b/i.test(executableContent) ||
      /\b(?:GRANT|REVOKE)\b[\s\S]*?\b(?:TO|FROM)\b/i.test(executableContent);
    const definesAuthzFunction = hasAuthzFunctionContract(content, executableContent);
    const definesRlsContract =
      /\b(?:CREATE|ALTER|DROP)\s+POLICY\b/i.test(executableContent) ||
      /\b(?:ENABLE|DISABLE|FORCE|NO\s+FORCE)\s+ROW\s+LEVEL\s+SECURITY\b/i.test(executableContent) ||
      /\bBYPASSRLS\b/i.test(executableContent) ||
      definesAuthzFunction;
    if (uniqueDetectors.length === 0 && !definesRoleEnum && !definesRlsContract) continue;
    contracts.push({
      path: sourcePath,
      detectors: uniqueDetectors,
      defines_role_enum: definesRoleEnum,
      defines_rls_contract: definesRlsContract,
      sha256: sha256(readRepoBuffer(repoRoot, sourcePath, 'migration authz contract')),
    });
  }
  return contracts.sort((left, right) => left.path.localeCompare(right.path));
}

export function parsePrismaEnum(content, enumName) {
  const match = content.match(new RegExp(`enum\\s+${enumName}\\s*\\{([\\s\\S]*?)\\}`));
  assert(match, `missing Prisma enum ${enumName}`);
  return match[1]
    .split(/\r?\n/)
    .map(
      (line) =>
        line
          .replace(/\/\/.*$/, '')
          .trim()
          .split(/\s+/)[0],
    )
    .filter(Boolean);
}

export function parsePhosRoles(content) {
  const match = content.match(/export const UserRole\s*=\s*\{([\s\S]*?)\}\s*as const/);
  assert(match, 'missing PHOS UserRole definition');
  return [...match[1].matchAll(/\b([A-Z][A-Z_]*)\s*:\s*['"]\1['"]/g)].map((entry) => entry[1]);
}

export function parsePermissionKeys(content) {
  return [
    ...new Set([...content.matchAll(/\b(can[A-Z][A-Za-z0-9]*)\s*:\s*boolean/g)].map((m) => m[1])),
  ];
}

export function parsePhosScopes(content) {
  return [
    ...new Set(
      [...content.matchAll(/['"](phos\/[a-z0-9-]+\.(?:read|write))['"]/g)].map((m) => m[1]),
    ),
  ].sort();
}

function objectProperty(object, name) {
  return object.properties.find(
    (property) =>
      ts.isPropertyAssignment(property) &&
      ((ts.isIdentifier(property.name) && property.name.text === name) ||
        (ts.isStringLiteralLike(property.name) && property.name.text === name)),
  );
}

function literalValue(expression, source) {
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value)) return value.text;
  return value.getText(source);
}

function literalArray(expression, source) {
  const value = unwrapExpression(expression);
  if (ts.isCallExpression(value) && value.getText(source) === 'Object.values(UserRole)') {
    return ['ALL_PHOS_ROLES'];
  }
  assert(ts.isArrayLiteralExpression(value), 'route contract field must be an array', [
    value.getText(source),
  ]);
  return value.elements.map((element) => literalValue(element, source));
}

export function parsePhosRouteContracts(content) {
  const source = ts.createSourceFile(
    'src/phos/infra/api-gateway-routes.ts',
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let array;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'PHOS_API_ROUTES' &&
      node.initializer
    ) {
      const value = unwrapExpression(node.initializer);
      if (ts.isArrayLiteralExpression(value)) array = value;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert(array, 'PHOS_API_ROUTES definition missing');
  return array.elements.map((element) => {
    const object = unwrapExpression(element);
    assert(ts.isObjectLiteralExpression(object), 'PHOS route entry must be an object');
    const route = objectProperty(object, 'route_key');
    const method = objectProperty(object, 'method');
    const scopes = objectProperty(object, 'required_scopes');
    const roles = objectProperty(object, 'allowed_roles');
    assert(route && method && scopes && roles, 'PHOS route semantic fields missing');
    return {
      route_key: literalValue(route.initializer, source),
      method: literalValue(method.initializer, source),
      purpose: 'legacy_unspecified',
      required_scopes: literalArray(scopes.initializer, source),
      allowed_roles: literalArray(roles.initializer, source),
    };
  });
}

export function exactArray(actual, expected, label) {
  assert(Array.isArray(actual), `${label} must be an array`);
  assert(stableJson(actual) === stableJson(expected), `${label} drift`, [
    `expected=${JSON.stringify(expected)}`,
    `actual=${JSON.stringify(actual)}`,
  ]);
}

export function validateClosedStateMap(value, keys, allowedStates, label) {
  assert(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  exactArray(Object.keys(value).sort(), [...keys].sort(), `${label} keys`);
  for (const key of keys) assert(allowedStates.includes(value[key]), `${label}.${key} is invalid`);
}

export function validateStateProfiles(profiles, keys, allowedStates, label) {
  assert(
    profiles && typeof profiles === 'object' && !Array.isArray(profiles),
    `${label} must be an object`,
  );
  const contentIds = new Set();
  for (const [profileId, states] of Object.entries(profiles)) {
    assert(/^p_[a-f0-9]{12}$/.test(profileId), `${label} id is invalid`, [profileId]);
    assert(
      allowedStates.includes(states.default_state),
      `${label}.${profileId} default is invalid`,
    );
    assert(
      states.overrides && typeof states.overrides === 'object' && !Array.isArray(states.overrides),
      `${label}.${profileId} overrides must be an object`,
    );
    for (const [key, state] of Object.entries(states.overrides)) {
      assert(keys.includes(key), `${label}.${profileId} override key is invalid`, [key]);
      assert(allowedStates.includes(state), `${label}.${profileId}.${key} is invalid`);
      assert(state !== states.default_state, `${label}.${profileId}.${key} duplicates default`);
    }
    const expanded = Object.fromEntries(
      keys.map((key) => [key, states.overrides[key] ?? states.default_state]),
    );
    validateClosedStateMap(expanded, keys, allowedStates, `${label}.${profileId}`);
    const expectedId = `p_${sha256(stableJson(expanded)).slice(0, 12)}`;
    assert(profileId === expectedId, `${label}.${profileId} content-address drift`, [expectedId]);
    assert(!contentIds.has(expectedId), `${label} duplicate profile content`, [profileId]);
    contentIds.add(expectedId);
  }
}
