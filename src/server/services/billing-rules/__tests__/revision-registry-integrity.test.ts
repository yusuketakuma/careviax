import { describe, expect, it } from 'vitest';
import { ALL_REVISIONS, CARE_REVISIONS, MEDICAL_REVISIONS, type RevisionEntry } from '../revisions';
import type { BillingRuleSeed } from '../types';

const RULE_TYPES = new Set(['base', 'addition', 'regional_addition', 'reduction']);
const SERVICE_TYPES = new Set(['medical_home_visit', 'care_home_management', 'generic']);
const SELECTION_MODES = new Set(['auto', 'manual']);
const CALCULATION_UNITS = new Set(['point', 'unit', 'percent']);
const PROVIDER_SCOPES = new Set(['pharmacy', 'hospital_clinic', null]);

type FlatSeed = { revisionCode: string; payerBasis: string; rule: BillingRuleSeed };

function flattenSeeds(entries: RevisionEntry[]): FlatSeed[] {
  return entries.flatMap((entry) =>
    entry.rules.map((rule) => ({
      revisionCode: entry.revision.code,
      payerBasis: rule.payer_basis,
      rule,
    })),
  );
}

const ALL_SEEDS = flattenSeeds(ALL_REVISIONS);

describe('Billing rule seed data integrity (registry-wide, all revisions)', () => {
  it('has at least one confirmed revision loaded per payer basis so the integrity checks below are not vacuous', () => {
    expect(ALL_REVISIONS.length).toBeGreaterThan(0);
    expect(ALL_SEEDS.length).toBeGreaterThan(0);
    expect(MEDICAL_REVISIONS.some((entry) => entry.rules.length > 0)).toBe(true);
    expect(CARE_REVISIONS.some((entry) => entry.rules.length > 0)).toBe(true);
  });

  it('every seed has all required string/identifier fields populated (non-empty)', () => {
    for (const { revisionCode, rule } of ALL_SEEDS) {
      const context = `${revisionCode}:${rule.ssot_key || rule.code || '(unknown)'}`;
      expect(rule.ssot_key, `ssot_key missing for ${context}`).toBeTruthy();
      expect(rule.code, `code missing for ${context}`).toBeTruthy();
      expect(rule.name, `name missing for ${context}`).toBeTruthy();
      expect(rule.source_url, `source_url missing for ${context}`).toBeTruthy();
      expect(rule.source_note, `source_note missing for ${context}`).toBeTruthy();
      expect(rule.conditions, `conditions missing for ${context}`).toBeDefined();
      expect(typeof rule.conditions, `conditions must be an object for ${context}`).toBe('object');
    }
  });

  it('every seed amount is a strictly positive, finite number (no zero/negative/NaN point values)', () => {
    for (const { revisionCode, rule } of ALL_SEEDS) {
      const context = `${revisionCode}:${rule.ssot_key}`;
      expect(typeof rule.amount, `amount must be a number for ${context}`).toBe('number');
      expect(Number.isFinite(rule.amount), `amount must be finite for ${context}`).toBe(true);
      expect(rule.amount, `amount must be > 0 for ${context}`).toBeGreaterThan(0);
    }
  });

  it('every seed uses a valid rule_type / service_type / selection_mode / calculation_unit / provider_scope enum value', () => {
    for (const { revisionCode, rule } of ALL_SEEDS) {
      const context = `${revisionCode}:${rule.ssot_key}`;
      expect(
        RULE_TYPES.has(rule.rule_type),
        `invalid rule_type for ${context}: ${rule.rule_type}`,
      ).toBe(true);
      expect(
        SERVICE_TYPES.has(rule.service_type),
        `invalid service_type for ${context}: ${rule.service_type}`,
      ).toBe(true);
      expect(
        SELECTION_MODES.has(rule.selection_mode),
        `invalid selection_mode for ${context}: ${rule.selection_mode}`,
      ).toBe(true);
      expect(
        CALCULATION_UNITS.has(rule.calculation_unit),
        `invalid calculation_unit for ${context}: ${rule.calculation_unit}`,
      ).toBe(true);
      expect(
        PROVIDER_SCOPES.has(rule.provider_scope),
        `invalid provider_scope for ${context}: ${rule.provider_scope}`,
      ).toBe(true);
      expect(
        Number.isInteger(rule.display_order) && rule.display_order >= 0,
        `display_order must be a non-negative integer for ${context}`,
      ).toBe(true);
    }
  });

  it('every seed payer_basis matches the registry it is filed under (no medical rule mis-filed under CARE_REVISIONS or vice versa)', () => {
    for (const entry of MEDICAL_REVISIONS) {
      for (const rule of entry.rules) {
        expect(
          rule.payer_basis,
          `${entry.revision.code}:${rule.ssot_key} filed under MEDICAL_REVISIONS`,
        ).toBe('medical');
      }
    }
    for (const entry of CARE_REVISIONS) {
      for (const rule of entry.rules) {
        expect(
          rule.payer_basis,
          `${entry.revision.code}:${rule.ssot_key} filed under CARE_REVISIONS`,
        ).toBe('care');
      }
    }
  });

  it('ssot_key is unique within every individual revision (including newly scaffolded, still-empty draft revisions)', () => {
    for (const entry of ALL_REVISIONS) {
      const keys = entry.rules.map((rule) => rule.ssot_key);
      expect(new Set(keys).size, `duplicate ssot_key within revision ${entry.revision.code}`).toBe(
        keys.length,
      );
    }
  });

  it('code is unique within every individual revision', () => {
    for (const entry of ALL_REVISIONS) {
      const codes = entry.rules.map((rule) => rule.code);
      expect(new Set(codes).size, `duplicate code within revision ${entry.revision.code}`).toBe(
        codes.length,
      );
    }
  });
});

describe('Billing revision metadata integrity (registry-wide)', () => {
  it('every revision (including drafts) has a non-empty code/label and a valid effectiveFrom Date', () => {
    for (const entry of ALL_REVISIONS) {
      const { revision } = entry;
      expect(revision.code, 'revision.code missing').toBeTruthy();
      expect(revision.label, `revision.label missing for ${revision.code}`).toBeTruthy();
      expect(
        revision.effectiveFrom instanceof Date && !Number.isNaN(revision.effectiveFrom.getTime()),
        `revision.effectiveFrom must be a valid Date for ${revision.code}`,
      ).toBe(true);
      if (revision.effectiveTo !== null) {
        expect(
          revision.effectiveTo instanceof Date && !Number.isNaN(revision.effectiveTo.getTime()),
          `revision.effectiveTo must be a valid Date or null for ${revision.code}`,
        ).toBe(true);
        expect(
          revision.effectiveTo.getTime(),
          `revision.effectiveTo must be after effectiveFrom for ${revision.code}`,
        ).toBeGreaterThan(revision.effectiveFrom.getTime());
      }
    }
  });

  it('every confirmed (non-draft) revision cites a non-empty official source; drafts may leave it blank until gazette confirmation', () => {
    for (const entry of ALL_REVISIONS) {
      const { revision } = entry;
      if (revision.status === 'draft') continue;
      expect(
        revision.source,
        `confirmed revision ${revision.code} must cite a source`,
      ).toBeTruthy();
    }
  });

  it.each([
    ['medical', MEDICAL_REVISIONS],
    ['care', CARE_REVISIONS],
  ])(
    'confirmed %s revisions never overlap in their effective date ranges',
    (_label, revisions: RevisionEntry[]) => {
      const confirmed = revisions
        .filter((entry) => entry.revision.status !== 'draft')
        .slice()
        .sort((a, b) => a.revision.effectiveFrom.getTime() - b.revision.effectiveFrom.getTime());

      for (let i = 0; i < confirmed.length - 1; i++) {
        const current = confirmed[i]!.revision;
        const next = confirmed[i + 1]!.revision;
        // 最新（末尾）以外の確定改定は、次の確定改定が始まる前に effectiveTo で
        // 明示的に区切られていなければならない（open-ended のまま次改定と重複しないこと）。
        expect(
          current.effectiveTo,
          `confirmed revision ${current.code} must have a bounded effectiveTo once a later confirmed revision (${next.code}) exists`,
        ).not.toBeNull();
        expect(
          current.effectiveTo!.getTime(),
          `confirmed revisions ${current.code} and ${next.code} overlap`,
        ).toBeLessThan(next.effectiveFrom.getTime());
      }
    },
  );

  it('ALL_REVISIONS is exactly the union of MEDICAL_REVISIONS and CARE_REVISIONS (no registry silently dropped)', () => {
    const expectedCodes = [...MEDICAL_REVISIONS, ...CARE_REVISIONS]
      .map((entry) => `${entry.revision.code}:${entry.rules.length}`)
      .sort();
    const actualCodes = ALL_REVISIONS.map(
      (entry) => `${entry.revision.code}:${entry.rules.length}`,
    ).sort();
    expect(actualCodes).toEqual(expectedCodes);
  });
});
