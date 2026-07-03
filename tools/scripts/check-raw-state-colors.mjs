#!/usr/bin/env node
// 生 Tailwind の「状態色」ベタ書きを検出するガード (FEUX-6)。
// 状態/警告系の色 (red|orange|amber|yellow|green|emerald|lime|rose) は SSOT のトークン
// (state-blocked/done/confirm/waiting/readonly, tag-hazard/info) 経由で使う。生の
// `bg-amber-50` / `text-red-600` 等は状態シグナルのドリフトを生むため禁止する。
//
// 例外は「状態ではなく識別 (臨床グラデーション/ステータス enum/プレゼンス/検索カテゴリ)」で
// トークン化できない正当な色マップのみ。tools/raw-state-color-allowlist.json にファイル単位で
// 分類・理由・期待行数を登録する。期待行数と実行数が食い違えば失敗する (新規ドリフトも stale
// allowlist も両方検出する ratchet)。
//
// 対象外: sky/cyan/blue/violet/indigo/teal/slate/gray 等はフィーチャーテーマ/中立で状態色では
// ないため本ガードの対象にしない。状態系のみを厳格に見る。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const ALLOWLIST_PATH = 'tools/raw-state-color-allowlist.json';
const SCAN_ROOTS = ['src'];
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx']);
const SKIPPED_SUFFIXES = ['.test.ts', '.test.tsx', '.spec.ts', '.spec.tsx', '.stories.tsx'];
const CLASSIFICATIONS = new Set([
  'clinical_scale',
  'status_enum',
  'presence_identity',
  'search_category',
]);

// 状態/警告系ファミリの生 Tailwind カラーユーティリティ。opacity 付き (bg-amber-50/70) も接頭で一致する。
// シェードは 50..950 を全て見る (950 の暗色警告シェードのすり抜けを防ぐ)。
const RAW_STATE_COLOR_PATTERN =
  /(?:text|bg|border|ring|fill|stroke|from|to|via|divide|outline|decoration|accent|caret|placeholder|shadow)-(?:red|orange|amber|yellow|green|emerald|lime|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/;

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
    if (!CLASSIFICATIONS.has(entry.classification)) {
      throw new Error(`${label}.classification is invalid: ${entry.classification}`);
    }
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

function findOccurrences() {
  const occurrences = [];
  for (const root of SCAN_ROOTS) {
    for (const file of walkFiles(root)) {
      const lines = readFileSync(path.join(REPO_ROOT, file), 'utf8').split(/\r?\n/);
      lines.forEach((line, index) => {
        if (RAW_STATE_COLOR_PATTERN.test(line)) {
          occurrences.push({ path: file, line: index + 1, text: line.trim() });
        }
      });
    }
  }
  return occurrences;
}

const entries = readAllowlist();
const allowByPath = new Map(entries.map((entry) => [entry.path, entry]));
const occurrences = findOccurrences();
const violations = [];
for (const occurrence of occurrences) {
  const entry = allowByPath.get(occurrence.path);
  if (entry) {
    entry.actualCount += 1;
  } else {
    violations.push(occurrence);
  }
}

const staleEntries = entries.filter((entry) => entry.actualCount !== entry.expectedCount);

if (violations.length > 0 || staleEntries.length > 0) {
  console.error('Raw state-color check failed.');
  if (violations.length > 0) {
    console.error('\nRaw Tailwind state colors (use SSOT state/tag tokens instead):');
    for (const item of violations) {
      console.error(`- ${item.path}:${item.line}`);
      console.error(`  ${item.text}`);
    }
  }
  if (staleEntries.length > 0) {
    console.error('\nStale allowlist entries (expected line count no longer matches):');
    for (const entry of staleEntries) {
      console.error(`- ${entry.path} expected=${entry.expectedCount} actual=${entry.actualCount}`);
    }
  }
  console.error(
    '\nUse state tokens (text-state-blocked/done/confirm/waiting/readonly, text-tag-hazard/info),' +
      '\nor register a genuine identity color map in tools/raw-state-color-allowlist.json with a rationale.',
  );
  process.exit(1);
}

const byClassification = new Map();
for (const entry of entries) {
  byClassification.set(
    entry.classification,
    (byClassification.get(entry.classification) ?? 0) + entry.actualCount,
  );
}

console.log(
  `Raw state-color check passed: ${occurrences.length} allowlisted identity color lines, 0 drift.`,
);
for (const [classification, count] of [...byClassification.entries()].sort()) {
  console.log(`- ${classification}: ${count}`);
}
