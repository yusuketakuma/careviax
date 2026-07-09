import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PRESCRIPTION_LIST_SURFACES = [
  'src/app/(dashboard)/prescriptions/prescriptions-workspace.tsx',
  'src/app/(dashboard)/prescriptions/prescriptions-table.tsx',
  'src/app/(dashboard)/prescriptions/prescription-inline-detail.tsx',
] as const;

const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('prescription list typography contract', () => {
  it.each(PRESCRIPTION_LIST_SURFACES)('%s keeps clinical text at 12px or larger', (filePath) => {
    const source = readFileSync(filePath, 'utf8');

    expect(source.match(SUB_TWELVE_PIXEL_CLASS), filePath).toBeNull();
  });
});
