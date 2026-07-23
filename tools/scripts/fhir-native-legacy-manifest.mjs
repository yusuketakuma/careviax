import { existsSync, lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';

const FRAGMENT_KEYS = new Set([
  'schema_surfaces',
  'tracked_prisma_delegates',
  'expected_prisma_accesses',
  'expected_raw_sql_accesses',
  'raw_sql_exclusions',
  'code_surfaces',
  'export_scopes',
  'call_surfaces',
]);

export class InventoryCheckError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'InventoryCheckError';
    this.details = details;
  }
}

export function assert(condition, message, details = []) {
  if (!condition) throw new InventoryCheckError(message, details);
}

export function assertSafeRelativePath(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty path`);
  assert(!path.isAbsolute(value), `${label} must be repository-relative`, [value]);
  const normalized = path.posix.normalize(value.replaceAll('\\', '/'));
  assert(normalized !== '..' && !normalized.startsWith('../'), `${label} escapes the repository`, [
    value,
  ]);
  return normalized;
}

export function resolveRepoPath(repoRoot, relativePath, label) {
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

export function readUtf8(repoRoot, relativePath, label = 'path') {
  const absolutePath = resolveRepoPath(repoRoot, relativePath, label);
  assert(existsSync(absolutePath), `${label} is missing`, [relativePath]);
  assert(lstatSync(absolutePath).isFile(), `${label} is not a regular file`, [relativePath]);
  return readFileSync(absolutePath, 'utf8');
}

function parseJson(raw, label) {
  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new InventoryCheckError(`${label} is not valid JSON`, [
      error instanceof Error ? error.message : String(error),
    ]);
  }
}

function assertUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    assert(!seen.has(item), `duplicate ${label}`, [item]);
    seen.add(item);
  }
}

export function readManifest(repoRoot, manifestPath) {
  const manifest = parseJson(readUtf8(repoRoot, manifestPath, 'manifest path'), 'manifest');
  const fragments = manifest.fragments ?? [];
  assert(Array.isArray(fragments), 'manifest fragments must be an array');

  const hydrated = { ...manifest };
  const fragmentPaths = new Set();
  const fragmentedKeys = new Set();
  for (const descriptor of fragments) {
    assert(
      descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor),
      'manifest fragment descriptor must be an object',
    );
    const fragmentPath = assertSafeRelativePath(descriptor.path, 'manifest fragment path');
    assert(!fragmentPaths.has(fragmentPath), 'duplicate manifest fragment path', [fragmentPath]);
    fragmentPaths.add(fragmentPath);
    assert(
      Array.isArray(descriptor.keys) && descriptor.keys.length > 0,
      `manifest fragment ${fragmentPath} keys must be a non-empty array`,
    );
    assertUnique(descriptor.keys, `key in manifest fragment ${fragmentPath}`);
    for (const key of descriptor.keys) {
      assert(
        typeof key === 'string' && FRAGMENT_KEYS.has(key),
        `manifest fragment ${fragmentPath} has an unsupported key`,
        [String(key)],
      );
      assert(
        !(key in manifest),
        'manifest fragment key must not also appear in the root manifest',
        [key],
      );
      fragmentedKeys.add(key);
    }

    const fragment = parseJson(
      readUtf8(repoRoot, fragmentPath, `manifest fragment ${fragmentPath}`),
      `manifest fragment ${fragmentPath}`,
    );
    assert(
      fragment && typeof fragment === 'object' && !Array.isArray(fragment),
      `manifest fragment ${fragmentPath} root must be an object`,
    );
    const actualKeys = Object.keys(fragment).sort();
    const declaredKeys = [...descriptor.keys].sort();
    assert(
      JSON.stringify(actualKeys) === JSON.stringify(declaredKeys),
      `manifest fragment ${fragmentPath} keys differ from its descriptor`,
      [`declared=${declaredKeys.join(',')}`, `actual=${actualKeys.join(',')}`],
    );
    for (const key of declaredKeys) {
      assert(
        Array.isArray(fragment[key]),
        `manifest fragment ${fragmentPath} ${key} must be an array`,
      );
      hydrated[key] = [...(hydrated[key] ?? []), ...fragment[key]];
    }
  }

  for (const key of fragmentedKeys) {
    assert(Array.isArray(hydrated[key]), `manifest ${key} must be hydrated from fragments`);
  }
  return hydrated;
}
