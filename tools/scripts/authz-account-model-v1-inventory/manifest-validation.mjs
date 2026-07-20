import {
  APPROVAL_STATUSES,
  assert,
  BINDING_STATES,
  CAPABILITY_STATES,
  MAPPING_DISPOSITIONS,
  readRepoFile,
  REQUIRED_BINDINGS,
  REQUIRED_BROWSER_JOURNEYS,
  REQUIRED_BROWSER_REQUIREMENTS,
  REQUIRED_CAPABILITIES,
  REQUIRED_HIGH_RISK_IDS,
  REQUIRED_LIFECYCLES,
  REQUIRED_LIVE_EVIDENCE,
  REQUIRED_MAPPING_DECISIONS,
  REQUIRED_PRINCIPALS,
  REQUIRED_PROHIBITED_OUTPUT,
  REQUIRED_SURFACES,
  stableJson,
} from './core.mjs';
import {
  exactArray,
  sourceExactValues,
  sourceRouteMethodPurpose,
  sourceTestRefs,
  validateClosedStateMap,
  validateStateProfiles,
} from './surface-discovery.mjs';

const REQUIRED_SCOPE_SOURCE_ROOTS = [
  'src',
  'prisma/schema',
  'tools/scripts',
  'tools/sql',
  '.github',
  'package.json',
  '.agent-loop/GATE_CONFIG.md',
];
const REQUIRED_SCOPE_EXCLUSIONS = [
  '(?:^|/)(?:__snapshots__|fixtures?)(?:/|$)',
  '\\.(?:test|spec)\\.[cm]?[jt]sx?$',
  '(?:^|/)tools/tests/',
  '(?:^|/)tools/scripts/(?:(?:check-authz-account-model-v1-inventory|check-human-maintained-file-size)(?:\\.mjs|\\.d\\.mts)|authz-account-model-v1-inventory/[^/]+\\.mjs)$',
];

export function validateDeclaredSurfaces(
  repoRoot,
  declarations,
  discovered,
  bindingProfiles,
  capabilityProfiles,
) {
  assert(Array.isArray(declarations), 'declared_surfaces must be an array');
  validateStateProfiles(bindingProfiles, REQUIRED_BINDINGS, BINDING_STATES, 'binding_profiles');
  validateStateProfiles(
    capabilityProfiles,
    REQUIRED_CAPABILITIES,
    CAPABILITY_STATES,
    'capability_profiles',
  );
  const identities = new Set();
  const usedBindingProfiles = new Set();
  const usedCapabilityProfiles = new Set();
  for (const entry of declarations) {
    const expectedId = `${entry.detector}:${entry.path}`;
    assert(entry.id === expectedId, 'declared surface id drift', [entry.id, expectedId]);
    assert(!identities.has(entry.id), 'duplicate declared surface', [entry.id]);
    identities.add(entry.id);
    assert(REQUIRED_PRINCIPALS.includes(entry.principal), `${entry.id} principal invalid`);
    assert(
      Array.isArray(entry.lifecycles) && entry.lifecycles.length > 0,
      `${entry.id} lifecycle missing`,
    );
    assert(
      entry.lifecycles.every((value) => REQUIRED_LIFECYCLES.includes(value)),
      `${entry.id} lifecycle invalid`,
    );
    assert(
      Array.isArray(entry.surfaces) && entry.surfaces.length > 0,
      `${entry.id} surfaces missing`,
    );
    assert(
      entry.surfaces.every((value) => REQUIRED_SURFACES.includes(value)),
      `${entry.id} surface invalid`,
    );
    assert(bindingProfiles[entry.binding_profile], `${entry.id} binding profile missing`);
    assert(capabilityProfiles[entry.capability_profile], `${entry.id} capability profile missing`);
    usedBindingProfiles.add(entry.binding_profile);
    usedCapabilityProfiles.add(entry.capability_profile);
    assert(
      Array.isArray(entry.exact_values_or_scopes) && entry.exact_values_or_scopes.length > 0,
      `${entry.id} exact values missing`,
    );
    const sourceContent = readRepoFile(repoRoot, entry.path, `${entry.id} source`);
    exactArray(
      entry.exact_values_or_scopes,
      sourceExactValues(entry.detector, entry.path, sourceContent, repoRoot),
      `${entry.id} exact values`,
    );
    assert(
      entry.route_method_purpose ===
        sourceRouteMethodPurpose(entry.path, sourceContent, entry.detector, repoRoot),
      `${entry.id} route method purpose drift`,
    );
    for (const field of [
      'route_method_purpose',
      'precedence_selection',
      'synthetic_derived_mapping',
      'persistence_contract',
      'ttl_contract',
      'mapping_disposition',
      'owner',
      'approval_status',
      'reprojection_or_removal',
    ]) {
      assert(
        typeof entry[field] === 'string' && entry[field].length > 0,
        `${entry.id} ${field} missing`,
      );
    }
    assert(
      MAPPING_DISPOSITIONS.includes(entry.mapping_disposition),
      `${entry.id} disposition invalid`,
    );
    assert(APPROVAL_STATUSES.includes(entry.approval_status), `${entry.id} approval invalid`);
    if (
      entry.exact_values_or_scopes.some(
        (value) => value.startsWith('unknown_role:') || value.includes('unknown_permission:'),
      )
    ) {
      assert(
        ['candidate_requires_human', 'deny_unmapped'].includes(entry.mapping_disposition),
        `${entry.id} unknown role or permission requires deny or human mapping`,
      );
    }
    for (const field of [
      'precedence_selection',
      'synthetic_derived_mapping',
      'persistence_contract',
      'ttl_contract',
    ]) {
      if (entry[field].startsWith('not_applicable:')) {
        assert(
          entry[field].endsWith(`:${entry.path}`),
          `${entry.id} ${field} reason is not source-specific`,
        );
      }
    }
    assert(
      entry.reprojection_or_removal === `owner_review_required_before_cutover:${entry.path}`,
      `${entry.id} reprojection/removal review marker drift`,
    );
    assert(
      Array.isArray(entry.test_refs) && entry.test_refs.length > 0,
      `${entry.id} test refs missing`,
    );
    exactArray(entry.test_refs, sourceTestRefs(repoRoot, entry.path), `${entry.id} test refs`);
  }
  exactArray(
    [...usedBindingProfiles].sort(),
    Object.keys(bindingProfiles).sort(),
    'used binding profiles',
  );
  exactArray(
    [...usedCapabilityProfiles].sort(),
    Object.keys(capabilityProfiles).sort(),
    'used capability profiles',
  );
  const declaredProjection = declarations
    .map(({ detector, path: sourcePath, evidence_sha256 }) => ({
      detector,
      path: sourcePath,
      evidence_sha256,
    }))
    .sort((left, right) =>
      `${left.detector}:${left.path}`.localeCompare(`${right.detector}:${right.path}`),
    );
  assert(
    stableJson(discovered) === stableJson(declaredProjection),
    'authorization discovery has unresolved candidates or stale declarations',
    [
      `declared_entries=${declaredProjection.length}`,
      `discovered_entries=${discovered.length}`,
      'review --print-discovery-candidates output; generation never updates declarations',
    ],
  );
}

export function validateHighRiskContracts(repoRoot, contracts) {
  assert(Array.isArray(contracts), 'high_risk_contracts must be an array');
  exactArray(
    contracts.map((entry) => entry.id).sort(),
    [...REQUIRED_HIGH_RISK_IDS].sort(),
    'high-risk contract ids',
  );
  for (const entry of contracts) {
    for (const field of [
      'owner',
      'mapping_disposition',
      'approval_status',
      'contract_version',
      'persistence_contract',
      'reprojection_or_removal',
    ]) {
      assert(
        typeof entry[field] === 'string' && entry[field].length > 0,
        `${entry.id} ${field} missing`,
      );
    }
    assert(
      MAPPING_DISPOSITIONS.includes(entry.mapping_disposition),
      `${entry.id} disposition invalid`,
    );
    assert(APPROVAL_STATUSES.includes(entry.approval_status), `${entry.id} approval invalid`);
    validateClosedStateMap(
      entry.binding_states,
      REQUIRED_BINDINGS,
      BINDING_STATES,
      `${entry.id} bindings`,
    );
    assert(
      Array.isArray(entry.source_refs) && entry.source_refs.length > 0,
      `${entry.id} source refs missing`,
    );
    assert(
      Array.isArray(entry.test_refs) && entry.test_refs.length > 0,
      `${entry.id} test refs missing`,
    );
    for (const sourcePath of [...entry.source_refs, ...entry.test_refs])
      readRepoFile(repoRoot, sourcePath, `${entry.id} source`);
  }
  const credential = contracts.find((entry) => entry.id === 'legacy-pharmacist-credential');
  assert(
    credential.qualification_authority === 'none',
    'legacy credential cannot be authoritative',
  );
  assert(credential.canonical_qualification === false, 'legacy credential cannot be canonical');
  assert(
    credential.may_authorize_clinical_action === false,
    'legacy credential cannot authorize clinical action',
  );
}

export function validateTopLevelGates(repoRoot, manifest) {
  assert(manifest.parent_phase_status === 'Partial', 'parent Phase 0 must remain Partial');
  assert(manifest.scope && typeof manifest.scope === 'object', 'inventory scope missing');
  exactArray(manifest.scope.source_roots, REQUIRED_SCOPE_SOURCE_ROOTS, 'inventory source roots');
  exactArray(
    manifest.scope.excluded_path_patterns,
    REQUIRED_SCOPE_EXCLUSIONS,
    'inventory source exclusions',
  );
  assert(
    manifest.frozen_value_sets.contract_version === 'legacy-unversioned',
    'legacy contract version drift',
  );
  const mappings = manifest.mapping_decisions
    .map((entry) => [entry.legacy, entry.target ?? null, entry.disposition])
    .sort((left, right) => left[0].localeCompare(right[0]));
  exactArray(
    mappings,
    [...REQUIRED_MAPPING_DECISIONS].sort((left, right) => left[0].localeCompare(right[0])),
    'mapping decisions',
  );

  const liveGate = manifest.live_evidence_gate;
  assert(
    liveGate.task_id === 'AUTHZ-ACCOUNT-MODEL-V1-001A-LIVE-IDENTITY-DRIFT-EVIDENCE',
    'live evidence task drift',
  );
  assert(liveGate.status === 'Human gate', 'live evidence must remain human-gated');
  exactArray(
    [...liveGate.required].sort(),
    [...REQUIRED_LIVE_EVIDENCE].sort(),
    'live evidence requirements',
  );
  exactArray(
    [...liveGate.prohibited_output].sort(),
    [...REQUIRED_PROHIBITED_OUTPUT].sort(),
    'live evidence prohibited output',
  );

  const browserGate = manifest.browser_cutover_gate;
  assert(browserGate.task_id === 'BROWSER-AUTOMATION-AGENT-BROWSER-CUTOVER', 'browser task drift');
  assert(browserGate.status === 'Not started', 'browser cutover status must remain Not started');
  assert(
    browserGate.hard_dependency_before_legacy_deletion === true,
    'browser deletion hard dependency weakened',
  );
  exactArray(
    [...browserGate.requirements].sort(),
    [...REQUIRED_BROWSER_REQUIREMENTS].sort(),
    'browser requirements',
  );
  exactArray(
    [...browserGate.required_authz_journeys].sort(),
    [...REQUIRED_BROWSER_JOURNEYS].sort(),
    'browser journeys',
  );

  const plans = readRepoFile(repoRoot, 'Plans.md');
  for (const marker of [liveGate.task_id, browserGate.task_id, ...REQUIRED_BROWSER_JOURNEYS]) {
    assert(plans.includes(marker), 'Plans browser/live gate marker missing', [marker]);
  }
  const ci = readRepoFile(repoRoot, '.github/workflows/ci.yml');
  const gateConfig = readRepoFile(repoRoot, '.agent-loop/GATE_CONFIG.md');
  assert(ci.includes('pnpm authz-account-model-v1:inventory:check'), 'CI inventory gate missing');
  assert(
    gateConfig.includes('pnpm authz-account-model-v1:inventory:check'),
    'GATE_CONFIG inventory gate missing',
  );
}
