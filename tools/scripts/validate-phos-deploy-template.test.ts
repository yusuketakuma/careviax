import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PHOS_API_ROUTES } from '../../src/phos/infra/api-gateway-routes';
import {
  buildPhosDeployTemplateValidationReport,
  collectPhosCloudFormationLambdaHandlers,
  evaluateLambdaArtifactContract,
  renderPhosApiGatewayLambdaTemplateJson,
  resolveSafeArtifactPath,
  writePhosApiGatewayLambdaTemplate,
} from './validate-phos-deploy-template';
import { buildPhosLambdaArtifact } from './build-phos-lambda-artifact';

describe('validate-phos-deploy-template', () => {
  it('renders a parseable CloudFormation template with PH-OS HTTP API resources', () => {
    const template = JSON.parse(renderPhosApiGatewayLambdaTemplateJson()) as {
      Resources: Record<string, { Type: string }>;
    };

    expect(template.Resources.PhosHttpApi.Type).toBe('AWS::ApiGatewayV2::Api');
    expect(template.Resources.PhosJwtAuthorizer.Type).toBe('AWS::ApiGatewayV2::Authorizer');
  });

  it('collects every Lambda handler from the rendered CloudFormation template', () => {
    const handlers = collectPhosCloudFormationLambdaHandlers();

    expect(handlers).toHaveLength(PHOS_API_ROUTES.length + 1);
    expect(handlers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logical_id: 'PhosCognitoPreTokenGenerationFunction',
          handler: 'src/phos/backend/cognito-pre-token-generation.handler',
          artifact_file: 'src/phos/backend/cognito-pre-token-generation.js',
        }),
        expect.objectContaining({
          handler: 'src/phos/backend/cards-lambda.cardSearchHandler',
          artifact_file: 'src/phos/backend/cards-lambda.js',
        }),
      ]),
    );
  });

  it('writes the template to the requested artifact path', () => {
    const outputPath = artifactPath('template-write', 'template.json');

    expect(writePhosApiGatewayLambdaTemplate({ output_path: outputPath })).toBe(
      join(process.cwd(), outputPath),
    );
    expect(existsSync(outputPath)).toBe(true);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({
      AWSTemplateFormatVersion: '2010-09-09',
    });
  });

  it('rejects deploy artifact paths outside the ignored artifacts directory', () => {
    for (const unsafePath of [
      '.',
      '..',
      '../template.json',
      '/tmp/template.json',
      'src/out.json',
    ]) {
      expect(() => resolveSafeArtifactPath(unsafePath)).toThrow('PH-OS artifact paths must');
    }
    expect(resolveSafeArtifactPath('artifacts/phos-api-gateway-lambda-template.json')).toBe(
      'artifacts/phos-api-gateway-lambda-template.json',
    );
  });

  it('passes when AWS CLI validate-template and cfn-lint both pass', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const report = buildPhosDeployTemplateValidationReport({
      now: new Date('2026-06-10T00:00:00.000Z'),
      output_path: artifactPath('template-pass', 'template.json'),
      env: { PHOS_LAMBDA_ARTIFACT_ROOT: artifactRoot },
      runner: (command, args) => {
        calls.push({ command, args });
        return { exit_code: 0, stdout: `${command} ok`, stderr: '' };
      },
    });

    expect(report).toMatchObject({
      ok: true,
      missing_tools: [],
      checks: [
        { name: 'cloudformation_template_export', status: 'passed' },
        { name: 'cloudformation_validate_template', status: 'passed' },
        { name: 'cfn_lint', status: 'passed' },
        { name: 'lambda_artifact_contract', status: 'passed' },
      ],
    });
    expect(calls).toEqual([
      {
        command: 'aws',
        args: [
          'cloudformation',
          'validate-template',
          '--template-body',
          `file://${report.template_path}`,
        ],
      },
      { command: 'cfn-lint', args: [report.template_path] },
    ]);
  });

  it('reports missing external validation tools and fails only in strict mode', () => {
    const report = buildPhosDeployTemplateValidationReport({
      output_path: artifactPath('template-missing', 'template.json'),
      env: { PHOS_LAMBDA_ARTIFACT_ROOT: '' },
      runner: () => ({ exit_code: null, stdout: '', stderr: '', error_code: 'ENOENT' }),
    });
    const strictReport = buildPhosDeployTemplateValidationReport({
      strict: true,
      output_path: artifactPath('template-missing-strict', 'template.json'),
      env: { PHOS_LAMBDA_ARTIFACT_ROOT: '' },
      runner: () => ({ exit_code: null, stdout: '', stderr: '', error_code: 'ENOENT' }),
    });

    expect(report.ok).toBe(true);
    expect(strictReport.ok).toBe(false);
    expect(strictReport.missing_tools).toEqual(['PHOS_LAMBDA_ARTIFACT_ROOT', 'aws', 'cfn-lint']);
    expect(strictReport.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cloudformation_validate_template', status: 'missing' }),
        expect.objectContaining({ name: 'cfn_lint', status: 'missing' }),
        expect.objectContaining({ name: 'lambda_artifact_contract', status: 'missing' }),
      ]),
    );
  });

  it('supports an artifact-only strict validation mode for CI without AWS credentials', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const calls: Array<{ command: string; args: readonly string[] }> = [];

    const report = buildPhosDeployTemplateValidationReport({
      strict: true,
      external_validation: false,
      output_path: artifactPath('template-artifact-only', 'template.json'),
      env: { PHOS_LAMBDA_ARTIFACT_ROOT: artifactRoot },
      runner: (command, args) => {
        calls.push({ command, args });
        return { exit_code: 1, stdout: '', stderr: 'should not run' };
      },
    });

    expect(report).toMatchObject({
      ok: true,
      missing_tools: [],
      checks: [
        { name: 'cloudformation_template_export', status: 'passed' },
        { name: 'lambda_artifact_contract', status: 'passed' },
      ],
    });
    expect(calls).toEqual([]);
  });

  it('fails when an external validator returns a non-zero exit code', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const report = buildPhosDeployTemplateValidationReport({
      output_path: artifactPath('template-failure', 'template.json'),
      env: { PHOS_LAMBDA_ARTIFACT_ROOT: artifactRoot },
      runner: (command) =>
        command === 'aws'
          ? { exit_code: 1, stdout: '', stderr: 'template invalid' }
          : { exit_code: 0, stdout: 'ok', stderr: '' },
    });

    expect(report.ok).toBe(false);
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'cloudformation_validate_template',
          status: 'failed',
          detail: expect.stringContaining('template invalid'),
        }),
      ]),
    );
  });

  it('checks the unpacked Lambda artifact directory for every CloudFormation handler export', () => {
    const artifactRoot = createLambdaArtifactRoot();

    expect(evaluateLambdaArtifactContract({ artifact_root: artifactRoot })).toMatchObject({
      name: 'lambda_artifact_contract',
      status: 'passed',
    });
  });

  it('builds a reproducible local Lambda artifact and validates its CloudFormation handlers', () => {
    const artifactRoot = artifactPath('lambda-build', 'out');

    expect(buildPhosLambdaArtifact(artifactRoot)).toMatchObject({
      ok: true,
      output_root: artifactRoot,
      entry_points: expect.arrayContaining([
        'src/phos/backend/cognito-pre-token-generation.ts',
        'src/phos/backend/cards-lambda.ts',
      ]),
    });
    expect(evaluateLambdaArtifactContract({ artifact_root: artifactRoot })).toMatchObject({
      name: 'lambda_artifact_contract',
      status: 'passed',
    });
  });

  it('refuses to build Lambda artifacts outside artifacts/', () => {
    for (const unsafePath of ['.', '..', '../out', '/tmp/phos-lambda-unpacked', 'src/out']) {
      expect(() => buildPhosLambdaArtifact(unsafePath)).toThrow('PH-OS artifact paths must');
    }
  });

  it('fails the artifact contract when a generated handler export is missing', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const handler = collectPhosCloudFormationLambdaHandlers().find(
      (entry) => entry.logical_id === 'PhosCognitoPreTokenGenerationFunction',
    );
    if (!handler) throw new Error('Cognito trigger handler fixture is required');
    writeFileSync(join(artifactRoot, handler.artifact_file), 'exports.other = 1;\n');

    expect(evaluateLambdaArtifactContract({ artifact_root: artifactRoot })).toMatchObject({
      name: 'lambda_artifact_contract',
      status: 'failed',
      detail: expect.stringContaining('PhosCognitoPreTokenGenerationFunction'),
    });
  });
});

function createLambdaArtifactRoot() {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'phos-lambda-artifact-'));
  for (const handler of collectPhosCloudFormationLambdaHandlers()) {
    const filePath = join(artifactRoot, handler.artifact_file);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `exports.${handler.handler_export} = async () => ({});\n`, {
      flag: 'a',
    });
  }
  return artifactRoot;
}

let artifactPathCounter = 0;

function artifactPath(group: string, leaf: string) {
  artifactPathCounter += 1;
  return join('artifacts', `phos-test-${process.pid}-${artifactPathCounter}-${group}`, leaf);
}
