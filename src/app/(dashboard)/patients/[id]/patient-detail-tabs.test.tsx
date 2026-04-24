// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PatientDetailInfoGroup } from './patient-detail-tabs';

describe('PatientDetailInfoGroup', () => {
  it('renders a bordered information group with an accessible heading', () => {
    render(
      <PatientDetailInfoGroup
        title="患者基本・保険"
        description="患者マスタ、住所、連絡先、保険、請求支援の前提情報をまとめます。"
      >
        <div>患者マスタ</div>
      </PatientDetailInfoGroup>,
    );

    const group = screen.getByRole('region', { name: '患者基本・保険' });
    expect(group.className).toContain('border-border/70');
    expect(group.className).toContain('rounded-2xl');
    expect(screen.getByText('患者マスタ')).toBeTruthy();
  });
});
