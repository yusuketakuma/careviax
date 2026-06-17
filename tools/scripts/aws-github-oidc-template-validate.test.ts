import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateAwsGithubOidcTemplate } from './aws-github-oidc-template-validate';

const templatePath = 'tools/infra/github-actions-ecr-oidc-role-template.yaml';

describe('validateAwsGithubOidcTemplate', () => {
  it('passes the committed GitHub OIDC ECR role contract', () => {
    const report = validateAwsGithubOidcTemplate({
      templatePath,
      now: new Date('2026-06-17T00:00:00Z'),
    });

    expect(report.summary).toEqual({ pass: 6, warn: 0, fail: 0, skip: 1 });
    expect(report.checks.map((check) => check.name)).toContain('ecr-push-repository-scope');
  });

  it('fails when OIDC subject scoping or repository scoping is removed', () => {
    const template = readFileSync(templatePath, 'utf8')
      .replace('token.actions.githubusercontent.com:sub: !Ref GitHubSubject', '')
      .replace(
        "Resource: !Sub 'arn:${AWS::Partition}:ecr:${AWS::Region}:${AWS::AccountId}:repository/${RepositoryName}'",
        "Resource: '*'",
      );

    const report = validateAwsGithubOidcTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'trust-policy-conditions')?.status).toBe(
      'fail',
    );
    expect(report.checks.find((check) => check.name === 'ecr-push-repository-scope')?.status).toBe(
      'fail',
    );
  });

  it('fails broad ECR wildcard permissions', () => {
    const template = readFileSync(templatePath, 'utf8').replace(
      'ecr:BatchCheckLayerAvailability',
      'ecr:*',
    );

    const report = validateAwsGithubOidcTemplate({
      templatePath,
      templateText: template,
    });

    expect(report.checks.find((check) => check.name === 'no-broad-ecr-wildcards')?.status).toBe(
      'fail',
    );
  });
});
