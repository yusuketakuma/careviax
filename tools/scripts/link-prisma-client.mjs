// link-prisma-client.mjs
//
// 【何のために存在するか】
// pnpm はハードリンク + シンボリックリンクベースの仮想ストア
// (`node_modules/.pnpm/...`) を使うため、`prisma generate` が生成した
// `.prisma`（クエリエンジン・型定義を含む生成物）は `@prisma/client` の
// 実体と同じ仮想ストア配下にのみ配置される。一部のツール（一部のバンド
// ラー・ランタイム・型解決、Next.js のトレース対象解決など）は
// `node_modules/.prisma` をプロジェクトルート直下から解決しようとする
// ため、そのままでは見つからない。本スクリプトは
// `prisma generate` の直後（postinstall / db:generate）に実行し、
// プロジェクトルートの `node_modules/.prisma` から実際の生成物ディレク
// トリへシンボリックリンクを張ることでこのギャップを埋める。
//
// 【Prisma / Next メジャーアップデート時の確認観点】
// - `@prisma/client` の生成物の相対位置（`<client dir>/../../.prisma`）が
//   変わっていないか。Prisma のメジャー更新でパッケージ内のディレクトリ
//   構成が変わる場合、`generatedPrismaDir` の算出ロジックを見直すこと。
// - pnpm の仮想ストアのディレクトリ命名規則（ハッシュ付与など）が変わって
//   も、本スクリプトは `require.resolve` で都度実パスを解決しているため
//   影響を受けない設計になっている（ハードコードしたパスを追加しないこと）。
// - Next.js のビルド/postinstall フックが `node_modules/.prisma` の解決
//   方法を変えた場合（例: output tracing の挙動変更）、本スクリプトの
//   リンク先が引き続き期待通り参照されるか `pnpm build` で確認すること。
// - npm/yarn 等、pnpm 以外のパッケージマネージャに切り替える場合は
//   `node_modules/.prisma` が最初から実体として存在しうるため、
//   シンボリックリンク運用自体の要否を見直すこと。

import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const LOG_PREFIX = '[link-prisma-client]';

/**
 * 復旧手順を添えて日本語エラーメッセージを出力し、非ゼロで終了する。
 * @param {string} message - 何が問題か
 * @param {string[]} recoverySteps - 復旧のための具体的な手順（箇条書き）
 */
function fail(message, recoverySteps = []) {
  console.error(`${LOG_PREFIX} エラー: ${message}`);
  if (recoverySteps.length > 0) {
    console.error(`${LOG_PREFIX} 復旧手順:`);
    for (const step of recoverySteps) {
      console.error(`${LOG_PREFIX}   - ${step}`);
    }
  }
  process.exit(1);
}

// 前提1: リポジトリルート（package.json が存在するディレクトリ）から
// 実行されていること。誤ったディレクトリから実行すると誤った場所に
// node_modules/.prisma が作られてしまうため、早期に検出する。
const projectPackageJson = resolve(process.cwd(), 'package.json');
if (!existsSync(projectPackageJson)) {
  fail(`カレントディレクトリ (${process.cwd()}) に package.json が見つかりません。`, [
    'リポジトリルートで実行してください（例: `node tools/scripts/link-prisma-client.mjs` はルートから実行する想定）',
    '通常は `pnpm install` の postinstall または `pnpm db:generate` 経由で自動実行されます',
  ]);
}

const projectNodeModules = resolve(process.cwd(), 'node_modules');

// 前提2: @prisma/client が依存関係として解決できること。
// pnpm install 未実行・依存関係破損時はここで require.resolve が例外を投げる。
let prismaClientPackageDir;
try {
  prismaClientPackageDir = dirname(require.resolve('@prisma/client/package.json'));
} catch (error) {
  fail('`@prisma/client` を解決できませんでした（未インストールの可能性があります）。', [
    '`pnpm install` を実行して依存関係を導入してください',
    'それでも解決しない場合は `pnpm add @prisma/client` で明示的に追加してください',
  ]);
  throw error; // fail() は process.exit するが型的な到達性のため
}

const generatedPrismaDir = resolve(prismaClientPackageDir, '..', '..', '.prisma');
const rootPrismaDir = resolve(projectNodeModules, '.prisma');

// 前提3: `prisma generate` が既に実行され、生成物ディレクトリが存在すること。
// postinstall では `prisma generate` の直後に本スクリプトが呼ばれる想定だが、
// 生成が失敗している場合はここでスキップする（生成失敗自体は呼び出し元の
// `prisma generate` が非ゼロ終了で検知するため、本スクリプトは黙って
// スキップして良い＝挙動は変更しない）。
if (!existsSync(generatedPrismaDir)) {
  console.warn(
    `${LOG_PREFIX} スキップ: 生成済みクライアントが見つかりません (${generatedPrismaDir})。` +
      ' `prisma generate --schema=prisma/schema/` が正常終了しているか確認してください。',
  );
  process.exit(0);
}

/**
 * パスが存在すれば lstat 結果を返し、存在しなければ null を返す。
 * ENOENT 以外（権限エラー等）はそのまま呼び出し元に伝播させる。
 */
function lstatIfExists(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

try {
  mkdirSync(projectNodeModules, { recursive: true });
} catch (error) {
  fail(`node_modules ディレクトリの作成に失敗しました (${projectNodeModules})。`, [
    'ディスクの空き容量と書き込み権限を確認してください',
    `原因: ${error instanceof Error ? error.message : String(error)}`,
  ]);
}

let existingStat;
try {
  existingStat = lstatIfExists(rootPrismaDir);
} catch (error) {
  fail(`既存の ${rootPrismaDir} の状態確認に失敗しました。`, [
    'ファイル/ディレクトリのアクセス権限を確認してください',
    `原因: ${error instanceof Error ? error.message : String(error)}`,
  ]);
}

// 冪等性: 既に期待通りのリンクが張られていれば何もしない（再実行安全）。
if (existingStat) {
  if (existingStat.isSymbolicLink()) {
    let linkedPath;
    try {
      linkedPath = resolve(projectNodeModules, readlinkSync(rootPrismaDir));
    } catch (error) {
      fail(`既存のシンボリックリンク (${rootPrismaDir}) の読み取りに失敗しました。`, [
        `手動で削除してから再実行してください: rm -rf ${rootPrismaDir}`,
        `原因: ${error instanceof Error ? error.message : String(error)}`,
      ]);
    }
    if (linkedPath === generatedPrismaDir) {
      console.log(`${LOG_PREFIX} Reusing existing link ${rootPrismaDir}`);
      process.exit(0);
    }
  }

  try {
    rmSync(rootPrismaDir, { recursive: true, force: true });
  } catch (error) {
    fail(`古い ${rootPrismaDir}（リンクまたはディレクトリ）の削除に失敗しました。`, [
      `手動で削除してから再実行してください: rm -rf ${rootPrismaDir}`,
      '権限エラーの場合は所有者/パーミッションを確認してください',
      `原因: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

function symlinkRecoverySteps(error) {
  const steps = [
    `手動でリンクを作り直してください: rm -rf ${rootPrismaDir} && ln -s ${generatedPrismaDir} ${rootPrismaDir}`,
  ];
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      steps.push(
        '権限不足の可能性があります（macOS/Linux は書き込み権限、Windows はシンボリックリンク作成権限または開発者モードを確認）',
      );
    }
    if (error.code === 'ENOENT') {
      steps.push(`リンク先が存在するか確認してください: ${generatedPrismaDir}`);
    }
  }
  return steps;
}

try {
  symlinkSync(generatedPrismaDir, rootPrismaDir, 'dir');
} catch (error) {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    error.code === 'EEXIST' &&
    existsSync(rootPrismaDir)
  ) {
    // pnpm install 等の並行実行で他プロセスが同時にリンクを作った場合の競合。
    let stat;
    try {
      stat = lstatIfExists(rootPrismaDir);
    } catch (statError) {
      fail(`並行作成された ${rootPrismaDir} の状態確認に失敗しました。`, [
        `手動で削除してから再実行してください: rm -rf ${rootPrismaDir}`,
        `原因: ${statError instanceof Error ? statError.message : String(statError)}`,
      ]);
    }
    if (stat?.isSymbolicLink()) {
      let linkedPath;
      try {
        linkedPath = resolve(projectNodeModules, readlinkSync(rootPrismaDir));
      } catch (readError) {
        fail(`並行作成された ${rootPrismaDir} の読み取りに失敗しました。`, [
          `手動で削除してから再実行してください: rm -rf ${rootPrismaDir}`,
          `原因: ${readError instanceof Error ? readError.message : String(readError)}`,
        ]);
      }
      if (linkedPath === generatedPrismaDir) {
        console.log(`${LOG_PREFIX} Reusing concurrently created link ${rootPrismaDir}`);
        process.exit(0);
      }
    }

    try {
      rmSync(rootPrismaDir, { recursive: true, force: true });
      symlinkSync(generatedPrismaDir, rootPrismaDir, 'dir');
    } catch (retryError) {
      fail(
        `${rootPrismaDir} の再作成に失敗しました（他プロセスとの競合を解消できませんでした）。`,
        [
          ...symlinkRecoverySteps(retryError),
          `原因: ${retryError instanceof Error ? retryError.message : String(retryError)}`,
        ],
      );
    }
  } else {
    fail(`${rootPrismaDir} -> ${generatedPrismaDir} のシンボリックリンク作成に失敗しました。`, [
      ...symlinkRecoverySteps(error),
      `原因: ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
}

console.log(`${LOG_PREFIX} Linked ${rootPrismaDir} -> ${generatedPrismaDir}`);
