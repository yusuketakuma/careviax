import { describe, expect, it } from 'vitest';
import { createEcsExpressPlan, formatEcsExpressPlanAsShell } from './aws-ecs-express-plan';

describe('createEcsExpressPlan', () => {
  it('orders ECS Express live validation before mutating commands', () => {
    const plan = createEcsExpressPlan();
    const preflight = plan.phases.find((phase) => phase.id === 'local-preflight');
    const foundation = plan.phases.find((phase) => phase.id === 'foundation-stacks');
    const service = plan.phases.find((phase) => phase.id === 'ecs-express-service');

    expect(preflight?.commands.every((item) => item.mutates === false)).toBe(true);
    expect(
      foundation?.commands
        .filter((item) => item.id.startsWith('deploy-'))
        .every((item) => item.mutates === true),
    ).toBe(true);
    expect(
      service?.commands.find((item) => item.id === 'create-ecs-express-service')?.mutates,
    ).toBe(true);
  });

  it('generates AWS-spec commands for roles, service input, and ECS Express creation', () => {
    const plan = createEcsExpressPlan();
    const text = JSON.stringify(plan);

    expect(text).toContain('tools/infra/ecs-express-roles-template.yaml');
    expect(text).toContain('tools/infra/ecs-express-runtime-policy-template.yaml');
    expect(text).toContain('PHOS_ECS_SECRET_ARNS');
    expect(text).toContain('CAPABILITY_NAMED_IAM');
    expect(text).toContain('tools/infra/ecs-express-service-input.example.json');
    expect(text).toContain('aws ecs create-express-gateway-service');
    expect(text).toContain('--cli-input-json file://tmp/ecs-express-service-input.json');
    expect(text).toContain('--monitor-mode TEXT-ONLY');
    expect(text).toContain('aws ecs describe-express-gateway-service');
  });

  it('uses shell-safe CloudFormation output queries and includes the current estimate', () => {
    const plan = createEcsExpressPlan();
    const shell = formatEcsExpressPlanAsShell(plan);

    expect(shell).toContain('# estimated_monthly_usd: 76.42');
    expect(shell).toContain("--query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleArn`]");
    expect(shell).toContain("--query 'Stacks[0].Outputs[?OutputKey==`TaskExecutionRoleName`]");
    expect(shell).toContain('TaskExecutionRoleName="$task_execution_role_name"');
    expect(shell).not.toContain('--query "Stacks[0].Outputs');
  });

  it('supports custom names without widening the repository scope', () => {
    const plan = createEcsExpressPlan({
      region: 'ap-northeast-1',
      prefix: 'careviax-ecs',
      repositoryName: 'careviax/app',
      ecrStackName: 'careviax-ecr',
      rolesStackName: 'careviax-ecs-roles',
      runtimePolicyStackName: 'careviax-ecs-runtime-policy',
      serviceName: 'careviax-service',
      cluster: 'default',
      serviceInputPath: 'tmp/careviax-service.json',
    });

    const text = JSON.stringify(plan);
    expect(text).toContain('RepositoryName=careviax/app');
    expect(text).toContain('Prefix=careviax-ecs');
    expect(text).toContain('https://careviax-service.ecs.ap-northeast-1.on.aws');
    expect(text).not.toContain('RepositoryName=ph-os/app');
  });
});
