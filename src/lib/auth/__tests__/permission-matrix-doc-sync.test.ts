import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hasPermission, MEMBER_ROLES, PERMISSION_KEYS } from '../permission-matrix';

type CapabilityDocRow = {
  capability: string;
  values: string[];
};

function cellsOf(line: string) {
  return line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim());
}

function readDocumentedCapabilityMatrix(): {
  headers: string[];
  rows: CapabilityDocRow[];
} {
  const markdown = readFileSync(
    join(process.cwd(), 'docs/compliance/access-control-policy.md'),
    'utf8',
  );
  const lines = markdown.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.startsWith('| Capability '));
  if (headerIndex < 0) throw new Error('Capability matrix header is missing');

  const rows: CapabilityDocRow[] = [];
  for (const line of lines.slice(headerIndex + 2)) {
    if (!line.startsWith('|')) break;
    const [label, ...values] = cellsOf(line);
    const capability = /`([^`]+)`/.exec(label ?? '')?.[1];
    if (!capability) throw new Error(`Capability key is missing from row: ${label ?? ''}`);
    rows.push({ capability, values });
  }

  return { headers: cellsOf(lines[headerIndex]!), rows };
}

function documentedPermission(value: string) {
  if (value === '✅') return true;
  if (value === '—') return false;
  throw new Error(`Unknown capability matrix value: ${value}`);
}

describe('permission capability documentation', () => {
  it('matches every runtime role and capability without missing or extra entries', () => {
    const matrix = readDocumentedCapabilityMatrix();

    expect(matrix.headers).toEqual(['Capability', ...MEMBER_ROLES]);
    expect(matrix.rows.map((row) => row.capability).sort()).toEqual([...PERMISSION_KEYS].sort());
    expect(new Set(matrix.rows.map((row) => row.capability)).size).toBe(matrix.rows.length);

    for (const capability of PERMISSION_KEYS) {
      const row = matrix.rows.find((candidate) => candidate.capability === capability);
      expect(row, `Missing documentation for ${capability}`).toBeDefined();
      expect(row?.values).toHaveLength(MEMBER_ROLES.length);

      for (const [index, role] of MEMBER_ROLES.entries()) {
        expect(documentedPermission(row!.values[index]!), `${role}.${capability}`).toBe(
          hasPermission(role, capability),
        );
      }
    }
  });
});
