import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const PATIENT_HISTORY_FILES = [
  'src/app/(dashboard)/patients/[id]/prescriptions/prescription-history-content.tsx',
  'src/components/features/patients/patient-history-summary.tsx',
  'src/components/features/patients/patient-history-quick-links.tsx',
] as const;

const SUB_TWELVE_PIXEL_CLASS = /text-\[(?:[0-9]|1[01])px\]/g;

describe('patient history typography contract', () => {
  it.each(PATIENT_HISTORY_FILES)(
    '%s keeps clinical and auxiliary text at 12px or larger',
    (file) => {
      const source = readFileSync(file, 'utf8');

      expect(source.match(SUB_TWELVE_PIXEL_CLASS), file).toBeNull();
    },
  );
});
