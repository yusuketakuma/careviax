import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPhosApiRouteDeploymentBindings } from '../../src/phos/infra/api-gateway-lambda-template';
import {
  buildPhosDeployTemplateValidationReport,
  evaluateLambdaArtifactContract,
  renderPhosApiGatewayLambdaTemplateJson,
  writePhosApiGatewayLambdaTemplate,
} from './validate-phos-deploy-template';

describe('validate-phos-deploy-template', () => {
  it('renders a parseable CloudFormation template with PH-OS HTTP API resources', () => {
    const template = JSON.parse(renderPhosApiGatewayLambdaTemplateJson()) as {
      Resources: Record<string, { Type: string }>;
    };

    expect(template.Resources.PhosHttpApi.Type).toBe('AWS::ApiGatewayV2::Api');
    expect(template.Resources.PhosJwtAuthorizer.Type).toBe('AWS::ApiGatewayV2::Authorizer');
  });

  it('writes the template to the requested artifact path', () => {
    const dir = mkdtempSync(join(tmpdir(), 'phos-template-'));
    const outputPath = join(dir, 'template.json');

    expect(writePhosApiGatewayLambdaTemplate({ output_path: outputPath })).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);
    expect(JSON.parse(readFileSync(outputPath, 'utf8'))).toMatchObject({
      AWSTemplateFormatVersion: '2010-09-09',
    });
  });

  it('passes when AWS CLI validate-template and cfn-lint both pass', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const report = buildPhosDeployTemplateValidationReport({
      now: new Date('2026-06-10T00:00:00.000Z'),
      output_path: join(mkdtempSync(join(tmpdir(), 'phos-template-')), 'template.json'),
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
      output_path: join(mkdtempSync(join(tmpdir(), 'phos-template-')), 'template.json'),
      runner: () => ({ exit_code: null, stdout: '', stderr: '', error_code: 'ENOENT' }),
    });
    const strictReport = buildPhosDeployTemplateValidationReport({
      strict: true,
      output_path: join(mkdtempSync(join(tmpdir(), 'phos-template-')), 'template.json'),
      runner: () => ({ exit_code: null, stdout: '', stderr: '', error_code: 'ENOENT' }),
    });

    expect(report.ok).toBe(true);
    expect(strictReport.ok).toBe(false);
    expect(strictReport.missing_tools).toEqual([
      'PHOS_LAMBDA_ARTIFACT_ROOT',
      'aws',
      'cfn-lint',
    ]);
    expect(strictReport.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'cloudformation_validate_template', status: 'missing' }),
        expect.objectContaining({ name: 'cfn_lint', status: 'missing' }),
        expect.objectContaining({ name: 'lambda_artifact_contract', status: 'missing' }),
      ]),
    );
  });

  it('fails when an external validator returns a non-zero exit code', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const report = buildPhosDeployTemplateValidationReport({
      output_path: join(mkdtempSync(join(tmpdir(), 'phos-template-')), 'template.json'),
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

  it('fails the artifact contract when a generated handler export is missing', () => {
    const artifactRoot = createLambdaArtifactRoot();
    const [binding] = buildPhosApiRouteDeploymentBindings();
    if (!binding) throw new Error('PH-OS route binding fixture is required');
    writeFileSync(join(artifactRoot, `${binding.lambda_handler_file}.js`), 'exports.other = 1;\n');

    expect(evaluateLambdaArtifactContract({ artifact_root: artifactRoot })).toMatchObject({
      name: 'lambda_artifact_contract',
      status: 'failed',
      detail: expect.stringContaining(binding.lambda_handler_export),
    });
  });
});

function createLambdaArtifactRoot() {
  const artifactRoot = mkdtempSync(join(tmpdir(), 'phos-lambda-artifact-'));
  for (const binding of buildPhosApiRouteDeploymentBindings()) {
    const filePath = join(artifactRoot, `${binding.lambda_handler_file}.js`);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `exports.${binding.lambda_handler_export} = async () => ({});\n`, {
      flag: 'a',
    });
  }
  return artifactRoot;
}
