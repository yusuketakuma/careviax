import { describe, expect, it } from 'vitest';
import {
  buildDocumentTemplateBodyEditorResponseSchema,
  buildDocumentTemplateDetailResponseSchema,
  buildDocumentTemplatesResponseSchema,
} from './response-schema';

function buildMetadata(id = 'template_1') {
  return {
    id,
    name: '主治医報告 基本',
    template_type: 'care_report',
    target_role: 'physician',
    format: 'html',
    version: 2,
    effective_from: null,
    effective_to: null,
    is_default: true,
    created_at: '2026-06-19T10:00:00.000Z',
    updated_at: '2026-06-19T10:30:00.000Z',
  };
}

function buildList() {
  return {
    data: [buildMetadata()],
    meta: {
      total_count: 1,
      visible_count: 1,
      hidden_count: 0,
      truncated: false,
      count_basis: 'templates',
      filters_applied: { template_type: null, target_role: null },
      limit: 100,
    },
  };
}

describe('document template response schemas', () => {
  it('validates list metadata and strips unused list fields', () => {
    const payload = buildList();
    payload.data[0] = { ...payload.data[0], provider_internal: 'not cached' } as never;
    const parsed = buildDocumentTemplatesResponseSchema(null).parse(payload);
    expect(parsed.data[0]).not.toHaveProperty('provider_internal');
  });

  it('keeps full detail content while enforcing the requested identity', () => {
    const parsed = buildDocumentTemplateDetailResponseSchema('template_1').parse({
      data: { ...buildMetadata(), content: { sections: ['summary'] }, org_id: 'not cached' },
    });
    expect(parsed.data).not.toHaveProperty('org_id');
    expect(parsed.data.content).toEqual({ sections: ['summary'] });
  });

  it('projects body-editor responses to id, name, and content', () => {
    expect(
      buildDocumentTemplateBodyEditorResponseSchema('template_1').parse({
        data: { ...buildMetadata(), content: { body_text: '本文' } },
      }),
    ).toEqual({
      data: { id: 'template_1', name: '主治医報告 基本', content: { body_text: '本文' } },
    });
  });

  it.each([
    ['legacy list root', () => buildList().data, buildDocumentTemplatesResponseSchema(null)],
    [
      'list count drift',
      () => ({ ...buildList(), meta: { ...buildList().meta, total_count: 2 } }),
      buildDocumentTemplatesResponseSchema(null),
    ],
    [
      'wrong list filter',
      () => buildList(),
      buildDocumentTemplatesResponseSchema('tracing_report'),
    ],
    [
      'duplicate template identity',
      () => ({
        data: [buildMetadata(), buildMetadata()],
        meta: {
          ...buildList().meta,
          total_count: 2,
          visible_count: 2,
        },
      }),
      buildDocumentTemplatesResponseSchema(null),
    ],
    [
      'detail identity mismatch',
      () => ({ data: { ...buildMetadata('template_2'), content: {} } }),
      buildDocumentTemplateDetailResponseSchema('template_1'),
    ],
  ])('rejects %s', (_label, payloadFactory, schema) => {
    expect(schema.safeParse(payloadFactory()).success).toBe(false);
  });
});
