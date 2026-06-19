import { describe, expect, it } from 'vitest';
import {
  minimalCsvCell,
  minimalCsvRow,
  neutralizeCsvFormulaPrefix,
  quotedCsvCell,
  quotedCsvRow,
} from './safe-csv';

describe('safe CSV helpers', () => {
  it.each(['=A1', '+A1', '-A1', '@A1', '\tA1', '\rA1', '\nA1'])(
    'neutralizes formula-leading cell %s',
    (value) => {
      expect(neutralizeCsvFormulaPrefix(value)).toBe(`'${value}`);
    },
  );

  it('quotes cells and escapes quotes', () => {
    expect(quotedCsvCell('a "quoted" value')).toBe('"a ""quoted"" value"');
    expect(quotedCsvRow(['=SUM(1,2)', 3, null])).toBe('"\'=SUM(1,2)","3",');
  });

  it('keeps minimal rows unquoted unless needed', () => {
    expect(minimalCsvCell('山田 太郎')).toBe('山田 太郎');
    expect(minimalCsvCell('\n=SUM(1,2)')).toBe('"\'\n=SUM(1,2)"');
    expect(minimalCsvCell('\r=SUM(1,2)')).toBe('"\'\r=SUM(1,2)"');
    expect(minimalCsvRow(['a,b', 'plain'])).toBe('"a,b",plain');
  });
});
