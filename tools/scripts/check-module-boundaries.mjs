#!/usr/bin/env node
// モジュール境界チェック (W0-3 / MOD-BOUND-001):
//   1. 共通コア → 薬局固有 の import 方向違反を検出する ratchet ガード。
//   2. backend module graph (`src/core`, `src/modules/*`) の禁止依存を検出する。
//
// 目的 (水平展開の柵):
//   共通コア (訪問/患者/ケア/報告/タスク/監査/通知/ファイル/連絡/会議/協働 のワークフロー基盤) は、
//   薬局固有ドメイン (処方/調剤/薬剤マスタ/PCA/セット/薬/QR/薬局 系) に依存してはならない。逆方向
//   (薬局固有 → 共通コア) は許容する。共通コアが薬局固有を import すると、後続で別業種テナントへ水平
//   展開する際にコアが薬局実装へ癒着し、切り離せなくなる。
//
// 設計 (check-raw-state-colors.mjs を踏襲):
//   スキャン + JSON allowlist + 期待件数 ratchet + exit 1。ESLint warn 方式は既存の
//   --max-warnings=0 運用を汚染するため使わない。現状の違反は「既存負債」として
//   tools/module-boundary-allowlist.json に全件登録し、ratchet の起点とする。新規違反 (未登録ファイル
//   での境界跨ぎ import) のみ失敗する。allowlist 済みファイルで違反行数が期待値とズレても失敗する
//   (負債の増加も、負債解消後の stale entry も両方検出する)。
//
// 境界定義は保守的に置く (誤検出でループを壊さないため):
//   - 共通コア (スキャン対象) =
//       * src/server/services 直下のファイルで、basename が
//         visit / patient / care / report / task / audit / notification(s) / file /
//         communication(s) / conference / collaboration で始まるもの
//       * src/lib/{tasks,audit,audit-logs,notifications,realtime,communications,
//         collaboration,files,comments} 配下のファイル (タスクで明示されたコア lib)
//   - 薬局固有 (禁止する import 先) =
//       * src/server/services 直下で basename が prescription* / dispens* / drug* /
//         pca* / set(または set-)* / medication* / qr(または qr-) / pharmacy* のもの
//       * src/lib 配下で先頭ディレクトリが同じ薬局系 (+ packaging*) のもの
//   判定はパスの先頭トークン/先頭ディレクトリで行い、settings (set 系に非該当) 等を巻き込まない。
//
// import 解決: `@/x` -> `src/x`、相対 (./ ../) は元ファイル基準で正規化。パッケージ import は対象外。
// 拡張子は補完しない (先頭ディレクトリ/basename で分類するため不要)。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/module-boundary-allowlist.json';
const MODULE_IDS_PATH = 'src/core/module-registry/module-ids.json';
const SCAN_ROOTS = ['src/server/services', 'src/lib', 'src/core', 'src/modules', 'src/app/api'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.stories.tsx'];

const SERVICES_ROOT = 'src/server/services/';
const LIB_ROOT = 'src/lib/';
const CORE_ROOT = 'src/core/';
const MODULES_ROOT = 'src/modules/';
const APP_API_ROOT = 'src/app/api/';
const MODULE_COMPOSITION_ROOTS = new Set(['src/modules/active-modules.ts']);
const moduleIds = JSON.parse(readFileSync(path.join(REPO_ROOT, MODULE_IDS_PATH), 'utf8'));
const FEATURE_MODULE_DIRS = new Set(
  moduleIds.featureModules.map((moduleMeta) => {
    if (!moduleMeta || typeof moduleMeta.dir !== 'string' || !moduleMeta.dir) {
      throw new Error(`${MODULE_IDS_PATH} contains an invalid feature module dir`);
    }
    return moduleMeta.dir;
  }),
);

// 共通コアとして扱う src/server/services 直下の basename 先頭トークン。
const CORE_SERVICE_PREFIXES = new Set([
  'visit',
  'patient',
  'care',
  'report',
  'task',
  'audit',
  'notification',
  'notifications',
  'file',
  'communication',
  'communications',
  'conference',
  'collaboration',
]);

// 共通コアとして扱う src/lib 直下ディレクトリ (タスク W0-3 で明示)。
const CORE_LIB_DIRS = new Set([
  'tasks',
  'audit',
  'audit-logs',
  'notifications',
  'realtime',
  'communications',
  'collaboration',
  'files',
  'comments',
]);

// パス先頭トークン (basename の '-'/'.' より前、またはディレクトリ名) が薬局固有か判定する。
function isPharmacySegment(segment) {
  if (/^prescription/.test(segment)) return true; // prescription / prescriptions
  if (/^dispens/.test(segment)) return true; // dispense / dispensing
  if (/^drug/.test(segment)) return true; // drug-master(s) / drug-alert-rules
  if (/^pca/.test(segment)) return true; // pca-pumps / pca-*
  if (segment === 'set' || segment.startsWith('set-')) return true; // 調剤セット (settings は非該当)
  if (/^medication/.test(segment)) return true; // medication*
  if (segment === 'qr' || segment.startsWith('qr-')) return true; // qr / qr-*
  if (/^pharmacy/.test(segment)) return true; // pharmacy*
  if (/^packaging/.test(segment)) return true; // packaging-methods (薬局固有の包装)
  return false;
}

function firstToken(name) {
  return name.split(/[-.]/)[0];
}

function isCoreFile(rel) {
  if (rel.startsWith(SERVICES_ROOT)) {
    const base = rel.slice(SERVICES_ROOT.length);
    if (base.includes('/')) return false; // 直下ファイルのみをコアと見なす (サブディレクトリは対象外)
    return CORE_SERVICE_PREFIXES.has(firstToken(base));
  }
  if (rel.startsWith(LIB_ROOT)) {
    const top = rel.slice(LIB_ROOT.length).split('/')[0];
    return CORE_LIB_DIRS.has(top);
  }
  return false;
}

// 解決済みの import 先パス (repo 相対) が薬局固有モジュールか判定する。
function isPharmacyTarget(rel) {
  if (rel.startsWith(SERVICES_ROOT)) {
    const base = rel.slice(SERVICES_ROOT.length).split('/')[0];
    return isPharmacySegment(firstToken(base));
  }
  if (rel.startsWith(LIB_ROOT)) {
    const top = rel.slice(LIB_ROOT.length).split('/')[0];
    return isPharmacySegment(top);
  }
  return false;
}

function featureModuleDir(rel) {
  if (!rel.startsWith(MODULES_ROOT)) return null;
  const top = rel.slice(MODULES_ROOT.length).split('/')[0];
  return FEATURE_MODULE_DIRS.has(top) ? top : null;
}

function isModulePublicEntrypoint(targetRel) {
  if (targetRel === 'src/modules/active-modules' || targetRel === 'src/modules/active-modules.ts') {
    return true;
  }

  const featureDir = featureModuleDir(targetRel);
  if (!featureDir) return false;

  return (
    targetRel === `${MODULES_ROOT}${featureDir}` ||
    targetRel === `${MODULES_ROOT}${featureDir}/index` ||
    targetRel === `${MODULES_ROOT}${featureDir}/index.ts`
  );
}

function moduleGraphViolation(fromRel, targetRel) {
  if (fromRel.startsWith(CORE_ROOT) && targetRel.startsWith(MODULES_ROOT)) {
    return 'core must not import feature modules';
  }

  if (
    fromRel.startsWith(APP_API_ROOT) &&
    targetRel.startsWith(MODULES_ROOT) &&
    !isModulePublicEntrypoint(targetRel)
  ) {
    return 'app/api must import feature modules through public entrypoints';
  }

  if (!fromRel.startsWith(MODULES_ROOT) || !targetRel.startsWith(MODULES_ROOT)) {
    return null;
  }

  if (MODULE_COMPOSITION_ROOTS.has(fromRel)) {
    return null;
  }

  const fromModule = featureModuleDir(fromRel);
  const targetModule = featureModuleDir(targetRel);
  if (fromModule && MODULE_COMPOSITION_ROOTS.has(`${targetRel}.ts`)) {
    return 'feature modules must not import module composition roots';
  }

  if (fromModule && targetRel === 'src/modules/active-modules') {
    return 'feature modules must not import module composition roots';
  }

  if (!fromModule || !targetModule) {
    return null;
  }

  if (fromModule !== targetModule) {
    return 'feature modules must not import sibling feature modules';
  }

  return null;
}

// import/export ... from '...'、および dynamic import('...') を拾う。
// specifier をファイル全文に対して一致させる (行単位ではない): このリポジトリで主流の
// Prettier 折り返しによる複数行 named import (`import {\n ...\n} from '@/x'`) は import/export
// キーワードと from が別行に分かれるため、行単位マッチだとすり抜ける。`from '...'` と
// `import('...')` を全文からマッチし、行番号は match index 前方の改行数から復元する。
const IMPORT_PATTERN = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (content.charCodeAt(i) === 10 /* \n */) line += 1;
  }
  return line;
}

function resolveSpecifier(spec, fromRel) {
  if (spec.startsWith('@/')) {
    return 'src/' + spec.slice(2);
  }
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const dir = path.posix.dirname(fromRel);
    return path.posix.normalize(path.posix.join(dir, spec));
  }
  return null; // パッケージ import は境界対象外
}

function readAllowlist() {
  const raw = readFileSync(path.join(REPO_ROOT, ALLOWLIST_PATH), 'utf8');
  const parsed = JSON.parse(raw);
  if (!parsed || !Array.isArray(parsed.entries)) {
    throw new Error(`${ALLOWLIST_PATH} must contain an entries array`);
  }
  return parsed.entries.map((entry, index) => {
    const label = `${ALLOWLIST_PATH}:entries[${index}]`;
    if (!entry || typeof entry !== 'object') throw new Error(`${label} must be an object`);
    if (typeof entry.path !== 'string' || !entry.path) throw new Error(`${label}.path is required`);
    if (typeof entry.reason !== 'string' || !entry.reason) {
      throw new Error(`${label}.reason is required`);
    }
    if (
      typeof entry.expectedCount !== 'number' ||
      !Number.isSafeInteger(entry.expectedCount) ||
      entry.expectedCount < 1
    ) {
      throw new Error(`${label}.expectedCount must be a positive integer`);
    }
    return { ...entry, actualCount: 0 };
  });
}

function walkFiles(root) {
  const absoluteRoot = path.join(REPO_ROOT, root);
  const files = [];
  const stack = [absoluteRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    const stats = statSync(current);
    if (stats.isDirectory()) {
      for (const child of readdirSync(current)) {
        if (child === 'node_modules' || child === '.next') continue;
        stack.push(path.join(current, child));
      }
      continue;
    }
    if (!stats.isFile()) continue;
    const relativePath = path.relative(REPO_ROOT, current).split(path.sep).join('/');
    if (SKIPPED_SUFFIXES.some((suffix) => relativePath.endsWith(suffix))) continue;
    if (TARGET_EXTENSIONS.has(path.extname(relativePath))) files.push(relativePath);
  }
  return files.sort();
}

function findViolations() {
  const violations = [];
  const coreFiles = [];
  const moduleGraphFiles = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      if (isCoreFile(file)) coreFiles.push(file);
      if (
        file.startsWith(CORE_ROOT) ||
        file.startsWith(MODULES_ROOT) ||
        file.startsWith(APP_API_ROOT)
      ) {
        moduleGraphFiles.push(file);
      }
    }
  }
  for (const file of coreFiles) {
    const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    IMPORT_PATTERN.lastIndex = 0;
    let match;
    while ((match = IMPORT_PATTERN.exec(content)) !== null) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const target = resolveSpecifier(spec, file);
      if (target && isPharmacyTarget(target)) {
        const line = lineOf(content, match.index);
        violations.push({
          path: file,
          line,
          spec,
          reason: 'common-core imports pharmacy-specific code',
        });
      }
    }
  }
  for (const file of moduleGraphFiles) {
    const content = readFileSync(path.join(REPO_ROOT, file), 'utf8');
    IMPORT_PATTERN.lastIndex = 0;
    let match;
    while ((match = IMPORT_PATTERN.exec(content)) !== null) {
      const spec = match[1] ?? match[2];
      if (!spec) continue;
      const target = resolveSpecifier(spec, file);
      if (!target) continue;
      const reason = moduleGraphViolation(file, target);
      if (reason) {
        const line = lineOf(content, match.index);
        violations.push({ path: file, line, spec, reason });
      }
    }
  }
  return violations;
}

const entries = readAllowlist();
const allowByPath = new Map(entries.map((entry) => [entry.path, entry]));
const violations = findViolations();
const newViolations = [];
for (const violation of violations) {
  const entry = allowByPath.get(violation.path);
  if (entry) {
    entry.actualCount += 1;
  } else {
    newViolations.push(violation);
  }
}

const staleEntries = entries.filter((entry) => entry.actualCount !== entry.expectedCount);

if (newViolations.length > 0 || staleEntries.length > 0) {
  console.error('Module boundary check failed.');
  if (newViolations.length > 0) {
    console.error('\nCommon-core -> pharmacy-specific imports (not allowed):');
    for (const item of newViolations) {
      console.error(`- ${item.path}:${item.line}  (imports ${item.spec}; ${item.reason})`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale allowlist entries (expected import count no longer matches):');
    for (const entry of staleEntries) {
      console.error(`- ${entry.path} expected=${entry.expectedCount} actual=${entry.actualCount}`);
    }
  }
  console.error(
    '\n共通コア (訪問/患者/ケア/報告/タスク/監査/通知/ファイル/連絡/会議/協働) は薬局固有ドメイン' +
      '\n(処方/調剤/薬剤/PCA/セット/薬/QR/薬局) を import してはいけません。依存方向を反転させるか、' +
      '\n共有型を薬局非依存の場所へ切り出してください。負債を意図的に許容する場合のみ、理由を添えて' +
      `\n${ALLOWLIST_PATH} に登録してください (新規許容は原則不可)。`,
  );
  process.exit(1);
}

const totalDebt = entries.reduce((sum, entry) => sum + entry.actualCount, 0);
console.log(
  `Module boundary check passed: 0 new violations, ${totalDebt} allowlisted debt imports across ${entries.length} files.`,
);
