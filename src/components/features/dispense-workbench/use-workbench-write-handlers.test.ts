import { describe, expect, it } from 'vitest';

import { SET_AUDIT_CHECK_ITEMS } from './dispensing-workbench.write-types';
import { collectSetAuditChecklistFromChecks } from './use-workbench-write-handlers';

describe('collectSetAuditChecklistFromChecks', () => {
  it('maps the visible set-audit checklist order to the API checklist keys', () => {
    const prefix = 'patient_1:0:朝';
    const checks = Object.fromEntries(
      SET_AUDIT_CHECK_ITEMS.map((_, index) => [`${prefix}:${index}`, true]),
    );

    expect(collectSetAuditChecklistFromChecks(checks)).toEqual({
      date_match: true,
      timing_match: true,
      quantity_match: true,
      no_discontinued: true,
      residual_usage_ok: true,
      cold_storage_separated: true,
    });
  });

  it('does not mark unrelated or unchecked checklist items as complete', () => {
    const prefix = 'patient_1:0:朝';

    expect(
      collectSetAuditChecklistFromChecks({
        [`${prefix}:0`]: true,
        [`${prefix}:1`]: false,
        [`${prefix}:2`]: true,
        'patient_2:0:朝:3': true,
      }),
    ).toEqual({
      date_match: true,
      timing_match: false,
      quantity_match: true,
      no_discontinued: false,
      residual_usage_ok: false,
      cold_storage_separated: false,
    });
  });
});
