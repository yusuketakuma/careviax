import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function readSchemaModels(schemaDir: string): string[] {
  const modelNames: string[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{/gm;
  for (const fileName of readdirSync(schemaDir).filter((file) => file.endsWith('.prisma'))) {
    const text = readFileSync(join(schemaDir, fileName), 'utf8');
    let match: RegExpExecArray | null;
    while ((match = modelPattern.exec(text)) !== null) {
      if (match[1]) modelNames.push(match[1]);
    }
  }
  return modelNames.sort();
}

export function readModelBlock(schema: string, model: string): string {
  const match = new RegExp(`^model ${model} \\{[\\s\\S]*?^\\}`, 'm').exec(schema);
  if (!match) throw new Error(`Missing Prisma model block: ${model}`);
  return match[0];
}

function readModelNames(schema: string): string[] {
  const modelNames: string[] = [];
  const modelPattern = /^model\s+(\w+)\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = modelPattern.exec(schema)) !== null) {
    if (match[1]) modelNames.push(match[1]);
  }
  return modelNames;
}

export function collectDirectOrgScopedModels(schema: string): string[] {
  return readModelNames(schema)
    .filter((model) => {
      const block = readModelBlock(schema, model);
      return (
        /\n\s+org_id\s+String(?:\s|$)/.test(block) &&
        /\n\s+created_at\s+DateTime(?:\s|$)/.test(block) &&
        block.includes('@@unique([id, org_id])')
      );
    })
    .sort();
}

export function collectNonNullableOrgScopedModels(schema: string): string[] {
  return readModelNames(schema)
    .filter((model) => {
      const block = readModelBlock(schema, model);
      return (
        /\n\s+org_id\s+String(?:\s|$)/.test(block) &&
        /\n\s+created_at\s+DateTime(?:\s|$)/.test(block)
      );
    })
    .sort();
}

export function collectSourceFiles(root: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(path).forEach((file) => files.push(file));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}
