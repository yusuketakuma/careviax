import { describe, expect, it } from 'vitest';
import { createLightsailPilotPlan } from './aws-lightsail-pilot-plan';

describe('createLightsailPilotPlan', () => {
  it('keeps discovery commands non-mutating and provisioning commands explicitly mutating', () => {
    const plan = createLightsailPilotPlan();

    expect(plan.discoveryCommands.every((item) => item.mutates === false)).toBe(true);
    expect(plan.provisioningCommands.every((item) => item.mutates === true)).toBe(true);
    expect(plan.requiredEnvironment).toEqual([
      'PHOS_LIGHTSAIL_INSTANCE_BUNDLE_ID',
      'PHOS_LIGHTSAIL_DB_BLUEPRINT_ID',
      'PHOS_DB_MASTER_PASSWORD',
      'PHOS_CONTAINER_IMAGE',
    ]);
  });

  it('single-quotes JMESPath queries so shell output does not execute backticks', () => {
    const plan = createLightsailPilotPlan();
    const discovery = plan.discoveryCommands.map((item) => item.command).join('\n');

    expect(discovery).toContain("--query 'blueprints[?contains");
    expect(discovery).toContain('`true`');
    expect(discovery).not.toContain('--query "blueprints');
    expect(discovery).not.toContain('--query "bundles');
  });

  it('creates a non-public encrypted database plan using the current low-cost bundle', () => {
    const plan = createLightsailPilotPlan();
    const createDb = plan.provisioningCommands.find((item) => item.id === 'create-database');
    const createInstance = plan.provisioningCommands.find((item) => item.id === 'create-instance');

    expect(createDb?.command).toContain('--relational-database-bundle-id "small_2_0"');
    expect(createDb?.command).toContain('--no-publicly-accessible');
    expect(createDb?.command).toContain('--master-user-password "$PHOS_DB_MASTER_PASSWORD"');
    expect(createDb?.command).not.toContain('<PASSWORD>');
    expect(createInstance?.command).toContain(
      '--user-data file://tools/infra/lightsail-pilot-user-data.sh',
    );
  });

  it('allows resource names and regions to be overridden consistently', () => {
    const plan = createLightsailPilotPlan({
      region: 'ap-northeast-1',
      availabilityZone: 'ap-northeast-1c',
      prefix: 'careviax-test',
      instanceName: 'careviax-test-app',
      staticIpName: 'careviax-test-ip',
      databaseName: 'careviax-test-db',
      masterDatabaseName: 'ph_os',
      masterUsername: 'phosadmin',
      instanceBlueprintId: 'amazon_linux_2023',
      instanceBundleIdEnv: 'CUSTOM_INSTANCE_BUNDLE',
      databaseBlueprintIdEnv: 'CUSTOM_DB_BLUEPRINT',
      databaseBundleId: 'small_2_0',
      containerImageEnv: 'CUSTOM_IMAGE',
      userDataPath: 'tools/infra/lightsail-pilot-user-data.sh',
    });

    expect(JSON.stringify(plan)).toContain('careviax-test-app');
    expect(JSON.stringify(plan)).toContain('careviax-test-db');
    expect(plan.requiredEnvironment).toContain('CUSTOM_INSTANCE_BUNDLE');
    expect(plan.requiredEnvironment).toContain('CUSTOM_DB_BLUEPRINT');
    expect(plan.requiredEnvironment).toContain('CUSTOM_IMAGE');
  });
});
