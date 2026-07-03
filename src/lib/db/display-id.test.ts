import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DISPLAY_ID_EXCLUDED_MODELS,
  DISPLAY_ID_GLOBAL_ORG_ID,
  DISPLAY_ID_INFRASTRUCTURE_MODELS,
  DISPLAY_ID_PATTERN,
  DISPLAY_ID_REGISTRY,
  RESERVED_DISPLAY_ID_PREFIXES,
  allocateDisplayId,
  allocateDisplayIdRange,
  allocateGlobalDisplayId,
  displayIdSchema,
  formatDisplayId,
  getDisplayIdModelForPrefix,
  getDisplayIdRegistryEntry,
  parseDisplayId,
  type DisplayIdModel,
} from './display-id';

const SCHEMA_DIR = 'prisma/schema';
const PATIENT_DISPLAY_ID_W1_MIGRATION =
  'prisma/migrations/20260703150000_add_patient_display_ids/migration.sql';
const PRESCRIPTION_DISPLAY_ID_W2_MIGRATION =
  'prisma/migrations/20260703152000_add_prescription_display_ids/migration.sql';
const VISIT_COMMUNICATION_DISPLAY_ID_W3_MIGRATION =
  'prisma/migrations/20260703153000_add_visit_communication_display_ids/migration.sql';
const ORGANIZATION_DISPLAY_ID_W4_MIGRATION =
  'prisma/migrations/20260703154000_add_organization_display_ids/migration.sql';
const PHARMACY_PARTNERSHIP_DISPLAY_ID_W5_MIGRATION =
  'prisma/migrations/20260703155000_add_pharmacy_partnership_display_ids/migration.sql';
const ADMIN_DRUG_DISPLAY_ID_W6_MIGRATION =
  'prisma/migrations/20260703160000_add_admin_drug_display_ids/migration.sql';
const RESIDUAL_DISPLAY_ID_W7_MIGRATION =
  'prisma/migrations/20260703161000_add_residual_display_ids/migration.sql';
const PATIENT_DISPLAY_ID_W1_MODELS = [
  'Patient',
  'Residence',
  'CareCase',
  'ContactParty',
  'CareTeamLink',
  'PatientCondition',
  'ConsentRecord',
  'ManagementPlan',
  'PatientSchedulePreference',
  'PatientPackagingProfile',
  'PatientMcsLink',
  'PatientMcsSummary',
  'PatientInsurance',
  'PatientLabObservation',
  'PatientMcsMessage',
  'PatientFieldRevision',
  'PatientMedicalProcedure',
  'PatientNarcoticUse',
] as const satisfies readonly DisplayIdModel[];
const PRESCRIPTION_DISPLAY_ID_W2_MODELS = [
  'MedicationCycle',
  'CycleTransitionLog',
  'PrescriptionIntake',
  'PrescriptionLine',
  'InquiryRecord',
  'DispenseTask',
  'DispenseResult',
  'DispenseAudit',
  'DispensingDecision',
  'SetPlan',
  'SetBatch',
  'SetAudit',
  'SetBatchChangeLog',
  'PackagingGroup',
  'CycleHold',
  'WorkflowException',
  'QrScanDraft',
  'JahisSupplementalRecord',
] as const satisfies readonly DisplayIdModel[];
const VISIT_DISPLAY_ID_W3_MODELS = [
  'VisitVehicleResource',
  'VisitSchedule',
  'FacilityVisitBatch',
  'VisitRecord',
  'VisitHandoffExtraction',
  'VisitPreparation',
  'VisitScheduleProposal',
  'VisitScheduleProposalBatch',
  'VisitScheduleContactLog',
  'VisitScheduleOverride',
] as const satisfies readonly DisplayIdModel[];
const COMMUNICATION_DISPLAY_ID_W3_MODELS = [
  'CommunicationEvent',
  'CommunicationRequest',
  'CommunicationResponse',
  'CareReport',
  'CareReportSendRequest',
  'DeliveryRecord',
  'ConferenceNote',
  'EscalationRule',
  'ExternalAccessGrant',
  'TracingReport',
  'PatientSelfReport',
  'CommunityActivity',
  'TaskComment',
  'HandoffBoard',
] as const satisfies readonly DisplayIdModel[];
const ORGANIZATION_DISPLAY_ID_W4_MODELS = [
  'PharmacySite',
  'ServiceArea',
  'PharmacySiteInsuranceConfig',
  'Membership',
  'FacilityStandardRegistration',
  'PharmacistCredential',
  'PharmacistShift',
  'PharmacistShiftTemplate',
  'BusinessHoliday',
  'PharmacyOperatingHours',
  'Facility',
  'FacilityUnit',
  'FacilityContact',
  'ExternalProfessional',
  'PrescriberInstitution',
] as const satisfies readonly DisplayIdModel[];
const PHARMACY_PARTNERSHIP_DISPLAY_ID_W5_MODELS = [
  'PartnerPharmacy',
  'PharmacyPartnership',
  'PatientShareCase',
  'PatientShareConsent',
  'PatientLink',
  'PatientShareCorrectionRequest',
  'PharmacyVisitRequest',
  'PharmacyCooperationMessageThread',
  'PharmacyCooperationMessage',
  'PartnerVisitRecord',
  'ClaimCooperationNote',
  'PharmacyContract',
  'PharmacyContractVersion',
  'PharmacyContractFeeRule',
  'VisitBillingCandidate',
  'PharmacyInvoice',
  'PharmacyInvoiceItem',
  'ContractDocument',
] as const satisfies readonly DisplayIdModel[];
const ADMIN_DISPLAY_ID_W6_MODELS = [
  'NotificationRule',
  'BillingRule',
  'BillingCandidate',
  'BillingEvidence',
  'Notification',
  'AuditLog',
  'Template',
  'DocumentDeliveryRule',
  'FileAsset',
  'UatFeedback',
  'SourceOfTruthMatrix',
  'PushSubscription',
  'WebhookRegistration',
  'WebhookDelivery',
  'IncidentReport',
] as const satisfies readonly DisplayIdModel[];
const DRUG_DISPLAY_ID_W6_MODELS = [
  'PharmacyDrugStock',
  'FormularyChangeRequest',
  'FormularyTemplate',
] as const satisfies readonly DisplayIdModel[];
const MEDICATION_DISPLAY_ID_W7_MODELS = [
  'FirstVisitDocument',
  'Intervention',
  'MedicationIssue',
  'MedicationProfile',
  'PackagingMethodMaster',
  'ResidualMedication',
] as const satisfies readonly DisplayIdModel[];
const PCA_PUMP_DISPLAY_ID_W7_MODELS = [
  'PcaPump',
  'PcaPumpMaintenanceEvent',
  'PcaPumpRental',
  'PcaPumpRentalAccessory',
] as const satisfies readonly DisplayIdModel[];
const CORE_TASK_DISPLAY_ID_W7_MODELS = ['Task'] as const satisfies readonly DisplayIdModel[];
const SAVED_VIEW_DISPLAY_ID_W7_MODELS = ['SavedView'] as const satisfies readonly DisplayIdModel[];
const PARENT_SCOPED_DISPLAY_ID_W7_MODELS = [
  'HandoffItem',
] as const satisfies readonly DisplayIdModel[];
// Permanent defer: nullable/hybrid org_id requires explicit tenant-vs-global semantics.
const PERMANENT_DEFERRED_DISPLAY_ID_SCHEMA_MODELS = [
  'DrugAlertRule',
  'IntegrationJob',
] as const satisfies readonly DisplayIdModel[];
// Temporary defer should stay empty after W7 consumes the direct-org and parent-scoped residuals.
const TEMPORARY_DEFERRED_DISPLAY_ID_SCHEMA_MODELS = [] as const satisfies readonly DisplayIdModel[];
const DEFERRED_DISPLAY_ID_SCHEMA_MODELS = [
  ...PERMANENT_DEFERRED_DISPLAY_ID_SCHEMA_MODELS,
  ...TEMPORARY_DEFERRED_DISPLAY_ID_SCHEMA_MODELS,
] as const satisfies readonly DisplayIdModel[];
const DISPLAY_ID_SCHEMA_WAVES = [
  {
    label: 'W1 patient-domain',
    schemaFile: 'patient.prisma',
    migrationPath: PATIENT_DISPLAY_ID_W1_MIGRATION,
    models: PATIENT_DISPLAY_ID_W1_MODELS,
  },
  {
    label: 'W2 prescription-domain',
    schemaFile: 'prescription.prisma',
    migrationPath: PRESCRIPTION_DISPLAY_ID_W2_MIGRATION,
    models: PRESCRIPTION_DISPLAY_ID_W2_MODELS,
  },
  {
    label: 'W3 visit-domain',
    schemaFile: 'visit.prisma',
    migrationPath: VISIT_COMMUNICATION_DISPLAY_ID_W3_MIGRATION,
    models: VISIT_DISPLAY_ID_W3_MODELS,
  },
  {
    label: 'W3 communication-domain',
    schemaFile: 'communication.prisma',
    migrationPath: VISIT_COMMUNICATION_DISPLAY_ID_W3_MIGRATION,
    models: COMMUNICATION_DISPLAY_ID_W3_MODELS,
  },
  {
    label: 'W4 organization-domain',
    schemaFile: 'organization.prisma',
    migrationPath: ORGANIZATION_DISPLAY_ID_W4_MIGRATION,
    models: ORGANIZATION_DISPLAY_ID_W4_MODELS,
  },
  {
    label: 'W5 pharmacy-partnership-domain',
    schemaFile: 'pharmacy-partnership.prisma',
    migrationPath: PHARMACY_PARTNERSHIP_DISPLAY_ID_W5_MIGRATION,
    models: PHARMACY_PARTNERSHIP_DISPLAY_ID_W5_MODELS,
  },
  {
    label: 'W6 admin-domain',
    schemaFile: 'admin.prisma',
    migrationPath: ADMIN_DRUG_DISPLAY_ID_W6_MIGRATION,
    models: ADMIN_DISPLAY_ID_W6_MODELS,
  },
  {
    label: 'W6 drug-domain',
    schemaFile: 'drug.prisma',
    migrationPath: ADMIN_DRUG_DISPLAY_ID_W6_MIGRATION,
    models: DRUG_DISPLAY_ID_W6_MODELS,
  },
  {
    label: 'W7 medication-domain',
    schemaFile: 'medication.prisma',
    migrationPath: RESIDUAL_DISPLAY_ID_W7_MIGRATION,
    models: MEDICATION_DISPLAY_ID_W7_MODELS,
  },
  {
    label: 'W7 pca-pump-domain',
    schemaFile: 'pca-pump.prisma',
    migrationPath: RESIDUAL_DISPLAY_ID_W7_MIGRATION,
    models: PCA_PUMP_DISPLAY_ID_W7_MODELS,
  },
  {
    label: 'W7 core-task-domain',
    schemaFile: 'core-task.prisma',
    migrationPath: RESIDUAL_DISPLAY_ID_W7_MIGRATION,
    models: CORE_TASK_DISPLAY_ID_W7_MODELS,
  },
  {
    label: 'W7 saved-view-domain',
    schemaFile: 'saved-view.prisma',
    migrationPath: RESIDUAL_DISPLAY_ID_W7_MIGRATION,
    models: SAVED_VIEW_DISPLAY_ID_W7_MODELS,
  },
] as const;
const DISPLAY_ID_PARENT_SCOPED_SCHEMA_WAVES = [
  {
    label: 'W7 handoff-item-parent-domain',
    schemaFile: 'communication.prisma',
    migrationPath: RESIDUAL_DISPLAY_ID_W7_MIGRATION,
    models: PARENT_SCOPED_DISPLAY_ID_W7_MODELS,
  },
] as const;
const DISPLAY_ID_DIRECT_WAVE_MODELS = DISPLAY_ID_SCHEMA_WAVES.flatMap((wave) => wave.models);
const DISPLAY_ID_PARENT_SCOPED_WAVE_MODELS = DISPLAY_ID_PARENT_SCOPED_SCHEMA_WAVES.flatMap(
  (wave) => wave.models,
);
const DISPLAY_ID_WAVE_MODELS = [
  ...DISPLAY_ID_DIRECT_WAVE_MODELS,
  ...DISPLAY_ID_PARENT_SCOPED_WAVE_MODELS,
];
const DISPLAY_ID_SCHEMA_DEFERRED_MODELS = [...DEFERRED_DISPLAY_ID_SCHEMA_MODELS];
const RUN_ID = randomUUID().replaceAll('-', '').slice(0, 12);
const databaseUrl = process.env.DISPLAY_ID_DATABASE_URL ?? process.env.DATABASE_URL;
const shouldRunDbTests =
  Boolean(databaseUrl) && /localhost:5433\/ph_os_e2e(?:\?|$)/.test(databaseUrl ?? '');
const describeDb = shouldRunDbTests ? describe : describe.skip;

type SequenceRow = { next_value: bigint };
type DisplayIdIndexRow = {
  indexName: string;
  tableName: string;
  isUnique: boolean;
  predicate: string | null;
  indexDef: string;
};

function readSchemaModels(): string[] {
  const modelNames: string[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{/gm;
  for (const fileName of readdirSync(SCHEMA_DIR).filter((file) => file.endsWith('.prisma'))) {
    const text = readFileSync(join(SCHEMA_DIR, fileName), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = modelPattern.exec(text)) !== null) {
      if (match[1]) modelNames.push(match[1]);
    }
  }
  return modelNames.sort();
}

function readModelBlock(schema: string, model: string): string {
  const match = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`Missing Prisma model block: ${model}`);
  return match[0];
}

function readModelNames(schema: string): string[] {
  const modelNames: string[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = modelPattern.exec(schema)) !== null) {
    if (match[1]) modelNames.push(match[1]);
  }
  return modelNames;
}

function collectDirectOrgScopedModels(schema: string): string[] {
  return readModelNames(schema)
    .filter((model) => {
      const block = readModelBlock(schema, model);
      return (
        /\n\s+org_id\s+String(?:\s|$)/.test(block) &&
        /\n\s+created_at\s+DateTime(?:\s|$)/.test(block) &&
        block.includes('@@unique([id, org_id])')
      );
    })
    .sort();
}

function collectNonNullableOrgScopedModels(schema: string): string[] {
  return readModelNames(schema)
    .filter((model) => {
      const block = readModelBlock(schema, model);
      return (
        /\n\s+org_id\s+String(?:\s|$)/.test(block) &&
        /\n\s+created_at\s+DateTime(?:\s|$)/.test(block)
      );
    })
    .sort();
}

function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(path).forEach((file) => files.push(file));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

function orgId(suffix: string): string {
  return `dispid${RUN_ID}${suffix}`;
}

function parseSequence(id: string): bigint {
  const parsed = parseDisplayId(id);
  if (!parsed) throw new Error(`Expected parseable display_id: ${id}`);
  return parsed.sequence;
}

describe('display_id registry and format contract', () => {
  it('covers every Prisma model through registry, explicit business exclusion, or infrastructure exclusion', () => {
    const schemaModels = readSchemaModels();
    expect(schemaModels).toHaveLength(140);
    expect(Object.keys(DISPLAY_ID_REGISTRY)).toHaveLength(138);
    expect(DISPLAY_ID_EXCLUDED_MODELS).toEqual(['Setting']);
    expect(DISPLAY_ID_INFRASTRUCTURE_MODELS).toEqual(['IdSequence']);

    const covered = new Set([
      ...Object.keys(DISPLAY_ID_REGISTRY),
      ...DISPLAY_ID_EXCLUDED_MODELS,
      ...DISPLAY_ID_INFRASTRUCTURE_MODELS,
    ]);
    expect(schemaModels.filter((model) => !covered.has(model))).toEqual([]);
    expect([...covered].filter((model) => !schemaModels.includes(model))).toEqual([]);
  });

  it('keeps the ratified prefix registry unique, lower-case, and scoped as designed', () => {
    const entries = Object.entries(DISPLAY_ID_REGISTRY);
    const prefixes = entries.map(([, entry]) => entry.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(prefixes).toHaveLength(138);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z]{1,6}$/);
    }
    expect(RESERVED_DISPLAY_ID_PREFIXES).toEqual(['cfg']);
    expect(prefixes).not.toContain('cfg');

    const scopeCounts = entries.reduce<Record<string, number>>((counts, [, entry]) => {
      counts[entry.scope] = (counts[entry.scope] ?? 0) + 1;
      return counts;
    }, {});
    expect(scopeCounts).toEqual({ global: 12, org: 125, orgViaParent: 1 });

    expect(
      entries
        .filter(([, entry]) => entry.scope === 'global')
        .map(([model]) => model)
        .sort(),
    ).toEqual([
      'BreakGlassSession',
      'DrugInteraction',
      'DrugMaster',
      'DrugMasterChangeEvent',
      'DrugMasterImportLog',
      'DrugPackage',
      'DrugPackageInsert',
      'GenericDrugMapping',
      'LabelDictionary',
      'Organization',
      'PlatformOperator',
      'User',
    ]);
    expect(getDisplayIdRegistryEntry('HandoffItem')).toEqual({
      prefix: 'h',
      scope: 'orgViaParent',
      parent: 'HandoffBoard',
    });
  });

  it('formats, validates, and parses display IDs with the canonical regex', () => {
    expect(DISPLAY_ID_PATTERN).toEqual(/^[a-z]{1,6}[0-9]{10,15}$/);
    expect(formatDisplayId('Patient', BigInt(1))).toBe('p0000000001');
    expect(formatDisplayId('DrugMaster', BigInt(1))).toBe('drug0000000001');
    expect(formatDisplayId('Patient', BigInt('10000000000'))).toBe('p10000000000');
    expect(displayIdSchema.safeParse('p0000000001').success).toBe(true);
    expect(displayIdSchema.safeParse('drug0000000001').success).toBe(true);
    expect(displayIdSchema.safeParse('p999999999999999').success).toBe(true);

    expect(parseDisplayId('p0000000042')).toEqual({
      raw: 'p0000000042',
      model: 'Patient',
      prefix: 'p',
      sequence: BigInt(42),
    });
    expect(getDisplayIdModelForPrefix('drug')).toBe('DrugMaster');
  });

  it.each([
    'P0000000001',
    'p000000001',
    'p00000000001x',
    'ppppppp0000000001',
    'p０００００００００１',
    'cfg0000000001',
    'zzzzz0000000001',
    'p0000000000',
  ])('rejects malformed or unassigned display ID %s', (value) => {
    expect(displayIdSchema.safeParse(value).success).toBe(false);
    expect(parseDisplayId(value)).toBeNull();
  });

  it('rejects invalid formatter inputs before they can be allocated or displayed', () => {
    expect(() => formatDisplayId('Patient', BigInt(0))).toThrow(/positive/);
    expect(() => formatDisplayId('Patient', BigInt(-1))).toThrow(/positive/);
    expect(() => formatDisplayId('Patient', BigInt('1000000000000000'))).toThrow(/15 digits/);
    expect(() => formatDisplayId('Setting' as never, BigInt(1))).toThrow(/Unknown/);
  });

  it('forbids direct IdSequence access outside the allocator module', () => {
    const allowedFiles = new Set([
      join('src', 'lib', 'db', 'display-id.ts'),
      join('src', 'lib', 'db', 'display-id.test.ts'),
      join('src', 'lib', 'db', 'display-id-spike.test.ts'),
    ]);
    const offenders = collectSourceFiles('src').flatMap((file) => {
      if (allowedFiles.has(file) || /\.test\.(ts|tsx)$/.test(file)) return [];
      const text = readFileSync(file, 'utf8');
      const directDelegate =
        /\b(?:prisma|tx|client)\s*(?:\.\s*idSequence|\[\s*['"`]idSequence['"`]\s*\])/;
      const rawSql = /\bid_sequence\b/;
      return directDelegate.test(text) || rawSql.test(text) ? [file] : [];
    });
    expect(offenders).toEqual([]);
  });

  it('declares display ID migration waves as nullable tenant-local identifiers', () => {
    for (const wave of DISPLAY_ID_SCHEMA_WAVES) {
      const schema = readFileSync(join(SCHEMA_DIR, wave.schemaFile), 'utf8');
      const migration = readFileSync(wave.migrationPath, 'utf8');

      for (const model of wave.models) {
        expect(getDisplayIdRegistryEntry(model).scope, `${wave.label}:${model}`).toBe('org');

        const block = readModelBlock(schema, model);
        expect(block, `${wave.label}:${model}`).toMatch(/\n\s+org_id\s+String(?:\s|$)/);
        expect(block, `${wave.label}:${model}`).toMatch(/\n\s+created_at\s+DateTime(?:\s|$)/);
        expect(block, `${wave.label}:${model}`).toMatch(/\n\s+display_id\s+String\?(?:\s|$)/);
        expect(block, `${wave.label}:${model}`).not.toMatch(/\n\s+display_id\s+String\b(?!\?)/);
        expect(block, `${wave.label}:${model}`).toContain('@@unique([org_id, display_id])');

        expect(migration, `${wave.label}:${model}`).toContain(
          `ALTER TABLE "${model}" ADD COLUMN "display_id" TEXT;`,
        );
        expect(migration, `${wave.label}:${model}`).toContain(
          `CREATE UNIQUE INDEX "${model}_org_id_display_id_key" ON "${model}"("org_id", "display_id") WHERE "display_id" IS NOT NULL;`,
        );
        expect(migration, `${wave.label}:${model}`).not.toContain(
          `ALTER TABLE "${model}" ALTER COLUMN "display_id" SET NOT NULL`,
        );
        expect(migration, `${wave.label}:${model}`).not.toContain(
          `ON "${model}"("display_id") WHERE "display_id" IS NOT NULL`,
        );
      }

      expect(migration, wave.label).not.toMatch(/\bDROP\b/i);
      expect(migration, wave.label).not.toMatch(/\bALTER COLUMN\b/i);
    }
  });

  it('declares HandoffItem as nullable parent-scoped without unsafe org_id uniqueness', () => {
    const wave = DISPLAY_ID_PARENT_SCOPED_SCHEMA_WAVES[0];
    const schema = readFileSync(join(SCHEMA_DIR, wave.schemaFile), 'utf8');
    const migration = readFileSync(wave.migrationPath, 'utf8');
    const block = readModelBlock(schema, 'HandoffItem');

    expect(getDisplayIdRegistryEntry('HandoffItem')).toEqual({
      prefix: 'h',
      scope: 'orgViaParent',
      parent: 'HandoffBoard',
    });
    expect(block).not.toMatch(/\n\s+org_id\s+String(?:\s|$)/);
    expect(block).toMatch(/\n\s+board_id\s+String(?:\s|$)/);
    expect(block).toMatch(/\n\s+display_id\s+String\?(?:\s|$)/);
    expect(block).toContain('@@index([display_id])');
    expect(block).not.toContain('@@unique([org_id, display_id])');
    expect(block).not.toContain('@unique');
    expect(migration).toContain('ALTER TABLE "HandoffItem" ADD COLUMN "display_id" TEXT;');
    expect(migration).toContain(
      'CREATE INDEX "HandoffItem_display_id_idx" ON "HandoffItem"("display_id") WHERE "display_id" IS NOT NULL;',
    );
    expect(migration).not.toContain('"HandoffItem_org_id_display_id_key"');
    expect(migration).not.toContain('CREATE UNIQUE INDEX "HandoffItem');
  });

  it('keeps the W5 pharmacy-partnership wave aligned with direct org-scoped models', () => {
    const schema = readFileSync(join(SCHEMA_DIR, 'pharmacy-partnership.prisma'), 'utf8');
    expect(collectDirectOrgScopedModels(schema)).toEqual(
      [...PHARMACY_PARTNERSHIP_DISPLAY_ID_W5_MODELS].sort(),
    );
  });

  it('keeps the W6 admin and drug waves aligned with non-null direct org-scoped models', () => {
    const adminSchema = readFileSync(join(SCHEMA_DIR, 'admin.prisma'), 'utf8');
    const drugSchema = readFileSync(join(SCHEMA_DIR, 'drug.prisma'), 'utf8');

    expect(collectNonNullableOrgScopedModels(adminSchema)).toEqual(
      [...ADMIN_DISPLAY_ID_W6_MODELS].sort(),
    );
    expect(collectNonNullableOrgScopedModels(drugSchema)).toEqual(
      [...DRUG_DISPLAY_ID_W6_MODELS].sort(),
    );
  });

  it('keeps the W7 residual direct-org waves aligned with non-null direct org-scoped models', () => {
    expect(
      collectNonNullableOrgScopedModels(
        readFileSync(join(SCHEMA_DIR, 'medication.prisma'), 'utf8'),
      ),
    ).toEqual([...MEDICATION_DISPLAY_ID_W7_MODELS].sort());
    expect(
      collectNonNullableOrgScopedModels(readFileSync(join(SCHEMA_DIR, 'pca-pump.prisma'), 'utf8')),
    ).toEqual([...PCA_PUMP_DISPLAY_ID_W7_MODELS].sort());
    expect(
      collectNonNullableOrgScopedModels(readFileSync(join(SCHEMA_DIR, 'core-task.prisma'), 'utf8')),
    ).toEqual([...CORE_TASK_DISPLAY_ID_W7_MODELS].sort());
    expect(
      collectNonNullableOrgScopedModels(
        readFileSync(join(SCHEMA_DIR, 'saved-view.prisma'), 'utf8'),
      ),
    ).toEqual([...SAVED_VIEW_DISPLAY_ID_W7_MODELS].sort());
  });

  it('leaves only permanent nullable-org models deferred after W7', () => {
    expect(TEMPORARY_DEFERRED_DISPLAY_ID_SCHEMA_MODELS).toEqual([]);
    expect(PERMANENT_DEFERRED_DISPLAY_ID_SCHEMA_MODELS).toEqual([
      'DrugAlertRule',
      'IntegrationJob',
    ]);
    expect(DISPLAY_ID_SCHEMA_DEFERRED_MODELS).toEqual(['DrugAlertRule', 'IntegrationJob']);
  });

  it('assigns every tenant-scoped registry model to a wave or explicit deferred list', () => {
    const tenantScopedRegistryModels = Object.entries(DISPLAY_ID_REGISTRY)
      .filter(([, entry]) => entry.scope === 'org' || entry.scope === 'orgViaParent')
      .map(([model]) => model as DisplayIdModel)
      .sort();
    const waveModelSet = new Set<DisplayIdModel>(DISPLAY_ID_WAVE_MODELS);
    const deferredModelSet = new Set<DisplayIdModel>(DISPLAY_ID_SCHEMA_DEFERRED_MODELS);
    const coveredModelSet = new Set<DisplayIdModel>([
      ...DISPLAY_ID_WAVE_MODELS,
      ...DISPLAY_ID_SCHEMA_DEFERRED_MODELS,
    ]);

    expect(DISPLAY_ID_WAVE_MODELS.filter((model) => deferredModelSet.has(model))).toEqual([]);
    expect(DISPLAY_ID_SCHEMA_DEFERRED_MODELS.filter((model) => waveModelSet.has(model))).toEqual(
      [],
    );
    expect([...waveModelSet]).toHaveLength(DISPLAY_ID_WAVE_MODELS.length);
    expect([...deferredModelSet]).toHaveLength(DISPLAY_ID_SCHEMA_DEFERRED_MODELS.length);
    expect(tenantScopedRegistryModels.filter((model) => !coveredModelSet.has(model))).toEqual([]);
    expect(
      [...coveredModelSet].filter(
        (model) =>
          !tenantScopedRegistryModels.includes(model) &&
          getDisplayIdRegistryEntry(model).scope !== 'global',
      ),
    ).toEqual([]);
  });
});

describeDb('display_id allocator integration (local e2e DB)', () => {
  let prisma: PrismaClient;

  async function cleanTestSequences() {
    await prisma.$executeRaw`
      DELETE FROM id_sequence
      WHERE (org_id LIKE ${`dispid${RUN_ID}%`})
         OR (org_id = ${DISPLAY_ID_GLOBAL_ORG_ID} AND prefix IN ('bg', 'drug'))
    `;
  }

  async function readSequence(org: string, prefix: string): Promise<bigint | null> {
    const rows = await prisma.$queryRaw<SequenceRow[]>`
      SELECT next_value
      FROM id_sequence
      WHERE org_id = ${org} AND prefix = ${prefix}
    `;
    return rows[0]?.next_value ?? null;
  }

  beforeAll(async () => {
    if (!databaseUrl) throw new Error('DISPLAY_ID_DATABASE_URL or DATABASE_URL is required');
    const adapter = new PrismaPg({ connectionString: databaseUrl, max: 10 });
    prisma = new PrismaClient({ adapter });
  });

  beforeEach(async () => {
    await cleanTestSequences();
  });

  afterEach(async () => {
    await cleanTestSequences();
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it('allocates first and range IDs inside the caller transaction', async () => {
    const org = orgId('range');

    const first = await prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', org));
    const nextRange = await prisma.$transaction((tx) =>
      allocateDisplayIdRange(tx, 'Patient', org, 3),
    );

    expect(first).toBe('p0000000001');
    expect(nextRange).toEqual(['p0000000002', 'p0000000003', 'p0000000004']);
    await expect(readSequence(org, 'p')).resolves.toBe(BigInt(5));
  });

  it('keeps migration-wave uniqueness backed by partial DB indexes', async () => {
    const rows = await prisma.$queryRaw<DisplayIdIndexRow[]>`
      SELECT
        index_class.relname AS "indexName",
        table_class.relname AS "tableName",
        pg_index.indisunique AS "isUnique",
        pg_get_expr(pg_index.indpred, pg_index.indrelid) AS "predicate",
        pg_get_indexdef(pg_index.indexrelid) AS "indexDef"
      FROM pg_index
      INNER JOIN pg_class index_class
        ON index_class.oid = pg_index.indexrelid
      INNER JOIN pg_class table_class
        ON table_class.oid = pg_index.indrelid
      INNER JOIN pg_namespace namespace
        ON namespace.oid = table_class.relnamespace
      WHERE namespace.nspname = 'public'
        AND index_class.relname LIKE '%_org_id_display_id_key'
    `;
    const byIndexName = new Map(rows.map((row) => [row.indexName, row]));

    for (const model of DISPLAY_ID_DIRECT_WAVE_MODELS) {
      const row = byIndexName.get(`${model}_org_id_display_id_key`);
      expect(row, model).toMatchObject({
        tableName: model,
        isUnique: true,
        predicate: '(display_id IS NOT NULL)',
      });
      expect(row?.indexDef, model).toContain('CREATE UNIQUE INDEX');
      expect(row?.indexDef, model).toContain(`ON public."${model}"`);
      expect(row?.indexDef, model).toContain('(org_id, display_id)');
    }
  });

  it('rolls back sequence allocation with the caller transaction', async () => {
    const org = orgId('rollback');
    const rollback = new Error('intentional display_id rollback');

    await expect(
      prisma.$transaction(async (tx) => {
        await allocateDisplayId(tx, 'Patient', org);
        throw rollback;
      }),
    ).rejects.toBe(rollback);

    await expect(readSequence(org, 'p')).resolves.toBeNull();
  });

  it('serializes concurrent allocations for one org and prefix without duplicates or gaps', async () => {
    const org = orgId('concurrent');

    const ids = await Promise.all(
      Array.from({ length: 20 }, () =>
        prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', org)),
      ),
    );

    expect(new Set(ids).size).toBe(20);
    expect(ids.map(parseSequence).sort((a, b) => Number(a - b))).toEqual(
      Array.from({ length: 20 }, (_, index) => BigInt(index + 1)),
    );
    await expect(readSequence(org, 'p')).resolves.toBe(BigInt(21));
  });

  it('keeps tenant-scoped counters separated by org', async () => {
    const orgA = orgId('tenanta');
    const orgB = orgId('tenantb');

    const [a1, b1, a2] = await Promise.all([
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', orgA)),
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', orgB)),
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', orgA)),
    ]);

    expect([a1, a2].sort()).toEqual(['p0000000001', 'p0000000002']);
    expect(b1).toBe('p0000000001');
    await expect(readSequence(orgA, 'p')).resolves.toBe(BigInt(3));
    await expect(readSequence(orgB, 'p')).resolves.toBe(BigInt(2));
  });

  it('requires explicit global allocation and rejects sentinel misuse', async () => {
    await expect(
      prisma.$transaction((tx) => allocateDisplayId(tx, 'Patient', DISPLAY_ID_GLOBAL_ORG_ID)),
    ).rejects.toThrow(/global sentinel/);
    await expect(
      prisma.$transaction((tx) => allocateDisplayId(tx, 'DrugMaster', orgId('bad'))),
    ).rejects.toThrow(/allocateGlobalDisplayId/);
    await expect(allocateGlobalDisplayId(prisma, 'Patient')).rejects.toThrow(/tenant-scoped/);

    await expect(allocateGlobalDisplayId(prisma, 'DrugMaster')).resolves.toBe('drug0000000001');
    await expect(readSequence(DISPLAY_ID_GLOBAL_ORG_ID, 'drug')).resolves.toBe(BigInt(2));
  });
});
