#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const DEFAULT_MANIFEST_PATH = 'tools/authz-account-model-v1/inventory.json';
const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cts',
  '.js',
  '.json',
  '.jsx',
  '.mjs',
  '.mts',
  '.md',
  '.prisma',
  '.sql',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml',
]);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'artifacts',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const REQUIRED_PRINCIPALS = ['human', 'job', 'platform', 'service'];
const REQUIRED_LIFECYCLES = [
  'historical_display',
  'long_lived_stream',
  'offline_replay',
  'request',
  'session_claim',
];
const REQUIRED_SURFACES = [
  'assignment',
  'notification',
  'output',
  'persistence',
  'projection',
  'reader_evaluator',
  'rls',
  'route_iac',
  'schema',
  'ui_affordance',
  'writer',
];
const REQUIRED_BINDINGS = [
  'assignment',
  'assignment_version',
  'authz_epoch',
  'consent',
  'contract_version',
  'purpose',
  'qualification',
  'qualification_version',
  'recheck_revocation_point',
  'site',
  'subject',
  'tenant',
  'ttl',
];
const REQUIRED_CAPABILITIES = [
  'assign',
  'authorize',
  'clinical_action',
  'execute',
  'export',
  'external_share',
  'govern',
  'notify',
  'output',
  'read',
  'secret',
  'write',
];
const BINDING_STATES = ['absent_observed', 'present_observed', 'unknown_legacy_requires_review'];
const CAPABILITY_STATES = ['not_observed', 'observed_legacy', 'unknown_legacy_requires_review'];
const PERMISSION_CAPABILITIES = [
  'canVisit',
  'canManageOperationalTasks',
  'canReport',
  'canAuthorReport',
  'canSendCareReport',
  'canManageBilling',
  'canManagePatientSharing',
  'canViewDashboard',
  'canAdmin',
  'canDispense',
  'canAuditDispense',
  'canSet',
  'canAuditSet',
];
const MAPPING_DISPOSITIONS = [
  'candidate_requires_human',
  'deny_unmapped',
  'historical_display_only',
  'inventory_only',
];
const APPROVAL_STATUSES = ['pending_owner_review'];
const TENANT_ROLES = [
  'owner',
  'admin',
  'pharmacist',
  'pharmacist_trainee',
  'clerk',
  'driver',
  'external_viewer',
];
const PLATFORM_ROLES = ['platform_support', 'platform_admin', 'platform_owner'];
const PHOS_ROLES = ['PHARMACIST', 'PHARMACY_CLERK', 'DISPENSE_ASSISTANT', 'MANAGER', 'ADMIN'];
const ALL_ROLE_VALUES = [...TENANT_ROLES, ...PLATFORM_ROLES, ...PHOS_ROLES];
const OVERRIDE_FLAGS = ['can_dispense', 'can_audit_dispense', 'can_set', 'can_audit_set'];
const REQUIRED_HIGH_RISK_IDS = [
  'cognito-role-projection',
  'historical-role-snapshots',
  'legacy-pharmacist-credential',
  'membership-selection-precedence',
  'notification-sse-recheck',
  'phos-offline-replay',
  'phos-route-role-scope',
  'platform-break-glass-synthetic-role',
  'service-job-principals',
];
const REQUIRED_MAPPING_DECISIONS = [
  ['DISPENSE_ASSISTANT', null, 'deny_unmapped'],
  ['MANAGER', null, 'deny_unmapped'],
  ['PHARMACY_CLERK', 'tenant clerk', 'candidate_requires_human'],
  ['driver', null, 'deny_unmapped'],
  ['external_viewer', null, 'deny_unmapped'],
  ['pharmacist_trainee', null, 'deny_unmapped'],
  ['platform_admin', null, 'deny_unmapped'],
  ['platform_owner', 'global owner', 'candidate_requires_human'],
  ['tenant owner', 'global owner', 'candidate_requires_human'],
];
const REQUIRED_BROWSER_JOURNEYS = [
  'tenant_switching_owner_target_pin',
  'supporter_assigned_read_zero_write',
  'role_capability_matrix',
  'qualification_negative_clinical_action',
  'stale_downgraded_unknown_claim_deny',
  'platform_break_glass',
  'multi_site_ambiguity',
  'offline_replay_after_revocation',
  'sse_revocation',
  'keyboard_focus_error_announcements',
  'console_runtime_errors_zero',
];
const REQUIRED_BROWSER_REQUIREMENTS = [
  'all specs/configs/helpers/scripts/dependencies/artifacts/CI/GATE_CONFIG mapped',
  'agent-browser or approved deterministic non-browser replacement',
  'atomic package/CI/gate cutover',
  'bidirectional per-test scenario manifest',
  'premature deletion checker',
  'zero unmapped scenarios',
];
const REQUIRED_LIVE_EVIDENCE = [
  'Cognito unknown-role aggregates',
  'EXPLAIN/cost/privacy approval',
  'claim/tenant mismatch aggregates',
  'redacted DB aggregates',
  'disabled/projection mismatch aggregates',
];
const REQUIRED_PROHIBITED_OUTPUT = [
  'Cognito sub',
  'email',
  'license number',
  'PHI',
  'site id',
  'tenant id',
  'token',
  'user id',
];

const DETECTORS = [
  {
    id: 'tenant_role',
    expression: String.raw`\bMemberRole\b|\bpharmacist_trainee\b|\bexternal_viewer\b|\bcanAuditDispense\b|\bcanAuditSet\b`,
  },
  {
    id: 'platform_role',
    expression: String.raw`\bPlatformOperatorRole\b|\bplatform_(?:owner|admin|support)\b|\bBreakGlassScope\b`,
  },
  {
    id: 'phos_role',
    expression: String.raw`\bUserRole(?:Type)?\b|\bPHARMACY_CLERK\b|\bDISPENSE_ASSISTANT\b|\bMANAGER\b`,
  },
  {
    id: 'phos_scope',
    expression: String.raw`\ballowed_roles\b|\brequired_scopes\b|phos\/[a-z0-9-]+\.(?:read|write)`,
  },
  {
    id: 'override_flag',
    expression: String.raw`\b(?:can_dispense|can_audit_dispense|can_set|can_audit_set)\b`,
  },
  {
    id: 'identity_role_claim',
    expression: String.raw`custom:role|\bphos_role\b|\bmember_role\b|\b(?:authz_contract_version|authz_epoch|session_version)\b`,
  },
  {
    id: 'role_projection',
    expression: String.raw`\b(?:required_role|owner_role|actor_role)\b|staff_loads[\s\S]{0,80}\brole\b`,
  },
  {
    id: 'qualification',
    expression: String.raw`\bPharmacistCredential\b|\bcertification_type\b|\bqualification_(?:version|status)\b|\bis_licensed_pharmacist\b`,
  },
  {
    id: 'mapping_precedence',
    expression: String.raw`phosRoleFromMemberRole|buildCognitoUserAttributes|RequestAuthContext|membership\s*[:=][\s\S]{0,500}findFirst|findFirst[\s\S]{0,500}membership|(?:role|claim)[^\n]{0,160}(?:\?\?|fallback)`,
  },
  {
    id: 'service_job',
    expression: String.raw`src\/(?:server\/jobs|app\/api\/jobs)\/|\blambda_handler\b|\bservice[_ ]principal\b|\bmachine identity\b`,
    pathAware: true,
  },
  {
    id: 'long_lived_or_offline',
    expression: String.raw`text\/event-stream|\bReadableStream\b|offlineActionQueue|offlineEvidenceQueue|\bauthz epoch\b`,
  },
  {
    id: 'rls_authz',
    expression: String.raw`tenant_isolation|setRlsContext|target_org_id|BYPASSRLS|requirePlatformOperator`,
  },
  {
    id: 'ui_role_affordance',
    expression: String.raw`(?:role|permission)[A-Z][A-Za-z0-9]*(?:Label|Option|Badge)|can(?:Admin|Audit|Dispense|Set|AuthorReport)`,
  },
  {
    id: 'permission_capability',
    expression: String.raw`\b(?:${PERMISSION_CAPABILITIES.join('|')})\b`,
  },
];

export class AuthzInventoryError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'AuthzInventoryError';
    this.details = details;
  }
}

function assert(condition, message, details = []) {
  if (!condition) throw new AuthzInventoryError(message, details);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function realContainedPath(repoRoot, absolutePath, label, relativePath) {
  if (!existsSync(absolutePath)) return;
  const realRoot = realpathSync(repoRoot);
  const realTarget = realpathSync(absolutePath);
  const relative = path.relative(realRoot, realTarget);
  assert(
    relative !== '..' && !relative.startsWith(`..${path.sep}`),
    `${label} resolves outside repository`,
    [relativePath],
  );
}

function safePath(repoRoot, relativePath, label) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, `${label} is required`);
  assert(!path.isAbsolute(relativePath), `${label} must be repository-relative`, [relativePath]);
  const normalized = path.posix.normalize(relativePath.replaceAll('\\', '/'));
  assert(!normalized.startsWith('../') && normalized !== '..', `${label} escapes repository`, [
    relativePath,
  ]);
  const absolute = path.resolve(repoRoot, normalized);
  const lexicalRelative = path.relative(path.resolve(repoRoot), absolute);
  assert(
    lexicalRelative !== '..' && !lexicalRelative.startsWith(`..${path.sep}`),
    `${label} escapes repository`,
    [relativePath],
  );
  realContainedPath(repoRoot, absolute, label, relativePath);
  return { absolute, normalized };
}

function readRepoFile(repoRoot, relativePath, label = 'path') {
  const resolved = safePath(repoRoot, relativePath, label);
  assert(existsSync(resolved.absolute), `${label} is missing`, [resolved.normalized]);
  const stat = lstatSync(resolved.absolute);
  assert(!stat.isSymbolicLink(), `${label} must not be a symlink`, [resolved.normalized]);
  assert(stat.isFile(), `${label} must be a regular file`, [resolved.normalized]);
  return readFileSync(resolved.absolute, 'utf8');
}

function readRepoBuffer(repoRoot, relativePath, label = 'path') {
  const resolved = safePath(repoRoot, relativePath, label);
  assert(existsSync(resolved.absolute), `${label} is missing`, [resolved.normalized]);
  const stat = lstatSync(resolved.absolute);
  assert(!stat.isSymbolicLink(), `${label} must not be a symlink`, [resolved.normalized]);
  assert(stat.isFile(), `${label} must be a regular file`, [resolved.normalized]);
  return readFileSync(resolved.absolute);
}

function walkFiles(repoRoot, roots, excludedPatterns) {
  const files = [];
  const exclusions = excludedPatterns.map((pattern) => new RegExp(pattern));
  const visit = (relativePath) => {
    const resolved = safePath(repoRoot, relativePath, 'source root');
    assert(existsSync(resolved.absolute), 'source root is missing', [relativePath]);
    const stat = lstatSync(resolved.absolute);
    assert(!stat.isSymbolicLink(), 'source path must not be a symlink', [relativePath]);
    if (stat.isFile()) {
      if (
        SOURCE_EXTENSIONS.has(path.extname(resolved.absolute)) &&
        !exclusions.some((pattern) => pattern.test(resolved.normalized))
      ) {
        files.push(resolved.normalized);
      }
      return;
    }
    assert(stat.isDirectory(), 'source root must be a file or directory', [relativePath]);
    for (const entry of readdirSync(resolved.absolute, { withFileTypes: true })) {
      if (entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)) continue;
      visit(path.posix.join(resolved.normalized, entry.name));
    }
  };
  for (const root of roots) visit(root);
  return [...new Set(files)].sort();
}

function matchingEvidence(content, expression) {
  const pattern = new RegExp(expression, 'i');
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => pattern.test(line))
    .sort();
}

function roleValue(value) {
  return ALL_ROLE_VALUES.find((role) => role.toLowerCase() === value.toLowerCase());
}

function isAuthorizationRoleName(value) {
  if (/(?:^|[.\[])\s*['"]?roles?['"]?\]?\s*$/i.test(value)) return true;
  const name = value.replace(/["'`\s.\[\]]/g, '');
  if (/^roles?$/i.test(name)) return true;
  if (
    /^(?:user|member|membership|platform|phos|authz?|actor|assignee|staff|claim|allowed|required)[A-Za-z0-9_]*roles?$/i.test(
      name,
    )
  ) {
    return true;
  }
  if (/^(?:require|assert|check|resolve|map)[A-Za-z0-9_]*roles?$/i.test(name)) return true;
  return /(?:^|_)(?:user|member|membership|platform|phos|authz?|actor|assignee|staff|claim|allowed|required)_?roles?(?:_|$)/i.test(
    name,
  );
}

function semanticRoleContext(node, source) {
  if (ts.isBinaryExpression(node.parent)) {
    const binary = node.parent;
    const other = binary.left === node ? binary.right : binary.left;
    const otherText = other.getText(source).replace(/\s+/g, ' ');
    if (isAuthorizationRoleName(otherText)) {
      return `binary:${binary.operatorToken.getText(source)}:${otherText}`;
    }
  }
  let current = node.parent;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current)) {
      const name = current.name.getText(source);
      if (isAuthorizationRoleName(name)) return `variable:${name}`;
    }
    if (ts.isPropertyAssignment(current)) {
      const name = current.name.getText(source);
      if (isAuthorizationRoleName(name)) return `property:${name}`;
    }
    if (ts.isTypeAliasDeclaration(current)) {
      const name = current.name.text;
      if (isAuthorizationRoleName(name)) return `type:${name}`;
    }
    if (ts.isCaseClause(current) && ts.isSwitchStatement(current.parent.parent)) {
      const expression = current.parent.parent.expression.getText(source).replace(/\s+/g, ' ');
      if (isAuthorizationRoleName(expression)) return `case:${expression}`;
    }
    if (ts.isCallExpression(current)) {
      const callee = current.expression.getText(source).replace(/\s+/g, ' ');
      if (isAuthorizationRoleName(callee)) return `call:${callee}`;
    }
  }
  return null;
}

function propertyName(node, source) {
  return node.name.getText(source).replace(/["']/g, '');
}

function enclosingRoleAssignment(node, source) {
  let current = node.parent;
  for (let depth = 0; current && depth < 12; depth += 1, current = current.parent) {
    if (ts.isPropertyAssignment(current) && propertyName(current, source) === 'role')
      return current;
  }
  return null;
}

function hasNonAuthorizationRoleNamespace(value) {
  const normalized = value.replace(/([a-z])([A-Z])/g, '$1_$2');
  return (
    /(?:^|[^A-Za-z0-9])(?:aria|visual|display|status|state|badge|tone|alert|metric|kpi|urgency|attention|priority|severity|live|contact|recipient|profession|care_?team|channel|audience|sender|target|source|provider|snapshot|invoice)(?:[^A-Za-z0-9]|$)/i.test(
      normalized,
    ) || /(?:recipient|target|required)_report_roles?(?:_|$)/i.test(normalized)
  );
}

function hasAuthorizationContainerNamespace(value) {
  const normalized = value.replace(/([a-z])([A-Z])/g, '$1_$2');
  return /(?:^|[^A-Za-z0-9])(?:auth|authenticated|user|member|membership|session|identity|principal|actor|request_context|auth_context|ctx)(?:[^A-Za-z0-9]|$)/i.test(
    normalized,
  );
}

function roleContainerClassification(node, source) {
  const assignment = enclosingRoleAssignment(node, source);
  if (!assignment) return null;
  let current = assignment.parent?.parent;
  let sawNonAuthorizationContainer = false;
  for (let depth = 0; current && depth < 12; depth += 1, current = current.parent) {
    if (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) {
      const name = current.name.getText(source);
      if (hasAuthorizationContainerNamespace(name)) return 'auth';
      if (hasNonAuthorizationRoleNamespace(name)) sawNonAuthorizationContainer = true;
    }
  }
  if (/(?:^|\/)src\/(?:lib|server)\/(?:auth|identity|session)(?:\/|[.-])/i.test(source.fileName)) {
    return 'auth';
  }
  return sawNonAuthorizationContainer ? 'non_auth' : null;
}

function isInfrastructureResourceRole(node, source) {
  let current = node.parent;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parent) {
    if (
      ts.isPropertyAssignment(current) &&
      propertyName(current, source) === 'Role' &&
      /\b(?:getAtt|ref|sub)\s*\(/.test(current.initializer.getText(source))
    ) {
      return true;
    }
  }
  return false;
}

function nearestNamedDeclaration(source, name, position) {
  let nearest;
  const visit = (candidate) => {
    if (
      (ts.isVariableDeclaration(candidate) || ts.isParameter(candidate)) &&
      ts.isIdentifier(candidate.name) &&
      candidate.name.text === name &&
      candidate.getStart(source) < position &&
      (!nearest || candidate.getStart(source) > nearest.getStart(source))
    ) {
      nearest = candidate;
    }
    ts.forEachChild(candidate, visit);
  };
  visit(source);
  return nearest;
}

function declarationHasNonAuthorizationRoleNamespace(declaration, source) {
  if (!declaration) return false;
  if (
    [
      declaration.name?.getText(source),
      declaration.type?.getText(source),
      declaration.initializer?.getText(source),
    ]
      .filter(Boolean)
      .some(hasNonAuthorizationRoleNamespace)
  ) {
    return true;
  }
  const initializer = declaration.initializer && unwrapExpression(declaration.initializer);
  if (initializer) {
    const calledFunctions = new Set();
    const collectCalls = (candidate) => {
      if (ts.isCallExpression(candidate) && ts.isIdentifier(candidate.expression)) {
        calledFunctions.add(candidate.expression.text);
      }
      ts.forEachChild(candidate, collectCalls);
    };
    collectCalls(initializer);
    let matches = false;
    const visit = (candidate) => {
      if (
        ts.isFunctionDeclaration(candidate) &&
        candidate.name &&
        calledFunctions.has(candidate.name.text) &&
        candidate.type &&
        hasNonAuthorizationRoleNamespace(candidate.type.getText(source))
      ) {
        matches = true;
      }
      ts.forEachChild(candidate, visit);
    };
    visit(source);
    return matches;
  }
  return false;
}

function isProtocolMessageRole(node, source) {
  if (!['system', 'user', 'assistant', 'tool'].includes(node.text)) return false;
  const assignment = enclosingRoleAssignment(node, source);
  if (!assignment) return false;
  const object = assignment.parent;
  return (
    ts.isObjectLiteralExpression(object) &&
    object.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) && propertyName(property, source) === 'content',
    )
  );
}

function isContactOrDisplayRole(node, source) {
  const assignment = enclosingRoleAssignment(node, source);
  if (!assignment) return false;
  const object = assignment.parent;
  if (!ts.isObjectLiteralExpression(object)) return false;
  const siblingNames = new Set(
    object.properties
      .filter(ts.isPropertyAssignment)
      .map((property) => propertyName(property, source)),
  );
  if (
    [
      'organization_name',
      'is_primary',
      'contact_id',
      'label',
      'tone',
      'tabIndex',
      'aria-label',
      'aria-live',
      'text',
      'partner_pharmacy_id',
      'base_site_id',
      'packageId',
      'sourceUrl',
      'role_label',
      'onClick',
      'onKeyDown',
    ].some((name) => siblingNames.has(name))
  ) {
    return true;
  }
  let current = object.parent;
  for (let depth = 0; current && depth < 6; depth += 1, current = current.parent) {
    if (
      (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) &&
      (hasNonAuthorizationRoleNamespace(current.name.getText(source)) ||
        (ts.isVariableDeclaration(current) &&
          current.type &&
          hasNonAuthorizationRoleNamespace(current.type.getText(source))))
    ) {
      return true;
    }
    if (
      (ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) &&
      hasNonAuthorizationRoleNamespace(current.name.text)
    ) {
      return true;
    }
  }
  return false;
}

function isNonAuthorizationRoleUsage(node, source) {
  const containerClassification = roleContainerClassification(node, source);
  if (containerClassification === 'auth') return false;
  if (containerClassification === 'non_auth') return true;
  if (isInfrastructureResourceRole(node, source)) return true;
  if (
    ts.isCallExpression(node.parent) &&
    ((node.text === 'role' &&
      /(?:read|get|parse)[A-Za-z0-9_]*(?:claim|field|property)/i.test(
        node.parent.expression.getText(source),
      )) ||
      /objectProperty/i.test(node.parent.expression.getText(source)))
  ) {
    return true;
  }
  if (
    (ts.isLiteralTypeNode(node.parent) && ts.isIndexedAccessTypeNode(node.parent.parent)) ||
    (ts.isBinaryExpression(node.parent) &&
      node.parent.operatorToken.kind === ts.SyntaxKind.InKeyword &&
      node.parent.left === node) ||
    (ts.isBinaryExpression(node.parent) && ts.isTypeOfExpression(node.parent.left))
  ) {
    return true;
  }
  if (ts.isBinaryExpression(node.parent)) {
    const other = node.parent.left === node ? node.parent.right : node.parent.left;
    if (
      ts.isPropertyAccessExpression(other) &&
      (hasNonAuthorizationRoleNamespace(other.expression.getText(source)) ||
        (ts.isIdentifier(other.expression) &&
          declarationHasNonAuthorizationRoleNamespace(
            nearestNamedDeclaration(source, other.expression.text, other.getStart(source)),
            source,
          )))
    ) {
      return true;
    }
    if (ts.isIdentifier(other)) {
      if (
        declarationHasNonAuthorizationRoleNamespace(
          nearestNamedDeclaration(source, other.text, other.getStart(source)),
          source,
        )
      ) {
        return true;
      }
    }
  }
  let current = node.parent;
  for (let depth = 0; current && depth < 16; depth += 1, current = current.parent) {
    if (
      ts.isJsxAttribute(current) &&
      current.name.getText(source).replace(/["']/g, '') === 'role'
    ) {
      return true;
    }
    if (
      (ts.isVariableDeclaration(current) || ts.isPropertyAssignment(current)) &&
      (hasNonAuthorizationRoleNamespace(current.name.getText(source)) ||
        (ts.isVariableDeclaration(current) &&
          current.type &&
          hasNonAuthorizationRoleNamespace(current.type.getText(source))))
    ) {
      return true;
    }
    if (
      ts.isPropertyAssignment(current) &&
      /^(?:orderBy|sortBy)$/i.test(propertyName(current, source))
    ) {
      return true;
    }
    if (
      (ts.isTypeAliasDeclaration(current) || ts.isInterfaceDeclaration(current)) &&
      hasNonAuthorizationRoleNamespace(current.name.text)
    ) {
      return true;
    }
    if (
      ts.isFunctionDeclaration(current) &&
      ((current.name && hasNonAuthorizationRoleNamespace(current.name.text)) ||
        (current.type && hasNonAuthorizationRoleNamespace(current.type.getText(source))))
    ) {
      return true;
    }
    if (
      ts.isCallExpression(current) &&
      hasNonAuthorizationRoleNamespace(current.expression.getText(source))
    ) {
      return true;
    }
  }
  return isProtocolMessageRole(node, source) || isContactOrDisplayRole(node, source);
}

function rawRoleSemanticEvidence(sourcePath, content) {
  if (/[.](?:[cm]?[jt]sx?)$/.test(sourcePath)) {
    const source = ts.createSourceFile(
      sourcePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      sourceKind(sourcePath),
    );
    const evidence = [];
    const visit = (node) => {
      if (ts.isStringLiteralLike(node) && /^[A-Za-z][A-Za-z0-9_-]{1,63}$/.test(node.text)) {
        const context = semanticRoleContext(node, source);
        if (context && !isNonAuthorizationRoleUsage(node, source)) {
          const canonical = roleValue(node.text);
          evidence.push(`value=${canonical ?? `unknown_role:${node.text}`};context=${context}`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return evidence.sort();
  }
  const roleAlternation = ALL_ROLE_VALUES.map((role) => role.replaceAll('_', '[_]?')).join('|');
  return [...content.matchAll(new RegExp(`['\"](${roleAlternation})['\"]`, 'gi'))]
    .map((match) => `value=${roleValue(match[1])};context=text`)
    .sort();
}

function sourceKind(sourcePath) {
  if (sourcePath.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (sourcePath.endsWith('.jsx')) return ts.ScriptKind.JSX;
  if (sourcePath.endsWith('.js') || sourcePath.endsWith('.mjs') || sourcePath.endsWith('.cjs')) {
    return ts.ScriptKind.JS;
  }
  return ts.ScriptKind.TS;
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    current &&
    (ts.isAsExpression(current) ||
      ts.isAwaitExpression(current) ||
      ts.isSatisfiesExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isNonNullExpression(current))
  ) {
    current = current.expression;
  }
  return current;
}

function permissionLiteral(value) {
  if (PERMISSION_CAPABILITIES.includes(value)) return value;
  return `unknown_permission:${encodeURIComponent(value)}`;
}

function unresolvedPermissionMarker(expression, source) {
  return `unknown_permission:unresolved_expression:${sha256(expression.getText(source)).slice(0, 12)}`;
}

function unresolvedReexportMarker(moduleSpecifier, original, exported) {
  return `unknown_permission:unresolved_reexport:${sha256(
    `${moduleSpecifier ?? '<local>'}:${original}:${exported}`,
  ).slice(0, 12)}`;
}

function unresolvedDirectMethodMarker(sourcePath, method, declaration, source) {
  const evidence = declaration ? declaration.getText(source) : '<missing-declaration>';
  return `unknown_permission:unresolved_direct_method:${sha256(
    `${sourcePath}:${method}:${evidence}`,
  ).slice(0, 12)}`;
}

export {
  ALL_ROLE_VALUES,
  APPROVAL_STATUSES,
  assert,
  BINDING_STATES,
  CAPABILITY_STATES,
  DEFAULT_MANIFEST_PATH,
  DETECTORS,
  MAPPING_DISPOSITIONS,
  matchingEvidence,
  OVERRIDE_FLAGS,
  path,
  PERMISSION_CAPABILITIES,
  permissionLiteral,
  PHOS_ROLES,
  PLATFORM_ROLES,
  rawRoleSemanticEvidence,
  readRepoBuffer,
  readRepoFile,
  REQUIRED_BINDINGS,
  REQUIRED_BROWSER_JOURNEYS,
  REQUIRED_BROWSER_REQUIREMENTS,
  REQUIRED_CAPABILITIES,
  REQUIRED_HIGH_RISK_IDS,
  REQUIRED_LIFECYCLES,
  REQUIRED_LIVE_EVIDENCE,
  REQUIRED_MAPPING_DECISIONS,
  REQUIRED_PRINCIPALS,
  REQUIRED_PROHIBITED_OUTPUT,
  REQUIRED_SURFACES,
  safePath,
  sha256,
  SKIPPED_DIRECTORIES,
  sourceKind,
  stableJson,
  TENANT_ROLES,
  ts,
  unresolvedDirectMethodMarker,
  unresolvedPermissionMarker,
  unresolvedReexportMarker,
  unwrapExpression,
  walkFiles,
};
