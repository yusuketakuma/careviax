import { describe, expect, it } from 'vitest';
import {
  createAwsPilotDeploymentPlan,
  formatAwsPilotDeploymentPlanAsShell,
} from './aws-pilot-deployment-plan';

describe('createAwsPilotDeploymentPlan', () => {
  it('keeps the validation phase read-only and marks provisioning phases as mutating', () => {
    const plan = createAwsPilotDeploymentPlan();
    const localPreflight = plan.phases.find((phase) => phase.id === 'local-preflight');
    const foundation = plan.phases.find((phase) => phase.id === 'foundation-stacks');
    const lightsail = plan.phases.find((phase) => phase.id === 'lightsail-stack');

    expect(localPreflight?.commands.every((item) => item.mutates === false)).toBe(true);
    expect(
      foundation?.commands
        .filter((item) => item.id.startsWith('deploy-'))
        .every((item) => item.mutates === true),
    ).toBe(true);
    expect(lightsail?.commands.find((item) => item.id === 'deploy-lightsail-pilot')?.mutates).toBe(
      true,
    );
  });

  it('generates AWS-spec CloudFormation deployment commands for ECR, OIDC, and Lightsail', () => {
    const plan = createAwsPilotDeploymentPlan();
    const text = JSON.stringify(plan);
    const lightsailDeploy = plan.phases
      .flatMap((phase) => phase.commands)
      .find((item) => item.id === 'deploy-lightsail-pilot');

    expect(text).toContain('--template-file tools/infra/ecr-repository-template.yaml');
    expect(text).toContain(
      '--template-file tools/infra/github-actions-ecr-oidc-role-template.yaml',
    );
    expect(text).toContain('--capabilities CAPABILITY_NAMED_IAM');
    expect(text).toContain('GitHubSubject=repo:yusuketakuma/careviax:environment:production');
    expect(text).toContain('--template-file tools/infra/lightsail-pilot-template.yaml');
    expect(lightsailDeploy?.command).toContain('MasterUserPassword="$PHOS_DB_MASTER_PASSWORD"');
    expect(text).not.toContain('<GENERATED_PASSWORD>');
  });

  it('includes read-only stack output lookups for role, repository, and static IP handoff', () => {
    const plan = createAwsPilotDeploymentPlan();
    const text = JSON.stringify(plan);
    const shell = formatAwsPilotDeploymentPlanAsShell(plan);

    expect(text).toContain('aws cloudformation describe-stacks');
    expect(text).toContain('OutputKey==`RoleArn`');
    expect(text).toContain('OutputKey==`RepositoryUri`');
    expect(text).toContain('OutputKey==`StaticIpAddress`');
    expect(shell).toContain("--query 'Stacks[0].Outputs[?OutputKey==`RoleArn`]");
    expect(shell).not.toContain('--query "Stacks[0].Outputs');
  });

  it('supports existing GitHub OIDC provider reuse without widening the default repository scope', () => {
    const plan = createAwsPilotDeploymentPlan({
      region: 'ap-northeast-1',
      prefix: 'careviax-pilot',
      availabilityZone: 'ap-northeast-1c',
      repositoryName: 'careviax/app',
      githubRepository: 'example/careviax',
      githubSubject: 'repo:example/careviax:environment:production',
      existingGithubOidcProviderArn:
        'arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com',
      ecrStackName: 'careviax-ecr',
      githubOidcStackName: 'careviax-github-oidc',
      lightsailStackName: 'careviax-pilot',
      databaseBundleId: 'small_2_0',
    });

    const text = JSON.stringify(plan);
    expect(text).toContain('ExistingGitHubOidcProviderArn=arn:aws:iam::123456789012');
    expect(text).toContain('RepositoryName=careviax/app');
    expect(text).toContain('GitHubRepository=example/careviax');
    expect(text).not.toContain('RepositoryName=ph-os/app');
  });

  it('formats a copyable shell plan with explicit mutation labels and the cost estimate', () => {
    const plan = createAwsPilotDeploymentPlan();
    const shell = formatAwsPilotDeploymentPlanAsShell(plan);

    expect(shell).toContain('# estimated_monthly_usd: 46.6');
    expect(shell).toContain('# READS deployment-readiness-live');
    expect(shell).toContain('# MUTATES deploy-github-oidc-role');
    expect(shell).toContain('# MUTATES run-image-workflow');
    expect(shell).toContain('role-capable runtime such as ECS/Fargate');
  });
});
