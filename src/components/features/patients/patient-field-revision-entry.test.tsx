// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import {
  PatientFieldRevisionEntry,
  PatientFieldRevisionList,
} from './patient-field-revision-entry';
import type { PatientFieldRevisionTimelineItem } from './patient-field-revision-timeline-response-schema';

setupDomTestEnv();

const baseRevision: PatientFieldRevisionTimelineItem = {
  id: 'rev_1',
  category: 'basic',
  field_key: 'phone',
  field_label: '電話番号',
  value_label: '090-0000-0000 → 080-1111-2222',
  previous: '090-0000-0000',
  current: '080-1111-2222',
  source: 'patient_detail_edit',
  source_visit_record_id: null,
  change_reason: '本人から新しい連絡先を確認',
  importance: 'caution',
  confirmed_by_name: '佐藤 花子',
  confirmed_at: '2026-06-16T02:00:00.000Z',
  valid_from: '2026-06-16T00:00:00.000Z',
  valid_to: null,
  is_current: true,
  updated_by_name: '田中 太郎',
  created_at: '2026-06-16T01:00:00.000Z',
};

describe('PatientFieldRevisionEntry', () => {
  it('shows an authorized scalar diff and provenance without masking exact values', () => {
    render(
      <ul>
        <PatientFieldRevisionEntry item={baseRevision} />
      </ul>,
    );

    expect(screen.getByText('090-0000-0000 → 080-1111-2222')).toBeTruthy();
    expect(screen.getByText('本人から新しい連絡先を確認')).toBeTruthy();
    expect(screen.getByText('現在適用中')).toBeTruthy();
    expect(screen.getByText('要確認')).toBeTruthy();
    expect(screen.getByText('田中 太郎')).toBeTruthy();
    expect(screen.getByText(/佐藤 花子/)).toBeTruthy();
    expect(screen.getByText('2026年6月16日 10:00')).toBeTruthy();
    expect(screen.getByText('2026年6月16日〜現在')).toBeTruthy();
    expect(screen.queryByTestId('legacy-presence-only-revision')).toBeNull();
  });

  it('keeps structured contact snapshots exact behind one shared density control', () => {
    render(
      <ul>
        <PatientFieldRevisionEntry
          item={{
            ...baseRevision,
            id: 'rev_contacts',
            category: 'contacts',
            field_key: 'contacts',
            field_label: '連絡先',
            value_label: '1件 → 1件',
            previous: [
              {
                name: '山田 花子',
                relation: '家族',
                phone: '090-0000-0000',
                is_primary: true,
              },
            ],
            current: [
              {
                name: '山田 花子',
                relation: '家族',
                phone: '080-1111-2222',
                is_primary: true,
              },
            ],
          }}
        />
      </ul>,
    );

    const summary = screen.getByText('変更前後の正確な値を表示');
    const details = summary.closest('details');
    expect(details?.open).toBe(false);

    fireEvent.click(summary);

    expect(details?.open).toBe(true);
    expect(screen.getByText('変更前')).toBeTruthy();
    expect(screen.getByText('変更後')).toBeTruthy();
    expect(screen.getAllByText('山田 花子')).toHaveLength(2);
    expect(screen.getByText('090-0000-0000')).toBeTruthy();
    expect(screen.getByText('080-1111-2222')).toBeTruthy();
    expect(screen.getAllByText('電話番号')).toHaveLength(2);
  });

  it('states that legacy presence-only history has no recoverable exact value', () => {
    render(
      <ul>
        <PatientFieldRevisionEntry
          item={{
            ...baseRevision,
            id: 'rev_legacy',
            value_label: null,
            previous: '〔記録あり〕',
            current: '〔記録あり〕',
          }}
        />
      </ul>,
    );

    expect(screen.getByTestId('legacy-presence-only-revision').textContent).toContain(
      '旧形式のため、変更前後の詳細値を表示できません',
    );
    expect(screen.queryByText('変更前後の正確な値を表示')).toBeNull();
  });

  it('shares one bordered row-list surface across patient and visit consumers', () => {
    render(<PatientFieldRevisionList items={[baseRevision, { ...baseRevision, id: 'rev_2' }]} />);

    expect(screen.getAllByTestId('patient-field-revision-entry')).toHaveLength(2);
    const list = screen.getAllByTestId('patient-field-revision-entry')[0]?.parentElement;
    expect(list?.className).toContain('divide-y');
    expect(list?.className).toContain('rounded-md');
  });
});
