import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SCRIPT_PATH = path.join(process.cwd(), 'tools/scripts/check-task-type-registry.mjs');

const TASK_REGISTRY_SOURCE = `
import { RISK_TASK_REGISTRY } from './risk-task-registry';
export { RISK_TASK_REGISTRY } from './risk-task-registry';

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

const RISK_REGISTRY_SOURCE = `
export const RISK_TASK_REGISTRY = {
  billing: {
    owner_domain: 'billing',
    task_type: 'risk_billing',
  },
} as const satisfies Record<RiskDomain, RiskTaskRegistryEntry>;
`;

interface FixtureOptions {
  taskRegistrySource?: string;
  riskRegistrySource?: string | null;
}

function createFixtureRepo(files: Record<string, string>, options: FixtureOptions = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'phos-task-registry-'));
  for (const dir of ['tools/scripts', 'src/lib/tasks', 'src/app/api/tasks', 'src/server/jobs']) {
    mkdirSync(path.join(root, dir), { recursive: true });
  }
  cpSync(SCRIPT_PATH, path.join(root, 'tools/scripts/check-task-type-registry.mjs'));
  writeFileSync(
    path.join(root, 'src/lib/tasks/task-registry.ts'),
    options.taskRegistrySource ?? TASK_REGISTRY_SOURCE,
  );
  if (options.riskRegistrySource !== null) {
    writeFileSync(
      path.join(root, 'src/lib/tasks/risk-task-registry.ts'),
      options.riskRegistrySource ?? RISK_REGISTRY_SOURCE,
    );
  }
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
    const root = createFixtureRepo(
      {
        'src/server/jobs/daily.ts': "export const task = { taskType: 'unprefixed_new_task' };\n",
      },
      {
        taskRegistrySource: `
          ${TASK_REGISTRY_SOURCE}
          const OTHER_TASKS = [
            coreTask('unprefixed_new_task', {}),
          ];
        `,
      },
    );

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

  it('rejects a re-export-only fixture when the canonical risk source is missing', () => {
    const root = createFixtureRepo({}, { riskRegistrySource: null });

    expect(() => runCheck(root)).toThrow(
      /src\/lib\/tasks\/risk-task-registry\.ts: required registry source could not be read/,
    );
  });

  it('rejects a re-export without the runtime import used by task definitions', () => {
    const root = createFixtureRepo(
      {},
      {
        taskRegistrySource: TASK_REGISTRY_SOURCE.replace(
          "import { RISK_TASK_REGISTRY } from './risk-task-registry';\n",
          '',
        ),
      },
    );

    expect(() => runCheck(root)).toThrow(
      /must import RISK_TASK_REGISTRY from '\.\/risk-task-registry'/,
    );
  });

  it('rejects a split registry that drops the public re-export contract', () => {
    const root = createFixtureRepo(
      {},
      {
        taskRegistrySource: TASK_REGISTRY_SOURCE.replace(
          "export { RISK_TASK_REGISTRY } from './risk-task-registry';\n",
          '',
        ),
      },
    );

    expect(() => runCheck(root)).toThrow(
      /must re-export RISK_TASK_REGISTRY from '\.\/risk-task-registry'/,
    );
  });

  it('rejects registry wiring that points at a non-canonical source path', () => {
    const root = createFixtureRepo(
      {},
      {
        taskRegistrySource: TASK_REGISTRY_SOURCE.replaceAll(
          "'./risk-task-registry'",
          "'./registries/risk-task-registry'",
        ),
      },
    );

    expect(() => runCheck(root)).toThrow(
      /must import RISK_TASK_REGISTRY from '\.\/risk-task-registry'/,
    );
  });

  it('rejects duplicate risk domains in the canonical risk source', () => {
    const duplicateDomainSource = RISK_REGISTRY_SOURCE.replace(
      '\n} as const satisfies Record<RiskDomain',
      `
  billing: {
    owner_domain: 'billing',
    task_type: 'risk_billing_duplicate',
  },
} as const satisfies Record<RiskDomain`,
    );
    const root = createFixtureRepo({}, { riskRegistrySource: duplicateDomainSource });

    expect(() => runCheck(root)).toThrow(/duplicate risk domain billing/);
  });

  it('rejects duplicate risk task types across domains', () => {
    const duplicateTaskTypeSource = RISK_REGISTRY_SOURCE.replace(
      '\n} as const satisfies Record<RiskDomain',
      `
  integration: {
    owner_domain: 'integration',
    task_type: 'risk_billing',
  },
} as const satisfies Record<RiskDomain`,
    );
    const root = createFixtureRepo({}, { riskRegistrySource: duplicateTaskTypeSource });

    expect(() => runCheck(root)).toThrow(/duplicate risk task_type risk_billing/);
  });

  it('rejects a risk domain without a domain-to-module mapping', () => {
    const unmappedRiskSource = RISK_REGISTRY_SOURCE.replace(
      '\n} as const satisfies Record<RiskDomain',
      `
  integration: {
    owner_domain: 'integration',
    task_type: 'risk_integration',
  },
} as const satisfies Record<RiskDomain`,
    );
    const root = createFixtureRepo({}, { riskRegistrySource: unmappedRiskSource });

    expect(() => runCheck(root)).toThrow(/missing risk task module mapping for integration/);
  });

  it('rejects a domain-to-module mapping without a canonical risk entry', () => {
    const orphanMappingSource = TASK_REGISTRY_SOURCE.replace(
      "  billing: 'pharmacy',",
      "  billing: 'pharmacy',\n  integration: 'core',",
    );
    const root = createFixtureRepo({}, { taskRegistrySource: orphanMappingSource });

    expect(() => runCheck(root)).toThrow(/missing risk registry entry for domain integration/);
  });
});
