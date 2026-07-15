import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

type WorkflowSafetyModule = {
  extractInputValidationScript(workflow: string): string;
  validateWorkflow(workflow: string): void;
};

let safety: WorkflowSafetyModule;
const temporaryDirectories: string[] = [];

beforeAll(async () => {
  // @ts-expect-error The static-gate CLI is plain ESM and intentionally has no .d.ts file.
  safety = (await import('./check-workflow-dispatch-input-safety.mjs')) as WorkflowSafetyModule;
});

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readWorkflow() {
  return readFileSync('.github/workflows/aws-container-image.yml', 'utf8');
}

function runValidationScript(overrides: Record<string, string> = {}) {
  const directory = mkdtempSync(path.join(tmpdir(), 'phos-workflow-inputs-'));
  temporaryDirectories.push(directory);
  const outputPath = path.join(directory, 'github-output');
  const workflow = readWorkflow();
  const script = safety.extractInputValidationScript(workflow);
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GITHUB_OUTPUT: outputPath,
      GITHUB_SHA: '1234567890abcdef1234567890abcdef12345678',
      INPUT_AWS_REGION: 'ap-northeast-1',
      INPUT_ECR_REPOSITORY: 'ph-os/app',
      INPUT_IMAGE_TAG: '',
      INPUT_NEXT_PUBLIC_APP_URL: 'https://example.invalid',
      INPUT_NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'ap-northeast-1_placeholder',
      INPUT_NEXT_PUBLIC_COGNITO_CLIENT_ID: 'placeholderclientid',
      ...overrides,
    },
  });

  return {
    ...result,
    output: result.status === 0 ? readFileSync(outputPath, 'utf8') : '',
  };
}

describe('workflow dispatch input safety', () => {
  it('accepts the checked-in workflow and emits only validated values', () => {
    expect(() => safety.validateWorkflow(readWorkflow())).not.toThrow();

    const result = runValidationScript();
    expect(result.status).toBe(0);
    expect(result.output).toContain('aws_region=ap-northeast-1\n');
    expect(result.output).toContain('image_suffix=ph-os/app:sha-1234567890ab\n');
  });

  it.each([
    ['unapproved region', { INPUT_AWS_REGION: 'us-east-1' }],
    ['blank repository', { INPUT_ECR_REPOSITORY: '' }],
    ['oversize repository', { INPUT_ECR_REPOSITORY: `a${'b'.repeat(256)}` }],
    ['repository control character', { INPUT_ECR_REPOSITORY: 'ph-os/app\nunsafe' }],
    ['repository traversal', { INPUT_ECR_REPOSITORY: 'ph-os/../app' }],
    ['tag delimiter', { INPUT_IMAGE_TAG: 'release:latest' }],
    ['oversize tag', { INPUT_IMAGE_TAG: `r${'1'.repeat(128)}` }],
    ['tag newline', { INPUT_IMAGE_TAG: 'release\nunsafe=value' }],
    ['non-HTTPS app URL', { INPUT_NEXT_PUBLIC_APP_URL: 'http://example.invalid' }],
    ['credential-bearing app URL', { INPUT_NEXT_PUBLIC_APP_URL: 'https://user@example.invalid' }],
    ['empty hostname label', { INPUT_NEXT_PUBLIC_APP_URL: 'https://example..invalid' }],
    ['trailing empty hostname label', { INPUT_NEXT_PUBLIC_APP_URL: 'https://example.invalid.' }],
    ['leading label hyphen', { INPUT_NEXT_PUBLIC_APP_URL: 'https://example.-invalid' }],
    ['trailing label hyphen', { INPUT_NEXT_PUBLIC_APP_URL: 'https://example-' }],
    ['zero port', { INPUT_NEXT_PUBLIC_APP_URL: 'https://example.invalid:0' }],
    ['out-of-range port', { INPUT_NEXT_PUBLIC_APP_URL: 'https://example.invalid:99999' }],
    ['oversize hostname label', { INPUT_NEXT_PUBLIC_APP_URL: `https://${'a'.repeat(64)}.invalid` }],
    [
      'oversize hostname',
      {
        INPUT_NEXT_PUBLIC_APP_URL: `https://${Array.from({ length: 4 }, () => 'a'.repeat(63)).join('.')}`,
      },
    ],
    ['wrong-region user pool', { INPUT_NEXT_PUBLIC_COGNITO_USER_POOL_ID: 'us-east-1_pool' }],
    [
      'oversize user pool',
      { INPUT_NEXT_PUBLIC_COGNITO_USER_POOL_ID: `ap-northeast-1_${'a'.repeat(41)}` },
    ],
    ['invalid client ID', { INPUT_NEXT_PUBLIC_COGNITO_CLIENT_ID: 'client-id' }],
    ['oversize client ID', { INPUT_NEXT_PUBLIC_COGNITO_CLIENT_ID: 'a'.repeat(129) }],
  ])('rejects %s before producing outputs', (_label, overrides) => {
    const result = runValidationScript(overrides);
    expect(result.status).not.toBe(0);
    expect(result.output).toBe('');
    const rawInput = Object.values(overrides)[0];
    if (rawInput) expect(result.stdout).not.toContain(rawInput);
  });

  it('accepts documented ECR repository separators and a bounded explicit tag', () => {
    const result = runValidationScript({
      INPUT_ECR_REPOSITORY: 'team_a/ph-os.release',
      INPUT_IMAGE_TAG: `r${'1'.repeat(127)}`,
      INPUT_NEXT_PUBLIC_APP_URL: 'https://app.example.invalid:443',
    });

    expect(result.status).toBe(0);
    expect(result.output).toContain(`image_suffix=team_a/ph-os.release:r${'1'.repeat(127)}\n`);
    expect(result.output).toContain('next_public_app_url=https://app.example.invalid:443\n');
  });

  it('rejects a raw input expression added to a later run block', () => {
    const workflow = readWorkflow().replace(
      'echo "Container image pushed:"',
      'echo "${{ inputs.image_tag }}"\n          echo "Container image pushed:"',
    );

    expect(() => safety.validateWorkflow(workflow)).toThrow(/raw workflow_dispatch input/);
  });

  it('rejects a raw input expression added to multiline build arguments', () => {
    const workflow = readWorkflow().replace(
      'AWS_REGION=${{ steps.validate-inputs.outputs.aws_region }}',
      'AWS_REGION=${{ inputs.aws_region }}',
    );

    expect(() => safety.validateWorkflow(workflow)).toThrow(/raw workflow_dispatch input/);
  });

  it('rejects moving AWS credential configuration before validation', () => {
    const workflow = readWorkflow();
    const credentialBlock = workflow.match(
      /      - name: Configure AWS credentials\n[\s\S]*?(?=\n      - name: Login to Amazon ECR)/,
    )?.[0];
    if (!credentialBlock) throw new Error('Credential block fixture missing');
    const moved = workflow
      .replace(`${credentialBlock}\n`, '')
      .replace(
        '      - name: Validate workflow dispatch inputs',
        `${credentialBlock}\n\n      - name: Validate workflow dispatch inputs`,
      );

    expect(() => safety.validateWorkflow(moved)).toThrow(/must remain after input validation/);
  });

  it('rejects dropping any workflow input from the validation environment', () => {
    const workflow = readWorkflow().replace(
      '          INPUT_IMAGE_TAG: ${{ inputs.image_tag }}\n',
      '',
    );

    expect(() => safety.validateWorkflow(workflow)).toThrow(/mapping for image_tag/);
  });
});
