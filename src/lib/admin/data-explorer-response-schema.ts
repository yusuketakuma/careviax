import { z } from 'zod';
import { COVERAGE_CATEGORY_LABELS } from './data-explorer-catalog';

const coverageCategorySchema = z.enum(
  Object.keys(COVERAGE_CATEGORY_LABELS) as [
    keyof typeof COVERAGE_CATEGORY_LABELS,
    ...(keyof typeof COVERAGE_CATEGORY_LABELS)[],
  ],
);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

const explorerModelSchema = z
  .object({
    modelName: boundedText(200),
    tableName: boundedText(200),
    coverageCategory: coverageCategorySchema,
    coverageLabel: boundedText(500),
    rowCount: z.number().int().nonnegative(),
    scalarFieldCount: z.number().int().nonnegative(),
    editableFieldCount: z.number().int().nonnegative(),
    searchableField: boundedText(200).nullable(),
  })
  .strip()
  .refine((model) => model.editableFieldCount <= model.scalarFieldCount, {
    path: ['editableFieldCount'],
    message: 'Editable field count exceeds scalar field count',
  });

export const dataExplorerModelsResponseSchema = z
  .object({ data: z.array(explorerModelSchema).max(1_000) })
  .strict()
  .superRefine(({ data }, context) => {
    const modelNames = new Set<string>();
    const tableNames = new Set<string>();
    for (const [index, model] of data.entries()) {
      if (modelNames.has(model.modelName)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'modelName'],
          message: 'Duplicate model identity',
        });
      }
      if (tableNames.has(model.tableName)) {
        context.addIssue({
          code: 'custom',
          path: ['data', index, 'tableName'],
          message: 'Duplicate table identity',
        });
      }
      modelNames.add(model.modelName);
      tableNames.add(model.tableName);
    }
  });

const explorerFieldSchema = z
  .object({
    name: boundedText(200),
    type: boundedText(200),
    kind: boundedText(100),
    isList: z.boolean(),
    isRequired: z.boolean(),
    isEditable: z.boolean(),
  })
  .strict();

export function buildDataExplorerRowsResponseSchema(expectedTableName: string) {
  return z
    .object({
      data: z
        .object({
          modelName: boundedText(200),
          tableName: z.literal(expectedTableName),
          coverageCategory: coverageCategorySchema,
          coverageLabel: boundedText(500),
          columns: z.array(explorerFieldSchema).min(1).max(500),
          totalCount: z.number().int().nonnegative(),
          limit: z.number().int().min(1).max(100),
          offset: z.number().int().nonnegative().max(999_900),
          rows: z.array(z.record(z.string(), z.unknown())).max(100),
        })
        .strip(),
    })
    .strict()
    .superRefine(({ data }, context) => {
      const columnNames = new Set<string>();
      for (const [index, column] of data.columns.entries()) {
        if (columnNames.has(column.name)) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'columns', index, 'name'],
            message: 'Duplicate column identity',
          });
        }
        columnNames.add(column.name);
      }
      if (!columnNames.has('id')) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'columns'],
          message: 'Row identity column is missing',
        });
      }
      if (data.rows.length > data.limit) {
        context.addIssue({
          code: 'custom',
          path: ['data', 'rows'],
          message: 'Row count exceeds requested limit',
        });
      }
      const rowIds = new Set<string>();
      for (const [rowIndex, row] of data.rows.entries()) {
        const id = row.id;
        if (typeof id !== 'string' || !id.trim() || id.length > 200) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'rows', rowIndex, 'id'],
            message: 'Invalid row identity',
          });
        } else if (rowIds.has(id)) {
          context.addIssue({
            code: 'custom',
            path: ['data', 'rows', rowIndex, 'id'],
            message: 'Duplicate row identity',
          });
        } else {
          rowIds.add(id);
        }
        for (const key of Object.keys(row)) {
          if (!columnNames.has(key)) {
            context.addIssue({
              code: 'custom',
              path: ['data', 'rows', rowIndex, key],
              message: 'Row field is not declared by the provider',
            });
          }
        }
      }
    });
}

export type DataExplorerModelsResponse = z.infer<typeof dataExplorerModelsResponseSchema>;
export type DataExplorerRowsResponse = z.infer<
  ReturnType<typeof buildDataExplorerRowsResponseSchema>
>;
