import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const inventory = readFileSync('tools/sql/management-plan-audit-history-inventory.sql', 'utf8');

describe('management plan audit history inventory', () => {
  it('is aggregate-only and never emits raw audit rows or identifiers', () => {
    expect(inventory).toContain('COUNT(*)');
    expect(inventory).toContain('GROUP BY "action"');
    expect(inventory).toContain('WHERE "target_type" = \'management_plan\'');
    expect(inventory).not.toMatch(/SELECT\s+\*/i);
    expect(inventory).not.toMatch(/"target_id"|"patient_id"|"actor_id"/);
    expect(inventory).not.toMatch(/SELECT[\s\S]*"changes"\s*(,|FROM)/i);
  });

  it('counts legacy before/after clinical key presence without returning values', () => {
    for (const key of ['title', 'summary', 'content']) {
      expect(inventory).toContain(`? '${key}'`);
    }
    expect(inventory).not.toMatch(/->>\s*'(title|summary|content)'/);
  });
});
