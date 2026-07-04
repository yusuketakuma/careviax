import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOTS = ['src/lib', 'src/server', 'src/phos', 'tools/scripts', 'tools/infra'];
const AWS_RUNTIME_SOURCE_ROOTS = ['src/phos', 'tools/infra'];
const AWS_CLIENT_CONSTRUCTOR_PATTERN =
  /new\s+(?:[A-Za-z_$][\w$]*\.)?(?:ApiGatewayManagementApi|CloudWatch|CognitoIdentityProvider|DynamoDB|RDS|S3|SES|SNS|SecretsManager)Client\s*\(/g;
const TIMEOUT_WRAPPER_PATTERN = /with(?:Aws|PhosAws|ScriptAws|InfraAws)ClientTimeout\s*\(/;
const BOUNDED_RETRY_CONFIG_PATTERN =
  /(?:awsClientConfig|phosAwsClientConfig|scriptAwsClientConfig|infraAwsClientConfig)\s*\(/;
const LEGACY_LAMBDA_RUNTIME_PATTERN =
  /\b(?:Runtime:\s*|lambda_runtime[^'"\n]*['"]|AWS_Lambda_)nodejs(?:18|20|22)\.x\b/g;

function listSourceFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(fullPath);
    if (!entry.isFile()) return [];
    if (
      !fullPath.endsWith('.ts') &&
      !fullPath.endsWith('.tsx') &&
      !fullPath.endsWith('.yaml') &&
      !fullPath.endsWith('.yml')
    ) {
      return [];
    }
    if (fullPath.endsWith('.test.ts') || fullPath.endsWith('.test.tsx')) return [];
    return [fullPath];
  });
}

function lineNumberAt(source: string, index: number) {
  return source.slice(0, index).split('\n').length;
}

describe('AWS client timeout contract', () => {
  it('keeps production AWS SDK clients behind bounded timeout wrappers', () => {
    const violations = SOURCE_ROOTS.flatMap((root) =>
      listSourceFiles(root).flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return Array.from(source.matchAll(AWS_CLIENT_CONSTRUCTOR_PATTERN)).flatMap((match) => {
          const matchIndex = match.index ?? 0;
          const wrapperContext = source.slice(Math.max(0, matchIndex - 180), matchIndex);
          if (TIMEOUT_WRAPPER_PATTERN.test(wrapperContext)) return [];
          return `${filePath}:${lineNumberAt(source, matchIndex)} ${match[0]}`;
        });
      }),
    );

    expect(violations).toEqual([]);
  });

  it('keeps production AWS SDK clients on bounded retry settings', () => {
    const violations = SOURCE_ROOTS.flatMap((root) =>
      listSourceFiles(root).flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return Array.from(source.matchAll(AWS_CLIENT_CONSTRUCTOR_PATTERN)).flatMap((match) => {
          const matchIndex = match.index ?? 0;
          const configContext = source.slice(matchIndex, Math.min(source.length, matchIndex + 260));
          if (BOUNDED_RETRY_CONFIG_PATTERN.test(configContext)) return [];
          return `${filePath}:${lineNumberAt(source, matchIndex)} ${match[0]}`;
        });
      }),
    );

    expect(violations).toEqual([]);
  });

  it('keeps deployable Lambda runtime declarations on Node.js 24', () => {
    const violations = AWS_RUNTIME_SOURCE_ROOTS.flatMap((root) =>
      listSourceFiles(root).flatMap((filePath) => {
        const source = fs.readFileSync(filePath, 'utf8');
        return Array.from(source.matchAll(LEGACY_LAMBDA_RUNTIME_PATTERN)).map((match) => {
          const matchIndex = match.index ?? 0;
          return `${filePath}:${lineNumberAt(source, matchIndex)} ${match[0]}`;
        });
      }),
    );

    expect(violations).toEqual([]);
  });
});
