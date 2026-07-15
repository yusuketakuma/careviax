import { describe, expect, it } from 'vitest';

import registryJson from './native-contract-registry.json';
import { FHIR_NATIVE_CONTRACT_REGISTRY, parseFhirNativeContractRegistry } from './native-contract';

function mutableRegistry(): typeof registryJson {
  return structuredClone(registryJson);
}

describe('FHIR native contract registry', () => {
  it('loads the approved A0 matrix as a closed typed contract', () => {
    expect(FHIR_NATIVE_CONTRACT_REGISTRY.resourceMatrix).toHaveLength(28);
    expect(FHIR_NATIVE_CONTRACT_REGISTRY.searchRegistry).toHaveLength(25);
    expect(FHIR_NATIVE_CONTRACT_REGISTRY.childTasks).toHaveLength(27);
    expect(FHIR_NATIVE_CONTRACT_REGISTRY.capability.external).toBe('none');
  });

  it('rejects duplicate resources', () => {
    const registry = mutableRegistry();
    registry.resourceMatrix[1].resourceType = registry.resourceMatrix[0].resourceType;

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(/duplicate value Patient/);
  });

  it('rejects resource keys that are absent from the closed registries', () => {
    const registry = mutableRegistry();
    registry.resourceMatrix[0].searchKey = 'S-UNAPPROVED';

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(/unknown key S-UNAPPROVED/);
  });

  it('rejects malformed machine-readable search contracts', () => {
    const registry = mutableRegistry();
    registry.searchRegistry[0].parameters = [1 as never];

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /searchRegistry\[0\]\.parameters\[0\].*non-empty string/,
    );
  });

  it('keeps CareTeam unresolved and quarantined', () => {
    const registry = mutableRegistry();
    const careTeam = registry.resourceMatrix.find(
      (resource: { resourceType: string }) => resource.resourceType === 'CareTeam',
    );
    expect(careTeam).toBeDefined();
    if (!careTeam) throw new Error('CareTeam fixture is missing');
    careTeam.nativeTarget = 'L3';

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /CareTeam.*unresolved and quarantined/,
    );
  });

  it('rejects false external capability before live routes exist', () => {
    const registry = mutableRegistry();
    registry.capability.external = 'live';

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /capability\.external.*expected none/,
    );
  });

  it('rejects a pinned package without an artifact and SHA-256', () => {
    const registry = mutableRegistry();
    registry.standards.jpCore.package.status = 'pinned';

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /pinned requires an artifact path and SHA-256/,
    );
  });

  it('rejects artifact paths that escape the repository', () => {
    const registry = mutableRegistry();
    registry.standards.jpCore.package = {
      status: 'pinned',
      artifactPath: '../../untrusted-package.tgz' as never,
      sha256: '0'.repeat(64) as never,
    };

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /expected a safe repository-relative path/,
    );
  });

  it('rejects removal of a mandatory source-manifest path', () => {
    const registry = mutableRegistry();
    registry.sourceBaseline.trackedPaths = registry.sourceBaseline.trackedPaths.filter(
      (trackedPath) => trackedPath !== 'pnpm-lock.yaml',
    );

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /must exactly match approved source coverage/,
    );
  });

  it('rejects a self-declared replacement for the approved baseline commit', () => {
    const registry = mutableRegistry();
    registry.sourceBaseline.baseCommit = '0'.repeat(40);

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /must match the approved exact SHA-1/,
    );
  });

  it('rejects drift from the approved official standard sources', () => {
    const registry = mutableRegistry();
    registry.standards.fhir.source = 'https://example.invalid/fhir/R4/';

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(
      /standards\.fhir\.source.*expected https:\/\/hl7\.org\/fhir\/R4\//,
    );
  });

  it('rejects child task dependency cycles', () => {
    const registry = mutableRegistry();
    registry.childTasks[0].dependsOn = ['A1'];

    expect(() => parseFhirNativeContractRegistry(registry)).toThrow(/dependency cycle/);
  });
});
