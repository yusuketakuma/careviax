#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_MANIFEST_PATH = 'tools/fhir-native/legacy-migration-inventory.json';
const SOURCE_EXTENSIONS = new Set(['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx']);
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.next',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const READ_OPERATIONS = new Set([
  'aggregate',
  'count',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'groupBy',
]);
const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'delete',
  'deleteMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
]);
const PRISMA_OPERATIONS = [...READ_OPERATIONS, ...WRITE_OPERATIONS].sort(
  (left, right) => right.length - left.length || left.localeCompare(right),
);
const RAW_SQL_APIS = new Set(['executeRaw', 'executeRawUnsafe', 'queryRaw', 'queryRawUnsafe']);
const DISPOSITIONS = new Set(['remove_at_cutover', 'replace_at_cutover', 'owner_review_required']);
const ACTIVITIES = new Set([
  'coupling',
  'dormant_callable',
  'dto_contract',
  'live_caller',
  'live_job',
  'schema_reader_writer',
]);
const DIRECTIONS = new Set(['none', 'read', 'read_write', 'transform', 'write']);

export class InventoryCheckError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'InventoryCheckError';
    this.details = details;
  }
}

function assert(condition, message, details = []) {
  if (!condition) throw new InventoryCheckError(message, details);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function assertSafeRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty path`);
  assert(!path.isAbsolute(value), `${label} must be repository-relative`, [value]);
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  assert(normalized !== '..' && !normalized.startsWith('../'), `${label} escapes the repository`, [
    value,
  ]);
  return normalized;
}

function resolveRepoPath(repoRoot, relativePath, label) {
  const safePath = assertSafeRelativePath(relativePath, label);
  const absolutePath = path.resolve(repoRoot, safePath);
  const relative = path.relative(repoRoot, absolutePath);
  assert(
    relative !== '..' && !relative.startsWith(`..${path.sep}`),
    `${label} escapes repository`,
    [relativePath],
  );
  return absolutePath;
}

function readUtf8(repoRoot, relativePath, label = 'path') {
  const absolutePath = resolveRepoPath(repoRoot, relativePath, label);
  assert(existsSync(absolutePath), `${label} is missing`, [relativePath]);
  assert(lstatSync(absolutePath).isFile(), `${label} is not a regular file`, [relativePath]);
  return readFileSync(absolutePath, 'utf8');
}

function readManifest(repoRoot, manifestPath) {
  const raw = readUtf8(repoRoot, manifestPath, 'manifest path');
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new InventoryCheckError('manifest is not valid JSON', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function countMatches(content, pattern, flags = 'gm') {
  const effectiveFlags = flags.includes('g') ? flags : `${flags}g`;
  const regex = new RegExp(pattern, effectiveFlags);
  return Array.from(content.matchAll(regex)).length;
}

function uniqueBy(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    const value = key(item);
    assert(!seen.has(value), `duplicate ${label}`, [value]);
    seen.add(value);
  }
}

function validateOwnerReview(entry, label) {
  if (entry.disposition !== 'owner_review_required') return;
  const review = entry.owner_review;
  assert(review && typeof review === 'object', `${label} requires owner_review metadata`);
  assert(
    review.status === 'pending' || review.status === 'approved',
    `${label} has invalid review status`,
    [String(review.status)],
  );
  assert(
    typeof review.reason === 'string' && review.reason.trim().length > 0,
    `${label} owner_review is missing reason`,
  );
  if (review.status === 'approved') {
    for (const field of ['reviewer', 'decision_id', 'decided_at']) {
      assert(
        typeof review[field] === 'string' && review[field].trim().length > 0,
        `${label} approved review is missing ${field}`,
      );
    }
  }
}

function validateDisposition(entry, label) {
  assert(DISPOSITIONS.has(entry.disposition), `${label} has invalid disposition`, [
    String(entry.disposition),
  ]);
  validateOwnerReview(entry, label);
}

function parseDelimitedEntry(value, expectedParts, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
  const parts = value.split('|');
  assert(parts.length === expectedParts, `${label} has an invalid field count`, [value]);
  assert(
    parts.every((part) => part.length > 0),
    `${label} contains an empty field`,
    [value],
  );
  return parts;
}

function parsePositiveCount(value, label, entry) {
  const count = Number(value);
  assert(Number.isSafeInteger(count) && count > 0, `${label} count must be a positive integer`, [
    entry,
  ]);
  return count;
}

function parsePrismaAccessEntry(value, manifest) {
  const [entryPath, delegate, operation, accessForm, countText] = parseDelimitedEntry(
    value,
    5,
    'Prisma access entry',
  );
  assertSafeRelativePath(entryPath, 'Prisma access path');
  const metadata = manifest.tracked_prisma_delegates.find((entry) => entry.delegate === delegate);
  assert(metadata, 'Prisma access references an untracked delegate', [delegate]);
  assert(
    READ_OPERATIONS.has(operation) || WRITE_OPERATIONS.has(operation),
    'Prisma access operation is not classified',
    [operation],
  );
  assert(accessForm === 'dot' || accessForm === 'bracket', 'Prisma access form is invalid', [
    accessForm,
  ]);
  return {
    path: entryPath,
    delegate,
    model: metadata.model,
    operation,
    direction: directionForOperation(operation),
    access_form: accessForm,
    disposition: metadata.disposition,
    owner_review: metadata.owner_review ?? null,
    count: parsePositiveCount(countText, 'Prisma access', value),
  };
}

function parseRawSqlAccessEntry(value, manifest) {
  const [entryPath, model, table, api, direction, countText] = parseDelimitedEntry(
    value,
    6,
    'raw SQL access entry',
  );
  assertSafeRelativePath(entryPath, 'raw SQL access path');
  assert(RAW_SQL_APIS.has(api), 'raw SQL access API is invalid', [api]);
  assert(direction === 'read' || direction === 'write', 'raw SQL access direction is invalid', [
    direction,
  ]);
  const metadata = manifest.schema_surfaces.find(
    (entry) => entry.kind === 'model' && entry.name === model && entry.table_name === table,
  );
  assert(metadata, 'raw SQL access references an untracked model/table', [`${model}:${table}`]);
  return {
    path: entryPath,
    model,
    table,
    api,
    direction,
    disposition: metadata.disposition,
    owner_review: metadata.owner_review ?? null,
    count: parsePositiveCount(countText, 'raw SQL access', value),
  };
}

function validateManifest(manifest) {
  assert(manifest && typeof manifest === 'object', 'manifest root must be an object');
  assert(manifest.schema_version === 1, 'manifest schema_version must equal 1');
  assert(
    manifest.task_id === 'FHIR-NATIVE-LEGACY-MIGRATION-001-INVENTORY',
    'manifest task_id is invalid',
  );
  assert(manifest.mode === 'static_source_only', 'manifest mode must be static_source_only');
  assert(manifest.scope && typeof manifest.scope === 'object', 'manifest scope is missing');
  assert(
    Array.isArray(manifest.scope.production_source_roots) &&
      manifest.scope.production_source_roots.length > 0,
    'scope.production_source_roots must be non-empty',
  );
  assert(
    Array.isArray(manifest.scope.excluded_path_patterns),
    'scope.excluded_path_patterns must be an array',
  );
  for (const pattern of manifest.scope.excluded_path_patterns) {
    assert(typeof pattern === 'string', 'excluded path pattern must be a string');
    try {
      new RegExp(pattern);
    } catch (error) {
      throw new InventoryCheckError('excluded path pattern is invalid', [
        pattern,
        error instanceof Error ? error.message : String(error),
      ]);
    }
  }

  for (const key of [
    'schema_surfaces',
    'tracked_prisma_delegates',
    'expected_prisma_accesses',
    'expected_raw_sql_accesses',
    'code_surfaces',
    'export_scopes',
    'call_surfaces',
  ]) {
    assert(Array.isArray(manifest[key]), `manifest ${key} must be an array`);
  }

  uniqueBy(manifest.schema_surfaces, (entry) => entry.id, 'schema surface id');
  uniqueBy(manifest.tracked_prisma_delegates, (entry) => entry.delegate, 'Prisma delegate');
  uniqueBy(manifest.expected_prisma_accesses, (entry) => entry, 'Prisma access entry');
  uniqueBy(manifest.expected_raw_sql_accesses, (entry) => entry, 'raw SQL access entry');
  uniqueBy(manifest.code_surfaces, (entry) => entry.id, 'code surface id');
  uniqueBy(manifest.export_scopes, (entry) => entry.path, 'export scope path');
  uniqueBy(manifest.call_surfaces, (entry) => entry.id, 'call surface id');

  for (const entry of manifest.schema_surfaces) {
    assert(typeof entry.id === 'string' && entry.id.length > 0, 'schema surface id is invalid');
    assertSafeRelativePath(entry.path, `schema surface ${entry.id} path`);
    assert(
      entry.kind === 'enum' || entry.kind === 'model',
      `schema surface ${entry.id} kind is invalid`,
    );
    assert(
      typeof entry.name === 'string' && entry.name.length > 0,
      `schema surface ${entry.id} name is invalid`,
    );
    assert(Array.isArray(entry.members), `schema surface ${entry.id} members must be an array`);
    uniqueBy(entry.members, (member) => member, `member in ${entry.id}`);
    if (entry.kind === 'model') {
      assert(
        entry.table_name === undefined ||
          (typeof entry.table_name === 'string' && entry.table_name.length > 0),
        `schema surface ${entry.id} table_name is invalid`,
      );
      assert(
        entry.columns === undefined || Array.isArray(entry.columns),
        `schema surface ${entry.id} columns must be an array`,
      );
      uniqueBy(entry.columns ?? [], (column) => column, `column in ${entry.id}`);
    }
    assert(
      typeof entry.definition_sha256 === 'string' && /^[a-f0-9]{64}$/.test(entry.definition_sha256),
      `schema surface ${entry.id} definition_sha256 is invalid`,
    );
    validateDisposition(entry, `schema surface ${entry.id}`);
  }

  const schemaModels = new Map(
    manifest.schema_surfaces
      .filter((entry) => entry.kind === 'model')
      .map((entry) => [entry.name, entry]),
  );
  for (const entry of manifest.tracked_prisma_delegates) {
    assert(
      typeof entry.delegate === 'string' && entry.delegate.length > 0,
      'Prisma delegate is invalid',
    );
    const schemaModel = schemaModels.get(entry.model);
    assert(schemaModel, `Prisma delegate ${entry.delegate} has unknown model`, [
      String(entry.model),
    ]);
    validateDisposition(entry, `Prisma delegate ${entry.delegate}`);
    assert(
      entry.disposition === schemaModel.disposition &&
        (entry.owner_review?.status ?? null) === (schemaModel.owner_review?.status ?? null),
      `Prisma delegate ${entry.delegate} classification differs from its schema surface`,
    );
  }

  for (const entry of manifest.expected_prisma_accesses) parsePrismaAccessEntry(entry, manifest);
  for (const entry of manifest.expected_raw_sql_accesses) parseRawSqlAccessEntry(entry, manifest);

  for (const entry of manifest.code_surfaces) {
    assertSafeRelativePath(entry.path, `code surface ${entry.id} path`);
    assert(
      typeof entry.symbol === 'string' && entry.symbol.length > 0,
      `code surface ${entry.id} symbol is invalid`,
    );
    assert(ACTIVITIES.has(entry.activity), `code surface ${entry.id} activity is invalid`);
    assert(DIRECTIONS.has(entry.direction), `code surface ${entry.id} direction is invalid`);
    validateDisposition(entry, `code surface ${entry.id}`);
    assert(
      entry.anchor && typeof entry.anchor === 'object',
      `code surface ${entry.id} anchor is missing`,
    );
    assert(
      typeof entry.anchor.pattern === 'string',
      `code surface ${entry.id} anchor pattern is invalid`,
    );
    assert(
      Number.isSafeInteger(entry.anchor.expected_count) && entry.anchor.expected_count > 0,
      `code surface ${entry.id} expected_count must be positive`,
    );
  }

  for (const entry of manifest.export_scopes) {
    assertSafeRelativePath(entry.path, 'export scope path');
    assert(Array.isArray(entry.symbols), `export scope ${entry.path} symbols must be an array`);
    uniqueBy(entry.symbols, (symbol) => symbol, `exported symbol in ${entry.path}`);
  }

  for (const entry of manifest.call_surfaces) {
    assert(typeof entry.pattern === 'string', `call surface ${entry.id} pattern is invalid`);
    assert(
      Array.isArray(entry.definition_paths),
      `call surface ${entry.id} definition_paths must be an array`,
    );
    assert(
      Array.isArray(entry.expected_call_sites),
      `call surface ${entry.id} expected_call_sites must be an array`,
    );
    uniqueBy(entry.expected_call_sites, (site) => site.path, `call site path in ${entry.id}`);
    for (const site of entry.expected_call_sites) {
      assertSafeRelativePath(site.path, `call surface ${entry.id} expected path`);
      assert(
        Number.isSafeInteger(site.count) && site.count > 0,
        `call surface ${entry.id} count is invalid`,
      );
    }
    validateDisposition(entry, `call surface ${entry.id}`);
  }
}

function collectPrismaModelNames(repoRoot) {
  const names = new Set();
  const root = resolveRepoPath(repoRoot, 'prisma', 'Prisma schema root');

  function visit(absoluteDirectory) {
    for (const directoryEntry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      const absolutePath = path.join(absoluteDirectory, directoryEntry.name);
      if (directoryEntry.isSymbolicLink()) continue;
      if (directoryEntry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!directoryEntry.isFile() || path.extname(directoryEntry.name) !== '.prisma') continue;
      const content = readFileSync(absolutePath, 'utf8');
      for (const match of content.matchAll(/^\s*model\s+([A-Za-z_][\w]*)\s*\{/gm)) {
        names.add(match[1]);
      }
    }
  }

  visit(root);
  return names;
}

function extractPrismaSurface(content, entry, prismaModelNames) {
  const lines = content.split(/\r?\n/);
  const startPattern = new RegExp(`^\\s*${entry.kind}\\s+${escapeRegExp(entry.name)}\\s*\\{\\s*$`);
  const start = lines.findIndex((line) => startPattern.test(line));
  assert(start !== -1, `schema surface ${entry.id} declaration is missing`, [entry.path]);
  let end = -1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '}') {
      end = index;
      break;
    }
  }
  assert(end !== -1, `schema surface ${entry.id} closing brace is missing`, [entry.path]);

  const normalizedLines = [`${entry.kind} ${entry.name} {`];
  const members = [];
  const columns = [];
  let tableName = entry.kind === 'model' ? entry.name : null;
  for (const rawLine of lines.slice(start + 1, end)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    normalizedLines.push(line.replace(/\s+/g, ' '));
    if (!line.startsWith('@@')) members.push(line.split(/\s+/)[0]);
    if (entry.kind !== 'model') continue;

    const tableMapping = line.match(/^@@map\(\s*"([^"]+)"\s*\)/);
    if (tableMapping) {
      tableName = tableMapping[1];
      continue;
    }
    if (line.startsWith('@')) continue;
    const field = line.match(/^([A-Za-z_][\w]*)\s+([^\s]+)/);
    if (!field) continue;
    const fieldName = field[1];
    const baseType = field[2].replace(/[?\[\]]/g, '');
    if (prismaModelNames.has(baseType)) continue;
    const columnMapping = line.match(/@map\(\s*"([^"]+)"\s*\)/);
    columns.push(`${fieldName}:${columnMapping?.[1] ?? fieldName}`);
  }
  normalizedLines.push('}');
  return {
    id: entry.id,
    path: entry.path,
    kind: entry.kind,
    name: entry.name,
    disposition: entry.disposition,
    owner_review: entry.owner_review ?? null,
    members,
    table_name: tableName,
    columns,
    definition_sha256: sha256(normalizedLines.join('\n')),
  };
}

function isExcluded(relativePath, patterns) {
  return patterns.some((pattern) => new RegExp(pattern).test(relativePath));
}

function listProductionSourceFiles(repoRoot, scope) {
  const files = [];
  const patterns = scope.excluded_path_patterns;

  function visit(absoluteDirectory) {
    for (const entry of readdirSync(absoluteDirectory, { withFileTypes: true })) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        visit(absolutePath);
        continue;
      }
      if (!entry.isFile() || !SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
      if (!isExcluded(relativePath, patterns)) files.push(relativePath);
    }
  }

  for (const root of scope.production_source_roots) {
    const absoluteRoot = resolveRepoPath(repoRoot, root, 'production source root');
    assert(existsSync(absoluteRoot), 'production source root is missing', [root]);
    assert(lstatSync(absoluteRoot).isDirectory(), 'production source root is not a directory', [
      root,
    ]);
    visit(absoluteRoot);
  }
  return [...new Set(files)].sort();
}

function directionForOperation(operation) {
  if (READ_OPERATIONS.has(operation)) return 'read';
  if (WRITE_OPERATIONS.has(operation)) return 'write';
  throw new InventoryCheckError('unclassified Prisma operation', [operation]);
}

function assertNoUnclassifiedPrismaOperations(content, relativePath, delegate) {
  const clientHint =
    '(?:\\b(?:prisma|db|tx|reader|client|executor|transaction)|\\bargs\\s*\\.\\s*(?:prisma|db|tx))';
  const patterns = [
    new RegExp(
      `${clientHint}\\s*\\.\\s*${escapeRegExp(delegate)}\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`,
      'g',
    ),
    new RegExp(
      `${clientHint}\\s*\\[['"]${escapeRegExp(delegate)}['"]\\]\\s*\\.\\s*([A-Za-z_$][\\w$]*)\\s*\\(`,
      'g',
    ),
  ];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const operation = match[1];
      if (READ_OPERATIONS.has(operation) || WRITE_OPERATIONS.has(operation)) continue;
      throw new InventoryCheckError('unclassified Prisma operation', [
        `${relativePath}:${delegate}.${operation}`,
      ]);
    }
  }
}

function discoverPrismaAccesses(repoRoot, sourceFiles, delegates) {
  const byDelegate = new Map(delegates.map((entry) => [entry.delegate, entry]));
  const counts = new Map();
  const operationPattern = PRISMA_OPERATIONS.map((operation) => escapeRegExp(operation)).join('|');

  for (const relativePath of sourceFiles) {
    const content = readUtf8(repoRoot, relativePath, 'production source file');
    for (const [delegate, metadata] of byDelegate) {
      if (
        !content.includes(`.${delegate}`) &&
        !content.includes(`['${delegate}']`) &&
        !content.includes(`["${delegate}"]`)
      ) {
        continue;
      }
      assertNoUnclassifiedPrismaOperations(content, relativePath, delegate);
      const patterns = [
        {
          accessForm: 'dot',
          regex: new RegExp(
            `\\.${escapeRegExp(delegate)}\\s*\\.\\s*(${operationPattern})\\s*\\(`,
            'g',
          ),
        },
        {
          accessForm: 'bracket',
          regex: new RegExp(
            `\\[['\"]${escapeRegExp(delegate)}['\"]\\]\\s*\\.\\s*(${operationPattern})\\s*\\(`,
            'g',
          ),
        },
      ];
      for (const { accessForm, regex } of patterns) {
        for (const match of content.matchAll(regex)) {
          const operation = match[1];
          const direction = directionForOperation(operation);
          const key = `${relativePath}\u0000${delegate}\u0000${operation}\u0000${accessForm}`;
          const current = counts.get(key);
          counts.set(key, {
            path: relativePath,
            delegate,
            model: metadata.model,
            operation,
            direction,
            access_form: accessForm,
            disposition: metadata.disposition,
            owner_review: metadata.owner_review ?? null,
            count: (current?.count ?? 0) + 1,
          });
        }
      }
    }
  }

  return [...counts.values()].sort((left, right) =>
    [left.path, left.delegate, left.operation, left.access_form]
      .join('\u0000')
      .localeCompare(
        [right.path, right.delegate, right.operation, right.access_form].join('\u0000'),
      ),
  );
}

function skipTypeArguments(content, start) {
  if (content[start] !== '<') return start;
  let depth = 0;
  for (let index = start; index < content.length; index += 1) {
    if (content[index] === '<') depth += 1;
    if (content[index] === '>') {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return start;
}

function readTemplateLiteral(content, start) {
  assert(content[start] === '`', 'raw SQL template parser received an invalid start');
  for (let index = start + 1; index < content.length; index += 1) {
    if (content[index] !== '`') continue;
    let backslashes = 0;
    for (let cursor = index - 1; cursor >= start && content[cursor] === '\\'; cursor -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      return { text: content.slice(start + 1, index), end: index + 1 };
    }
  }
  return null;
}

function findRawSqlTemplate(content, markerEnd) {
  let cursor = markerEnd;
  while (/\s/.test(content[cursor] ?? '')) cursor += 1;
  cursor = skipTypeArguments(content, cursor);
  while (/\s/.test(content[cursor] ?? '')) cursor += 1;

  if (content[cursor] === '`') return readTemplateLiteral(content, cursor);
  if (content[cursor] !== '(') return null;

  const statementEnd = content.indexOf(';', cursor);
  const searchEnd = statementEnd === -1 ? content.length : statementEnd;
  const templateStart = content.indexOf('`', cursor + 1);
  if (templateStart === -1 || templateStart >= searchEnd) return null;
  return readTemplateLiteral(content, templateStart);
}

function rawSqlDirection(template) {
  const firstKeyword = template
    .replace(/^\s*(?:--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)*/u, '')
    .match(/^([A-Za-z]+)/)?.[1]
    ?.toUpperCase();
  return firstKeyword && ['DELETE', 'INSERT', 'MERGE', 'TRUNCATE', 'UPDATE'].includes(firstKeyword)
    ? 'write'
    : 'read';
}

function discoverRawSqlAccesses(repoRoot, sourceFiles, schemaSurfaces) {
  const models = schemaSurfaces.filter(
    (surface) => surface.kind === 'model' && typeof surface.table_name === 'string',
  );
  const counts = new Map();

  for (const relativePath of sourceFiles) {
    const content = readUtf8(repoRoot, relativePath, 'production source file');
    const markerPattern = /\$(queryRaw|executeRaw)(Unsafe)?\b/g;
    for (const marker of content.matchAll(markerPattern)) {
      const api = `${marker[1]}${marker[2] ?? ''}`;
      const template = findRawSqlTemplate(content, (marker.index ?? 0) + marker[0].length);
      if (!template) continue;
      const direction = rawSqlDirection(template.text);
      for (const metadata of models) {
        const tablePattern = new RegExp(
          `(?:"${escapeRegExp(metadata.table_name)}"|\\b${escapeRegExp(metadata.table_name)}\\b)`,
          'g',
        );
        const count = Array.from(template.text.matchAll(tablePattern)).length;
        if (count === 0) continue;
        const key = `${relativePath}\u0000${metadata.name}\u0000${metadata.table_name}\u0000${api}\u0000${direction}`;
        const current = counts.get(key);
        counts.set(key, {
          path: relativePath,
          model: metadata.name,
          table: metadata.table_name,
          api,
          direction,
          disposition: metadata.disposition,
          owner_review: metadata.owner_review ?? null,
          count: (current?.count ?? 0) + count,
        });
      }
    }
  }

  return [...counts.values()].sort((left, right) =>
    [left.path, left.model, left.table, left.api, left.direction]
      .join('\u0000')
      .localeCompare(
        [right.path, right.model, right.table, right.api, right.direction].join('\u0000'),
      ),
  );
}

function discoverExports(repoRoot, exportScopes) {
  return exportScopes
    .map((scope) => {
      const content = readUtf8(repoRoot, scope.path, 'export scope path');
      const regex =
        /^export\s+(?:declare\s+)?(?:async\s+)?(?:type|interface|class|function|const|let|var|enum)\s+([A-Za-z_$][\w$]*)/gm;
      const symbols = [...content.matchAll(regex)].map((match) => match[1]).sort();
      return { path: scope.path, symbols };
    })
    .sort((left, right) => left.path.localeCompare(right.path));
}

function discoverCallSites(repoRoot, sourceFiles, callSurfaces) {
  return callSurfaces
    .map((surface) => {
      const definitionPaths = new Set(surface.definition_paths);
      const callSites = [];
      for (const relativePath of sourceFiles) {
        if (definitionPaths.has(relativePath)) continue;
        const content = readUtf8(repoRoot, relativePath, 'production source file');
        const count = countMatches(content, surface.pattern, surface.flags ?? 'gm');
        if (count > 0) callSites.push({ path: relativePath, count });
      }
      return {
        id: surface.id,
        symbol: surface.symbol,
        disposition: surface.disposition,
        owner_review: surface.owner_review ?? null,
        call_sites: callSites.sort((left, right) => left.path.localeCompare(right.path)),
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function inspectCodeSurfaces(repoRoot, codeSurfaces) {
  return codeSurfaces
    .map((surface) => {
      const content = readUtf8(repoRoot, surface.path, `code surface ${surface.id} path`);
      const anchorCount = countMatches(
        content,
        surface.anchor.pattern,
        surface.anchor.flags ?? 'gm',
      );
      return {
        id: surface.id,
        path: surface.path,
        symbol: surface.symbol,
        category: surface.category,
        activity: surface.activity,
        direction: surface.direction,
        disposition: surface.disposition,
        owner_review: surface.owner_review ?? null,
        anchor_count: anchorCount,
      };
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compareExact(actual, expected, label) {
  const actualText = stableJson(actual);
  const expectedText = stableJson(expected);
  assert(actualText === expectedText, `${label} drift detected`, [
    `expected_sha256=${sha256(expectedText)}`,
    `actual_sha256=${sha256(actualText)}`,
  ]);
}

function buildInventory(repoRoot, manifest) {
  const prismaModelNames = collectPrismaModelNames(repoRoot);
  const schemaSurfaces = manifest.schema_surfaces
    .map((entry) => extractPrismaSurface(readUtf8(repoRoot, entry.path), entry, prismaModelNames))
    .sort((left, right) => left.id.localeCompare(right.id));
  const sourceFiles = listProductionSourceFiles(repoRoot, manifest.scope);
  const prismaAccesses = discoverPrismaAccesses(
    repoRoot,
    sourceFiles,
    manifest.tracked_prisma_delegates,
  );
  const rawSqlAccesses = discoverRawSqlAccesses(repoRoot, sourceFiles, schemaSurfaces);
  const codeSurfaces = inspectCodeSurfaces(repoRoot, manifest.code_surfaces);
  const exports = discoverExports(repoRoot, manifest.export_scopes);
  const calls = discoverCallSites(repoRoot, sourceFiles, manifest.call_surfaces);
  const inventory = {
    schema_surfaces: schemaSurfaces,
    prisma_accesses: prismaAccesses,
    raw_sql_accesses: rawSqlAccesses,
    code_surfaces: codeSurfaces,
    exports,
    calls,
  };
  return {
    ...inventory,
    inventory_sha256: sha256(stableJson(inventory)),
  };
}

function assertBaseline(manifest, inventory) {
  for (const actual of inventory.schema_surfaces) {
    const expected = manifest.schema_surfaces.find((entry) => entry.id === actual.id);
    compareExact(actual.members, expected.members, `schema surface ${actual.id} members`);
    if (actual.kind === 'model') {
      assert(
        actual.table_name === expected.table_name,
        `schema surface ${actual.id} table mapping drift detected`,
        [`expected=${expected.table_name}`, `actual=${actual.table_name}`],
      );
      compareExact(actual.columns, expected.columns, `schema surface ${actual.id} columns`);
    }
    assert(
      actual.definition_sha256 === expected.definition_sha256,
      `schema surface ${actual.id} definition drift detected`,
      [`expected=${expected.definition_sha256}`, `actual=${actual.definition_sha256}`],
    );
  }

  const expectedAccesses = manifest.expected_prisma_accesses
    .map((entry) => parsePrismaAccessEntry(entry, manifest))
    .sort((left, right) =>
      [left.path, left.delegate, left.operation, left.access_form]
        .join('\u0000')
        .localeCompare(
          [right.path, right.delegate, right.operation, right.access_form].join('\u0000'),
        ),
    );
  compareExact(inventory.prisma_accesses, expectedAccesses, 'Prisma reader/writer inventory');

  const expectedRawSqlAccesses = manifest.expected_raw_sql_accesses
    .map((entry) => parseRawSqlAccessEntry(entry, manifest))
    .sort((left, right) =>
      [left.path, left.model, left.table, left.api, left.direction]
        .join('\u0000')
        .localeCompare(
          [right.path, right.model, right.table, right.api, right.direction].join('\u0000'),
        ),
    );
  compareExact(inventory.raw_sql_accesses, expectedRawSqlAccesses, 'raw SQL inventory');

  const expectedExports = manifest.export_scopes
    .map((entry) => ({ path: entry.path, symbols: [...entry.symbols].sort() }))
    .sort((left, right) => left.path.localeCompare(right.path));
  compareExact(inventory.exports, expectedExports, 'exported DTO/contract inventory');

  const expectedCalls = manifest.call_surfaces
    .map((entry) => ({
      id: entry.id,
      symbol: entry.symbol,
      disposition: entry.disposition,
      owner_review: entry.owner_review ?? null,
      call_sites: [...entry.expected_call_sites].sort((left, right) =>
        left.path.localeCompare(right.path),
      ),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  compareExact(inventory.calls, expectedCalls, 'route/job/caller inventory');

  for (const actual of inventory.code_surfaces) {
    const expected = manifest.code_surfaces.find((entry) => entry.id === actual.id);
    assert(
      actual.anchor_count === expected.anchor.expected_count,
      `code surface ${actual.id} anchor drift detected`,
      [`expected=${expected.anchor.expected_count}`, `actual=${actual.anchor_count}`],
    );
  }

  assert(
    inventory.inventory_sha256 === manifest.expected_inventory_sha256,
    'complete inventory digest drift detected',
    [`expected=${manifest.expected_inventory_sha256}`, `actual=${inventory.inventory_sha256}`],
  );
}

function collectZeroGateBlockers(manifest, inventory) {
  const blockers = [];
  for (const surface of inventory.schema_surfaces) {
    if (
      surface.disposition === 'remove_at_cutover' ||
      surface.disposition === 'replace_at_cutover'
    ) {
      blockers.push(`schema:${surface.name}`);
    }
    if (
      surface.disposition === 'owner_review_required' &&
      surface.owner_review?.status !== 'approved'
    ) {
      blockers.push(`owner_review:schema:${surface.name}`);
    }
  }
  for (const access of inventory.prisma_accesses) {
    if (access.disposition === 'remove_at_cutover' || access.disposition === 'replace_at_cutover') {
      blockers.push(`prisma:${access.path}:${access.delegate}.${access.operation}:${access.count}`);
    }
    if (
      access.disposition === 'owner_review_required' &&
      access.owner_review?.status !== 'approved'
    ) {
      blockers.push(`owner_review:prisma:${access.delegate}`);
    }
  }
  for (const access of inventory.raw_sql_accesses) {
    if (access.disposition === 'remove_at_cutover' || access.disposition === 'replace_at_cutover') {
      blockers.push(`raw_sql:${access.path}:${access.table}:${access.direction}:${access.count}`);
    }
    if (
      access.disposition === 'owner_review_required' &&
      access.owner_review?.status !== 'approved'
    ) {
      blockers.push(`owner_review:raw_sql:${access.table}`);
    }
  }
  for (const surface of inventory.code_surfaces) {
    if (
      surface.anchor_count > 0 &&
      (surface.disposition === 'remove_at_cutover' || surface.disposition === 'replace_at_cutover')
    ) {
      blockers.push(`code:${surface.id}:${surface.anchor_count}`);
    }
    if (
      surface.disposition === 'owner_review_required' &&
      surface.owner_review?.status !== 'approved'
    ) {
      blockers.push(`owner_review:code:${surface.id}`);
    }
  }
  for (const call of inventory.calls) {
    const total = call.call_sites.reduce((sum, site) => sum + site.count, 0);
    if (
      total > 0 &&
      (call.disposition === 'remove_at_cutover' || call.disposition === 'replace_at_cutover')
    ) {
      blockers.push(`caller:${call.id}:${total}`);
    }
    if (call.disposition === 'owner_review_required' && call.owner_review?.status !== 'approved') {
      blockers.push(`owner_review:caller:${call.id}`);
    }
  }
  return [...new Set(blockers)].sort();
}

function serializePrismaAccess(entry) {
  return [entry.path, entry.delegate, entry.operation, entry.access_form, entry.count].join('|');
}

function serializeRawSqlAccess(entry) {
  return [entry.path, entry.model, entry.table, entry.api, entry.direction, entry.count].join('|');
}

function materializeManifestBaseline(manifest, inventory) {
  const schemaById = new Map(inventory.schema_surfaces.map((entry) => [entry.id, entry]));
  const codeById = new Map(inventory.code_surfaces.map((entry) => [entry.id, entry]));
  const exportsByPath = new Map(inventory.exports.map((entry) => [entry.path, entry]));
  const callsById = new Map(inventory.calls.map((entry) => [entry.id, entry]));

  return {
    ...manifest,
    schema_surfaces: manifest.schema_surfaces.map((entry) => {
      const current = schemaById.get(entry.id);
      assert(current, 'cannot materialize missing schema surface', [entry.id]);
      return {
        ...entry,
        members: current.members,
        table_name: current.table_name,
        columns: current.columns,
        definition_sha256: current.definition_sha256,
      };
    }),
    expected_prisma_accesses: inventory.prisma_accesses.map(serializePrismaAccess),
    expected_raw_sql_accesses: inventory.raw_sql_accesses.map(serializeRawSqlAccess),
    code_surfaces: manifest.code_surfaces.map((entry) => {
      const current = codeById.get(entry.id);
      assert(current, 'cannot materialize missing code surface', [entry.id]);
      return {
        ...entry,
        anchor: { ...entry.anchor, expected_count: current.anchor_count },
      };
    }),
    export_scopes: manifest.export_scopes.map((entry) => {
      const current = exportsByPath.get(entry.path);
      assert(current, 'cannot materialize missing export scope', [entry.path]);
      return { ...entry, symbols: current.symbols };
    }),
    call_surfaces: manifest.call_surfaces.map((entry) => {
      const current = callsById.get(entry.id);
      assert(current, 'cannot materialize missing call surface', [entry.id]);
      return { ...entry, expected_call_sites: current.call_sites };
    }),
    expected_inventory_sha256: inventory.inventory_sha256,
  };
}

export function checkLegacyInventory({
  repoRoot = process.cwd(),
  manifestPath = DEFAULT_MANIFEST_PATH,
  printCurrent = false,
  printManifest = false,
  requireZero = false,
} = {}) {
  const canonicalRoot = realpathSync(repoRoot);
  const manifest = readManifest(canonicalRoot, manifestPath);
  validateManifest(manifest);
  const inventory = buildInventory(canonicalRoot, manifest);

  if (!printCurrent && !printManifest) assertBaseline(manifest, inventory);

  if (requireZero) {
    const blockers = collectZeroGateBlockers(manifest, inventory);
    assert(blockers.length === 0, 'FHIR Native cutover zero gate is not satisfied', [
      `blocking_count=${blockers.length}`,
      ...blockers.slice(0, 25),
      ...(blockers.length > 25 ? [`... ${blockers.length - 25} more`] : []),
    ]);
  }

  return {
    manifest,
    inventory,
    summary: {
      schema_surfaces: inventory.schema_surfaces.length,
      prisma_access_groups: inventory.prisma_accesses.length,
      raw_sql_access_groups: inventory.raw_sql_accesses.length,
      code_surfaces: inventory.code_surfaces.length,
      call_surfaces: inventory.calls.length,
      inventory_sha256: inventory.inventory_sha256,
    },
  };
}

function parseArgs(argv) {
  const options = {
    repoRoot: process.cwd(),
    manifestPath: DEFAULT_MANIFEST_PATH,
    printCurrent: false,
    printManifest: false,
    requireZero: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--print-current') {
      options.printCurrent = true;
    } else if (argument === '--print-manifest') {
      options.printManifest = true;
    } else if (argument === '--require-zero') {
      options.requireZero = true;
    } else if (argument === '--repo-root') {
      index += 1;
      assert(index < argv.length, '--repo-root requires a value');
      options.repoRoot = argv[index];
    } else if (argument === '--manifest') {
      index += 1;
      assert(index < argv.length, '--manifest requires a value');
      options.manifestPath = argv[index];
    } else {
      throw new InventoryCheckError('unknown argument', [argument]);
    }
  }
  assert(
    !(options.printCurrent && options.printManifest),
    '--print-current and --print-manifest are mutually exclusive',
  );
  return options;
}

function formatFailure(error) {
  if (error instanceof InventoryCheckError) {
    return [
      'FHIR Native legacy inventory check failed.',
      `- ${error.message}`,
      ...error.details.map((detail) => `  ${detail}`),
    ].join('\n');
  }
  return [
    'FHIR Native legacy inventory check failed.',
    `- ${error instanceof Error ? error.message : String(error)}`,
  ].join('\n');
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = checkLegacyInventory(options);
    if (options.printCurrent) {
      process.stdout.write(`${JSON.stringify(result.inventory, null, 2)}\n`);
      return;
    }
    if (options.printManifest) {
      process.stdout.write(
        `${JSON.stringify(materializeManifestBaseline(result.manifest, result.inventory), null, 2)}\n`,
      );
      return;
    }
    const { summary } = result;
    process.stdout.write(
      `FHIR Native legacy inventory check passed: schema=${summary.schema_surfaces}, ` +
        `prisma_access_groups=${summary.prisma_access_groups}, ` +
        `raw_sql_access_groups=${summary.raw_sql_access_groups}, code=${summary.code_surfaces}, ` +
        `calls=${summary.call_surfaces}, digest=${summary.inventory_sha256}\n`,
    );
  } catch (error) {
    process.stderr.write(`${formatFailure(error)}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) await main();
