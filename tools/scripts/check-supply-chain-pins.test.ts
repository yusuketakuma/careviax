import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

type SupplyChainPinsModule = {
  checkSupplyChainPins(root?: string): void;
  validateCiGateSource(source: string, sourceName?: string): void;
  validateDependabotSource(source: string, sourceName?: string): void;
  validateDockerfileSource(source: string, sourceName?: string): void;
  validatePackageSource(source: string, sourceName?: string): void;
  validateWorkflowSource(source: string, sourceName?: string): void;
};

let pins: SupplyChainPinsModule;

beforeAll(async () => {
  // @ts-expect-error The static-gate CLI is plain ESM and intentionally has no .d.ts file.
  pins = (await import('./check-supply-chain-pins.mjs')) as SupplyChainPinsModule;
});

function read(path: string) {
  return readFileSync(path, 'utf8');
}

describe('supply-chain pin ratchet', () => {
  it('accepts the checked-in workflows, Dockerfile, and Dependabot configuration', () => {
    expect(() => pins.checkSupplyChainPins()).not.toThrow();
  });

  it('rejects a moving action tag', () => {
    const workflow = read('.github/workflows/ci.yml').replace(
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1',
      'actions/checkout@v4',
    );

    expect(() => pins.validateWorkflowSource(workflow)).toThrow(/full 40-character commit SHA/);
  });

  it('rejects a short action SHA', () => {
    const workflow = read('.github/workflows/ci.yml').replace(
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1',
      'actions/checkout@34e1148 # v4.3.1',
    );

    expect(() => pins.validateWorkflowSource(workflow)).toThrow(/full 40-character commit SHA/);
  });

  it('rejects a full-length annotated tag object instead of its peeled commit', () => {
    const workflow = read('.github/workflows/aws-container-image.yml').replace(
      'aws-actions/configure-aws-credentials@7474bc4690e29a8392af63c5b98e7449536d5c3a',
      'aws-actions/configure-aws-credentials@ff717079ee2060e4bcee96c4779b553acc87447c',
    );

    expect(() => pins.validateWorkflowSource(workflow)).toThrow(/does not use its verified commit/);
  });

  it('rejects a fork repository even when it reuses a verified commit SHA', () => {
    const workflow = read('.github/workflows/ci.yml').replace(
      'actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
      'untrusted-fork/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5',
    );

    expect(() => pins.validateWorkflowSource(workflow)).toThrow(/has no verified pin/);
  });

  it('rejects moving tags and forks behind an actionlint-valid quoted uses key', () => {
    const workflow = (reference: string) =>
      `name: Quoted uses\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - "uses": ${reference}\n`;
    expect(() => pins.validateWorkflowSource(workflow('actions/checkout@v4'))).toThrow(
      /full 40-character commit SHA/,
    );
    expect(() =>
      pins.validateWorkflowSource(
        workflow('untrusted-fork/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5 # v4.3.1'),
      ),
    ).toThrow(/has no verified pin/);
  });

  it('rejects actionlint-valid flow-style uses mappings for tags and fork SHAs', () => {
    const workflow = (reference: string) =>
      `name: Flow uses\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - { uses: ${reference} }\n`;

    expect(() => pins.validateWorkflowSource(workflow('actions/checkout@v4'))).toThrow(
      /flow-style uses mappings are unsupported/,
    );
    expect(() =>
      pins.validateWorkflowSource(
        workflow('untrusted-fork/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5'),
      ),
    ).toThrow(/flow-style uses mappings are unsupported/);
    expect(() =>
      pins.validateWorkflowSource(
        `name: Later flow key\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - { name: Checkout, uses: actions/checkout@v4 }\n`,
      ),
    ).toThrow(/flow-style uses mappings are unsupported/);
    expect(() =>
      pins.validateWorkflowSource(
        `name: Nested flow\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - { with: { fetch-depth: 0 }, uses: actions/checkout@v4 }\n`,
      ),
    ).toThrow(/flow-style uses mappings are unsupported/);
    expect(() =>
      pins.validateWorkflowSource(
        `name: Flow run\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - { run: echo ok }\n`,
      ),
    ).not.toThrow();
  });

  it('fails closed on actionlint-valid multiline flow mappings with moving uses refs', () => {
    expect(() =>
      pins.validateWorkflowSource(
        `name: Multiline flow\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - { name: Checkout,\n          uses: actions/checkout@v4 }\n`,
      ),
    ).toThrow(/full 40-character commit SHA/);
    expect(() =>
      pins.validateWorkflowSource(
        `name: Multiline reusable\non: push\njobs:\n  call: {\n    uses: owner/repo/.github/workflows/reusable.yml@v1\n  }\n`,
      ),
    ).toThrow(/full 40-character commit SHA/);
  });

  it('rejects actionlint-valid explicit-key uses mappings for tags and fork SHAs', () => {
    const workflow = (reference: string) =>
      `name: Explicit uses\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - ? uses\n        : ${reference}\n`;

    expect(() => pins.validateWorkflowSource(workflow('actions/checkout@v4'))).toThrow(
      /explicit-key uses syntax is unsupported/,
    );
    expect(() =>
      pins.validateWorkflowSource(
        workflow('untrusted-fork/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5'),
      ),
    ).toThrow(/explicit-key uses syntax is unsupported/);
  });

  it('rejects actionlint-valid reusable workflow uses in job-level alternate mappings', () => {
    expect(() =>
      pins.validateWorkflowSource(
        `name: Flow reusable\non: push\njobs:\n  call: { uses: owner/repo/.github/workflows/reusable.yml@v1 }\n`,
      ),
    ).toThrow(/flow-style uses mappings are unsupported/);
    expect(() =>
      pins.validateWorkflowSource(
        `name: Explicit reusable\non: push\njobs:\n  call:\n    ? uses\n    : owner/repo/.github/workflows/reusable.yml@v1\n`,
      ),
    ).toThrow(/explicit-key uses syntax is unsupported/);
  });

  it('allows display-only uses properties inside block-scalar scripts', () => {
    const workflow = `name: Script object\non: push\njobs:\n  check:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/github-script@f28e40c7f34bde8b3046d885e986cb6290c5673b # v7.1.0\n        with:\n          script: |\n            const metadata = { uses: "display-only" };\n            core.info(JSON.stringify(metadata));\n`;

    expect(() => pins.validateWorkflowSource(workflow)).not.toThrow();
  });

  it('rejects an unverified version comment', () => {
    const workflow = read('.github/workflows/ci.yml').replace('# v4.3.1', '# v4');

    expect(() => pins.validateWorkflowSource(workflow)).toThrow(/version comment v4.3.1/);
  });

  it('allows repository-local actions without an external pin', () => {
    const workflow = `name: Local action\njobs:\n  check:\n    steps:\n      - uses: ./.github/actions/local-check\n`;

    expect(() => pins.validateWorkflowSource(workflow)).not.toThrow();
  });

  it('rejects removal or duplication of the CI supply-chain gate', () => {
    const workflow = read('.github/workflows/ci.yml');
    const gate = `      - name: Supply-chain pin check\n        run: pnpm supply-chain-pins:check\n`;

    expect(() => pins.validateCiGateSource(workflow.replace(`${gate}\n`, ''))).toThrow(
      /missing supply-chain pin check step/,
    );
    expect(() => pins.validateCiGateSource(`${workflow}\n${gate}`)).toThrow(
      /duplicate supply-chain pin check step/,
    );
  });

  it('rejects moving the CI supply-chain gate before dependency installation', () => {
    const workflow = read('.github/workflows/ci.yml');
    const gate = `      - name: Supply-chain pin check\n        run: pnpm supply-chain-pins:check\n`;
    const moved = workflow
      .replace(`${gate}\n`, '')
      .replace('      - name: Install dependencies', `${gate}\n      - name: Install dependencies`);

    expect(() => pins.validateCiGateSource(moved)).toThrow(
      /must immediately follow dependency install/,
    );
  });

  it('rejects moving the CI supply-chain gate into a later job', () => {
    const workflow = read('.github/workflows/ci.yml');
    const gate = `      - name: Supply-chain pin check\n        run: pnpm supply-chain-pins:check\n`;
    const install = `      - name: Install dependencies\n        run: pnpm install --frozen-lockfile`;
    const withoutGate = workflow.replace(`${gate}\n`, '');
    const firstInstall = withoutGate.indexOf(install);
    const secondInstall = withoutGate.indexOf(install, firstInstall + install.length);
    if (secondInstall < 0) throw new Error('second install fixture missing');
    const insertionPoint = secondInstall + install.length;
    const moved = `${withoutGate.slice(0, insertionPoint)}\n\n${gate.trimEnd()}${withoutGate.slice(insertionPoint)}`;

    expect(() => pins.validateCiGateSource(moved)).toThrow(/missing supply-chain pin check step/);
  });

  it('rejects exact gate markers hidden in a ci job scalar instead of its steps', () => {
    const workflow = read('.github/workflows/ci.yml');
    const install = `      - name: Install dependencies\n        run: pnpm install --frozen-lockfile`;
    const gate = `      - name: Supply-chain pin check\n        run: pnpm supply-chain-pins:check`;
    const withoutRealSteps = workflow
      .replace(
        `${install}\n\n${gate}`,
        '      - name: No supply-chain gate\n        run: echo no-gate',
      )
      .replace('    name: Lint / Test / Build', `    name: |2\n${install}\n\n${gate}`);

    expect(() => pins.validateCiGateSource(withoutRealSteps)).toThrow(
      /missing dependency install marker/,
    );
  });

  it('rejects a digestless external Docker base image', () => {
    const dockerfile = read('Dockerfile').replace(
      /node:24\.16\.0-slim@sha256:[0-9a-f]{64}/,
      'node:24.16.0-slim',
    );

    expect(() => pins.validateDockerfileSource(dockerfile)).toThrow(/must use a sha256 digest/);
  });

  it('rejects an unverified Docker digest', () => {
    const dockerfile = read('Dockerfile').replace(
      /sha256:[0-9a-f]{64}/,
      `sha256:${'0'.repeat(64)}`,
    );

    expect(() => pins.validateDockerfileSource(dockerfile)).toThrow(/unverified digest/);
  });

  it('allows later Docker stages to reference earlier stage aliases', () => {
    expect(() => pins.validateDockerfileSource(read('Dockerfile'))).not.toThrow();
  });

  it('allows an immutable scratch stage without an external digest', () => {
    expect(() => pins.validateDockerfileSource('FROM scratch AS empty\nFROM empty')).not.toThrow();
  });

  it.each(['github-actions', 'docker', 'npm'])('rejects a missing %s updater', (ecosystem) => {
    const source = read('.github/dependabot.yml');
    const start = source.indexOf(`  - package-ecosystem: ${ecosystem}`);
    const next = source.indexOf('\n  - package-ecosystem:', start + 1);
    const withoutEntry = source.slice(0, start) + source.slice(next < 0 ? source.length : next + 1);

    expect(() => pins.validateDependabotSource(withoutEntry)).toThrow(
      new RegExp(`missing ${ecosystem} updater`),
    );
  });

  it.each(['github-actions', 'docker', 'npm'])('rejects a duplicate %s updater', (ecosystem) => {
    const source = read('.github/dependabot.yml');
    const start = source.indexOf(`  - package-ecosystem: ${ecosystem}`);
    const next = source.indexOf('\n  - package-ecosystem:', start + 1);
    const entry = source.slice(start, next < 0 ? source.length : next + 1);

    expect(() => pins.validateDependabotSource(`${source}\n${entry}`)).toThrow(
      new RegExp(`duplicate ${ecosystem} updater`),
    );
  });

  it('rejects missing or drifted npm lockfile-only strategy', () => {
    const source = read('.github/dependabot.yml');
    expect(() =>
      pins.validateDependabotSource(source.replace('    versioning-strategy: lockfile-only\n', '')),
    ).toThrow(/exactly one direct versioning-strategy/);
    expect(() =>
      pins.validateDependabotSource(
        source.replace('versioning-strategy: lockfile-only', 'versioning-strategy: increase'),
      ),
    ).toThrow(/npm updater must use versioning-strategy lockfile-only/);
  });

  it('rejects updater entries outside the top-level updates mapping', () => {
    const source = read('.github/dependabot.yml').replace(/^updates:/m, 'not-updates:');

    expect(() => pins.validateDependabotSource(source)).toThrow(/missing updates mapping/);
    expect(() => pins.validateDependabotSource(source.replace(/^not-updates:\n/m, ''))).toThrow(
      /missing updates mapping/,
    );
    expect(() =>
      pins.validateDependabotSource(`${read('.github/dependabot.yml')}\nupdates: []`),
    ).toThrow(/duplicate updates mapping/);
  });

  it('rejects duplicate top-level version keys', () => {
    const source = `version: 2\n${read('.github/dependabot.yml')}`;

    expect(() => pins.validateDependabotSource(source)).toThrow(
      /top-level version must appear exactly once/,
    );
  });

  it('rejects direct updater fields overridden by duplicate YAML keys', () => {
    const source = read('.github/dependabot.yml');
    expect(() =>
      pins.validateDependabotSource(
        source.replace('    directory: /\n', '    directory: /\n    directory: /wrong\n'),
      ),
    ).toThrow(/exactly one direct directory/);
    expect(() =>
      pins.validateDependabotSource(
        source.replace(
          '      interval: weekly\n',
          '      interval: weekly\n      interval: daily\n',
        ),
      ),
    ).toThrow(/exactly one direct schedule interval/);
    expect(() =>
      pins.validateDependabotSource(
        source.replace(
          '    versioning-strategy: lockfile-only\n',
          '    versioning-strategy: lockfile-only\n    versioning-strategy: increase\n',
        ),
      ),
    ).toThrow(/exactly one direct versioning-strategy/);
  });

  it('rejects duplicate schedule mappings while allowing unrelated optional fields', () => {
    const source = read('.github/dependabot.yml');
    const withOptionalField = source.replace(
      '    directory: /\n',
      '    directory: /\n    open-pull-requests-limit: 5\n',
    );
    expect(() => pins.validateDependabotSource(withOptionalField)).not.toThrow();

    expect(() =>
      pins.validateDependabotSource(
        source.replace(
          '    schedule:\n      interval: weekly\n',
          '    schedule:\n      interval: weekly\n    schedule:\n      interval: daily\n',
        ),
      ),
    ).toThrow(/duplicate schedule mapping/);
    expect(() =>
      pins.validateDependabotSource(
        source.replace(
          '    schedule:\n      interval: weekly\n',
          '    schedule:\n      interval: weekly\n    schedule: { interval: daily }\n',
        ),
      ),
    ).toThrow(/duplicate schedule mapping/);
  });

  it('rejects duplicate updater identity and non-npm versioning strategy fields', () => {
    const source = read('.github/dependabot.yml');
    expect(() =>
      pins.validateDependabotSource(
        source.replace(
          '  - package-ecosystem: github-actions\n',
          '  - package-ecosystem: github-actions\n    package-ecosystem: npm\n',
        ),
      ),
    ).toThrow(/duplicate package-ecosystem key/);
    expect(() =>
      pins.validateDependabotSource(
        source.replace(
          '  - package-ecosystem: docker\n',
          '  - package-ecosystem: docker\n    versioning-strategy: increase\n',
        ),
      ),
    ).toThrow(/docker updater must not define versioning-strategy/);
  });

  it('rejects removal or drift of the package gate command', () => {
    const packageJson = JSON.parse(read('package.json')) as {
      scripts: Record<string, string>;
    };
    delete packageJson.scripts['supply-chain-pins:check'];
    expect(() => pins.validatePackageSource(JSON.stringify(packageJson))).toThrow(
      /supply-chain-pins:check/,
    );

    packageJson.scripts['supply-chain-pins:check'] = 'node tools/scripts/other-check.mjs';
    expect(() => pins.validatePackageSource(JSON.stringify(packageJson))).toThrow(
      /check-supply-chain-pins\.mjs/,
    );
  });
});
