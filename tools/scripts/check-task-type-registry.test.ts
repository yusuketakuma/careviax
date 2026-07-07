import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-task-type-registry.mjs');

const REGISTRY_SOURCE = `
export const RISK_TASK_REGISTRY = {
  billing: {
    owner_domain: 'billing',
    task_type: 'risk_billing',
  },
} as const satisfies Record<RiskDomain, RiskTaskRegistryEntry>;

const RISK_TASK_MODULE_BY_DOMAIN = {
  billing: 'pharmacy',
} as const satisfies Record<RiskDomain, PhosModuleId>;

const TASK_TYPE_DEFINITION_SEEDS = [
  coreTask('core.general', {
    legacyTaskTypes: ['general'],
  }),
  pharmacyTask('pharmacy.visit_preparation', {
    legacyTaskTypes: ['visit_preparation'],
  }),
  coreTask('core.visit_followup', {
    legacyTaskTypes: ['visit_followup'],
  }),
] as const satisfies readonly TaskTypeDefinition[];
`;

function createFixtureRepo(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-task-registry-'));
  for (const dir of ['tools/scripts', 'src/lib/tasks', 'src/app/api/tasks', 'src/server/jobs']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-task-type-registry.mjs'));
  writeFileSync(path.join(root, 'src/lib/tasks/task-registry.ts'), REGISTRY_SOURCE);
  for (const [filePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, filePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

function runCheck(root: string) {
  return execFileSync(process.execPath, ['tools/scripts/check-task-type-registry.mjs'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe('check-task-type-registry', () => {
  it('accepts registered canonical, legacy, and risk task literals', () => {
    const root = createFixtureRepo({
      'src/app/api/tasks/route.ts': `
        export const payload = {
          task_type: 'core.general',
          other: { task_type: 'visit_preparation' },
        };
      `,
      'src/server/jobs/daily.ts': `
        export const tasks = [
          { taskType: 'visit_followup' },
          { taskType: 'pharmacy.risk_billing' },
          { task_type: 'risk_billing' },
        ];
      `,
    });

    expect(runCheck(root)).toContain('Task type registry check passed');
  });

  it('rejects unregistered taskType literals', () => {
    const root = createFixtureRepo({
      'src/server/jobs/daily.ts': "export const task = { taskType: 'visit_surprise' };\n",
    });

    expect(() => runCheck(root)).toThrow(/visit_surprise/);
  });

  it('allows unprefixed task types only when they are declared legacy', () => {
    const root = createFixtureRepo({
      'src/server/jobs/daily.ts': "export const task = { taskType: 'general' };\n",
      'src/app/api/tasks/route.ts': "export const task = { taskType: 'core.general' };\n",
    });

    expect(runCheck(root)).toContain('Task type registry check passed');
  });

  it('rejects registered unprefixed task types that are not explicit legacy entries', () => {
    const root = createFixtureRepo({
      'src/lib/tasks/task-registry.ts': `
        ${REGISTRY_SOURCE}
        const OTHER_TASKS = [
          coreTask('unprefixed_new_task', {}),
        ];
      `,
      'src/server/jobs/daily.ts': "export const task = { taskType: 'unprefixed_new_task' };\n",
    });

    expect(() => runCheck(root)).toThrow(
      /unprefixed task_type must be declared as legacyTaskTypes/,
    );
  });

  it('ignores tests and the registry source itself', () => {
    const root = createFixtureRepo({
      'src/server/jobs/daily.test.ts': "export const task = { taskType: 'not_registered' };\n",
      'src/server/jobs/daily.ts': "export const task = { taskType: 'core.general' };\n",
    });

    expect(runCheck(root)).toContain('Task type registry check passed');
  });
});
