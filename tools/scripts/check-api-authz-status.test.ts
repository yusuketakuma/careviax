import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-api-authz-status.mjs');

function createFixtureRepo(routeSource: string, testSource?: string) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-api-authz-status-'));
  mkdirSync(path.join(root, 'tools/scripts'), { recursive: true });
  mkdirSync(path.join(root, 'src/app/api/example'), { recursive: true });
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-api-authz-status.mjs'));
  symlinkSync(path.join(process.cwd(), 'node_modules'), path.join(root, 'node_modules'), 'dir');
  writeFileSync(path.join(root, 'src/app/api/example/route.ts'), routeSource);
  if (testSource) {
    writeFileSync(path.join(root, 'src/app/api/example/route.test.ts'), testSource);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-api-authz-status.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-api-authz-status', () => {
  it('allows malformed input and combined missing-or-inaccessible validation errors', () => {
    const root = createFixtureRepo(`
      if (!payload) return validationError('リクエストボディが不正です');
      if (!careCase) return validationError('担当外リソースのタスクは作成できません');
    `);

    expect(runCheck(root)).toContain('API authorization status check passed');
  });

  it('rejects permission messages passed directly to validationError', () => {
    const root = createFixtureRepo(`
      return validationError('患者またはケースの割当権限がありません');
    `);

    expect(() => runCheck(root)).toThrow(/Use forbidden\(\)\/403 AUTH_FORBIDDEN/);
  });

  it('rejects multiline validationError permission messages', () => {
    const root = createFixtureRepo(`
      return validationError(
        '担当者の変更権限がありません',
        { assigned_to: ['変更可能な担当者を選択してください'] },
      );
    `);

    expect(() => runCheck(root)).toThrow(/担当者の変更権限がありません/);
  });

  it('ignores validationError text inside comments and string literals', () => {
    const root = createFixtureRepo(`
      // return validationError('コメント内の権限エラー');
      /* validationError('ブロックコメント内の権限エラー') */
      const documentation = "validationError('文字列内の権限エラー')";
      return validationError('入力値が不正です', { documentation });
    `);

    expect(runCheck(root)).toContain('API authorization status check passed');
  });

  it('detects permission messages after regex literals containing quote characters', () => {
    const root = createFixtureRepo(String.raw`
      const quotePattern = /['"]/u;
      if (quotePattern.test(input)) return validationError('割当権限がありません');
    `);

    expect(() => runCheck(root)).toThrow(/割当権限がありません/);
  });

  it('rejects escaped Unicode permission literals', () => {
    const root = createFixtureRepo(String.raw`
      return validationError('\u6a29\u9650がありません');
    `);

    expect(() => runCheck(root)).toThrow(/権限がありません/);
  });

  it('allows dynamic messages whose semantics must be covered by route tests', () => {
    const root = createFixtureRepo(`
      const message = resolveValidationMessage();
      return validationError(message);
    `);

    expect(runCheck(root)).toContain('API authorization status check passed');
  });

  it('does not scan route tests', () => {
    const root = createFixtureRepo(
      `return validationError('入力値が不正です');`,
      `expect(validationError('テスト用の権限メッセージ')).toBeDefined();`,
    );

    expect(runCheck(root)).toContain('API authorization status check passed');
  });
});
