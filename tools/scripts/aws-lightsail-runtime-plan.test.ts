import { describe, expect, it } from 'vitest';
import { createLightsailRuntimePlan } from './aws-lightsail-runtime-plan';

describe('createLightsailRuntimePlan', () => {
  it('prints mutating runtime setup commands without embedding env file contents', () => {
    const plan = createLightsailRuntimePlan({
      host: '203.0.113.10',
      image: 'ghcr.io/example/ph-os:sha',
      envFile: '.env.production.aws',
    });

    expect(plan.commands.map((item) => item.id)).toEqual([
      'prepare-env',
      'validate-env',
      'copy-env',
      'start-container',
      'public-health',
    ]);
    expect(plan.commands.filter((item) => item.mutates).map((item) => item.id)).toEqual([
      'prepare-env',
      'copy-env',
      'start-container',
    ]);
    expect(plan.commands.find((item) => item.id === 'validate-env')?.command).toContain(
      'pnpm aws:lightsail:runtime-env:validate',
    );
    expect(JSON.stringify(plan)).toContain('scp -p');
    expect(JSON.stringify(plan)).toContain('sudo install -m 0600 /tmp/phos.env /opt/phos/.env');
    expect(JSON.stringify(plan)).toContain('sudo docker run -d');
    expect(JSON.stringify(plan)).not.toContain('DATABASE_URL=');
    expect(JSON.stringify(plan)).not.toContain('NEXTAUTH_SECRET=');
  });

  it('uses the public health endpoint for post-start verification', () => {
    const plan = createLightsailRuntimePlan({
      host: 'ph-os.example.test',
      image: 'public.ecr.aws/example/ph-os:pilot',
      envFile: 'runtime.env',
    });

    const publicHealth = plan.commands.find((item) => item.id === 'public-health');
    expect(publicHealth?.mutates).toBe(false);
    expect(publicHealth?.command).toContain('--base-url "http://ph-os.example.test"');
    expect(publicHealth?.command).toContain('--path /api/health');
  });

  it('adds a short-lived ECR docker login command for private ECR images', () => {
    const plan = createLightsailRuntimePlan({
      host: '203.0.113.10',
      image: '123456789012.dkr.ecr.ap-northeast-1.amazonaws.com/ph-os/app:sha-abc',
      envFile: 'runtime.env',
      region: 'ap-northeast-1',
    });

    const ecrLogin = plan.commands.find((item) => item.id === 'ecr-docker-login');
    expect(ecrLogin?.mutates).toBe(true);
    expect(ecrLogin?.command).toContain('aws ecr get-login-password --region "ap-northeast-1"');
    expect(ecrLogin?.command).toContain('docker login --username AWS --password-stdin');
  });
});
