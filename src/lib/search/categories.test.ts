import { describe, expect, it } from 'vitest';
import {
  ACTIVE_PALETTE_CATEGORIES,
  PALETTE_CATEGORIES,
  PALETTE_RESULT_LIMIT,
  type PaletteCategoryId,
} from './categories';

const byId = (id: PaletteCategoryId) => {
  const category = PALETTE_CATEGORIES.find((c) => c.id === id);
  if (!category) throw new Error(`missing palette category ${id}`);
  return category;
};

describe('palette category registry (F-009 MVP)', () => {
  it('contains exactly the 6 text categories (facility / medicationDeadline excluded)', () => {
    expect(PALETTE_CATEGORIES.map((c) => c.id)).toEqual([
      'patient',
      'proposal',
      'prescription',
      'drug',
      'report',
      'contact',
    ]);
    // facility / medicationDeadline must NOT be in the palette MVP.
    expect(PALETTE_CATEGORIES.some((c) => (c.id as string) === 'facility')).toBe(false);
    expect(PALETTE_CATEGORIES.some((c) => (c.id as string) === 'medicationDeadline')).toBe(false);
  });

  it('exposes all 6 text categories as active (none deferred under current PHI policy)', () => {
    // human ポリシー: PHI は外部送信時のみ考慮。同一 org の認証ユーザーへの list 取得は外部送信でない
    // ため、全カテゴリを active に保つ(deferred なし)。
    expect(ACTIVE_PALETTE_CATEGORIES.map((c) => c.id)).toEqual([
      'patient',
      'proposal',
      'prescription',
      'drug',
      'report',
      'contact',
    ]);
    expect(PALETTE_CATEGORIES.every((c) => !c.deferred)).toBe(true);
  });

  it('maps each category to the destination permission (single SSOT for no-fetch gating)', () => {
    expect(byId('patient').requiredPermission).toBe('canVisit');
    expect(byId('proposal').requiredPermission).toBe('canVisit');
    expect(byId('prescription').requiredPermission).toBe('canVisit');
    expect(byId('report').requiredPermission).toBe('canReport');
    expect(byId('contact').requiredPermission).toBe('canReport');
    // drug masters are global (authenticated only, no org/permission).
    expect(byId('drug').requiredPermission).toBeNull();
  });

  it('flags org-scoped categories (all but drug) and best-effort (prescription only)', () => {
    expect(byId('drug').orgScoped).toBe(false);
    for (const id of ['patient', 'proposal', 'prescription', 'report', 'contact'] as const) {
      expect(byId(id).orgScoped, id).toBe(true);
    }
    expect(byId('prescription').bestEffort).toBe(true);
    for (const id of ['patient', 'proposal', 'drug', 'report', 'contact'] as const) {
      expect(byId(id).bestEffort ?? false, id).toBe(false);
    }
  });

  it('builds endpoints with the query and a bounded limit', () => {
    expect(byId('drug').endpoint('ロキソ')).toBe(
      `/api/drug-masters?q=${encodeURIComponent('ロキソ')}&limit=8`,
    );
    // contact は F-010A の最小投影 endpoint(q + limit=8)を消費する。
    expect(byId('contact').endpoint('田中')).toBe(
      `/api/contact-profiles?q=${encodeURIComponent('田中')}&limit=8`,
    );
  });

  it('routes patient/proposal/report through the view=palette minimal projection (F-012)', () => {
    // view=palette を付けないと full list 分岐に当たり over-wide payload(住所/保険/pdf_url 等)が
    // ブラウザへ転送される。最小投影 endpoint を必ず叩くことを固定する。
    expect(byId('patient').endpoint('山田')).toBe(
      `/api/patients?view=palette&q=${encodeURIComponent('山田')}&limit=8`,
    );
    expect(byId('proposal').endpoint('山田')).toBe(
      `/api/visit-schedule-proposals?view=palette&q=${encodeURIComponent('山田')}&limit=8`,
    );
    expect(byId('report').endpoint('山田')).toBe(
      `/api/care-reports?view=palette&q=${encodeURIComponent('山田')}&limit=8`,
    );
    // drug(global master)/prescription/contact(F-010A q/limit 契約)は view=palette を使わない。
    expect(byId('drug').endpoint('x')).not.toContain('view=palette');
    expect(byId('prescription').endpoint('x')).not.toContain('view=palette');
    expect(byId('contact').endpoint('x')).not.toContain('view=palette');
  });

  // --- raw wire-shape schemas: success() = NextResponse.json(data) (no { data } auto-envelope) ---

  const validRaw: Record<PaletteCategoryId, unknown> = {
    patient: { data: [{ id: 'p1', name: '山田 太郎' }] },
    proposal: { data: [{ id: 'pr1', proposal_status: 'pending', proposed_date: '2026-06-20' }] },
    prescription: { data: [{ id: 'rx1' }] },
    drug: { data: [{ id: 'd1', drug_name: 'ロキソニン錠' }] },
    report: {
      data: [{ id: 'r1', report_type: 'monthly', status: 'draft', created_at: '2026-06-20' }],
    },
    contact: { data: [{ id: 'c1', name: '田中薬局' }] },
  };

  it('accepts the real raw { data: [...] } body and normalizes to the items array', () => {
    for (const category of PALETTE_CATEGORIES) {
      const parsed = category.schema.safeParse(validRaw[category.id]);
      expect(parsed.success, `${category.id} should accept valid raw`).toBe(true);
      if (parsed.success) {
        const items = category.normalize(parsed.data);
        expect(Array.isArray(items)).toBe(true);
        expect(items).toHaveLength(1);
      }
    }
  });

  it('fails closed on a wrong { data } envelope wrapping (data.data) and on non-array data', () => {
    for (const category of PALETTE_CATEGORIES) {
      // accidental double envelope: { data: { data: [...] } }
      expect(
        category.schema.safeParse({ data: validRaw[category.id] }).success,
        `${category.id} double-envelope must fail`,
      ).toBe(false);
      // data is not an array
      expect(category.schema.safeParse({ data: {} }).success, `${category.id} non-array data`).toBe(
        false,
      );
      // missing data entirely
      expect(category.schema.safeParse({}).success, `${category.id} missing data`).toBe(false);
    }
  });

  it('rejects items missing required fields (e.g. patient.name, drug.drug_name)', () => {
    expect(byId('patient').schema.safeParse({ data: [{ id: 'p1' }] }).success).toBe(false);
    expect(byId('drug').schema.safeParse({ data: [{ id: 'd1' }] }).success).toBe(false);
    expect(
      byId('report').schema.safeParse({ data: [{ id: 'r1', report_type: 'monthly' }] }).success,
    ).toBe(false);
  });

  it('rejects an over-limit data array (>PALETTE_RESULT_LIMIT) so a backend ignoring limit fails closed', () => {
    // endpoint は limit=PALETTE_RESULT_LIMIT を要求する。backend が無視して上限超を返した場合、
    // schema.max が safeParse を失敗させ、fetch 層で当該カテゴリを failed(rows=0)化する。
    for (const category of PALETTE_CATEGORIES) {
      const item = (validRaw[category.id] as { data: unknown[] }).data[0];
      const overLimit = { data: Array.from({ length: PALETTE_RESULT_LIMIT + 1 }, () => item) };
      const atLimit = { data: Array.from({ length: PALETTE_RESULT_LIMIT }, () => item) };
      expect(category.schema.safeParse(overLimit).success, `${category.id} >limit must fail`).toBe(
        false,
      );
      expect(category.schema.safeParse(atLimit).success, `${category.id} <=limit ok`).toBe(true);
    }
  });
});
