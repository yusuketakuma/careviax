import { describe, expect, it } from 'vitest';
import {
  buildDataExplorerRowsResponseSchema,
  dataExplorerModelsResponseSchema,
} from './data-explorer-response-schema';

const rowResponse = {
  data: {
    modelName: 'Patient',
    tableName: 'patients',
    coverageCategory: 'frontend_api',
    coverageLabel: '画面 + API',
    columns: [
      {
        name: 'id',
        type: 'String',
        kind: 'scalar',
        isList: false,
        isRequired: true,
        isEditable: false,
      },
      {
        name: 'name',
        type: 'String',
        kind: 'scalar',
        isList: false,
        isRequired: true,
        isEditable: false,
      },
    ],
    totalCount: 1,
    totalCountIsExact: true,
    hasMore: false,
    limit: 25,
    offset: 0,
    rows: [{ id: 'patient_1', name: '山田 花子' }],
  },
};

describe('dataExplorerModelsResponseSchema', () => {
  it('rejects duplicate table identities and invalid field arithmetic', () => {
    const model = {
      modelName: 'Patient',
      tableName: 'patients',
      coverageCategory: 'frontend_api',
      coverageLabel: '画面 + API',
      rowCount: 1,
      scalarFieldCount: 1,
      editableFieldCount: 2,
      searchableField: 'name',
    };
    expect(dataExplorerModelsResponseSchema.safeParse({ data: [model] }).success).toBe(false);
    expect(
      dataExplorerModelsResponseSchema.safeParse({
        data: [
          { ...model, editableFieldCount: 1 },
          { ...model, modelName: 'Other', editableFieldCount: 1 },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('buildDataExplorerRowsResponseSchema', () => {
  const schema = buildDataExplorerRowsResponseSchema('patients');

  it('projects provider-only pagination metadata out of the client payload', () => {
    expect(schema.parse(rowResponse)).toEqual({
      data: {
        modelName: 'Patient',
        tableName: 'patients',
        coverageCategory: 'frontend_api',
        coverageLabel: '画面 + API',
        columns: rowResponse.data.columns,
        totalCount: 1,
        limit: 25,
        offset: 0,
        rows: [{ id: 'patient_1', name: '山田 花子' }],
      },
    });
  });

  it('rejects wrong-table, duplicate-row, and undeclared fields', () => {
    expect(
      schema.safeParse({ ...rowResponse, data: { ...rowResponse.data, tableName: 'users' } })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...rowResponse,
        data: { ...rowResponse.data, rows: [rowResponse.data.rows[0], rowResponse.data.rows[0]] },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        ...rowResponse,
        data: { ...rowResponse.data, rows: [{ id: 'patient_1', secret: 'hidden' }] },
      }).success,
    ).toBe(false);
  });
});
