import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { COVERAGE_CATALOG, getCoverageCategory } from './data-explorer-catalog';

describe('data explorer coverage catalog', () => {
  it('classifies every Prisma model exactly once', () => {
    const prismaModelNames = Prisma.dmmf.datamodel.models.map((model) => model.name);
    const categorized = Object.values(COVERAGE_CATALOG).flat() as string[];
    const knownModelNames = new Set<string>(prismaModelNames);
    const duplicates = categorized.filter((name, index) => categorized.indexOf(name) !== index);
    const uncategorized = prismaModelNames.filter((name) => !categorized.includes(name));
    const unknown = categorized.filter((name) => !knownModelNames.has(name));

    expect(duplicates).toEqual([]);
    expect(uncategorized).toEqual([]);
    expect(unknown).toEqual([]);
    expect(new Set(categorized).size).toBe(prismaModelNames.length);
  });

  it('marks MCS persistence models as frontend-backed', () => {
    expect(getCoverageCategory('PatientMcsLink')).toBe('frontend_api');
    expect(getCoverageCategory('PatientMcsSummary')).toBe('frontend_api');
    expect(getCoverageCategory('PatientMcsMessage')).toBe('frontend_api');
  });
});
