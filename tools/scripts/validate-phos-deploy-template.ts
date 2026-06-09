import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  buildPhosApiGatewayLambdaTemplate,
  buildPhosApiRouteDeploymentBindings,
} from '../../src/phos/infra/api-gateway-lambda-template';

type CheckStatus = 'passed' | 'failed' | 'missing';

type ValidationCheck = {
  name: string;
  status: CheckStatus;
  detail: string;
};

type CommandExecution = {
  exit_code: number | null;
  stdout: string;
  stderr: string;
  error_code?: string;
};

type CommandRunner = (command: string, args: readonly string[]) => CommandExecution;

export type PhosDeployTemplateValidationReport = {
  ok: boolean;
  generated_at: string;
  strict: boolean;
  template_path: string;
  checks: ValidationCheck[];
  missing_tools: string[];
  next_actions: string[];
};

const DEFAULT_TEMPLATE_PATH = 'artifacts/phos-api-gateway-lambda-template.json';
const ARTIFACT_ROOT_ENV = 'PHOS_LAMBDA_ARTIFACT_ROOT';

function truncate(value: string, maxLength = 1000) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength)}...`;
}

function runCommand(command: string, args: readonly string[]): CommandExecution {
  const result = spawnSync(command, [...args], {
    encoding: 'utf8',
    shell: false,
  });
  const error = result.error as NodeJS.ErrnoException | undefined;
  return {
    exit_code: typeof result.status === 'number' ? result.status : null,
    stdout: typeof result.stdout === 'string' ? result.stdout : '',
    stderr: typeof result.stderr === 'string' ? result.stderr : '',
    error_code: error?.code,
  };
}

function evaluateCommandCheck(input: {
  name: string;
  tool: string;
  args: readonly string[];
  runner: CommandRunner;
}): ValidationCheck {
  const result = input.runner(input.tool, input.args);
  if (result.error_code === 'ENOENT') {
    return {
      name: input.name,
      status: 'missing',
      detail: `${input.tool} is not installed; cannot run ${input.name}.`,
    };
  }
  if (result.exit_code === 0) {
    return {
      name: input.name,
      status: 'passed',
      detail: truncate(result.stdout || `${input.tool} completed successfully.`),
    };
  }
  return {
    name: input.name,
    status: 'failed',
    detail: truncate(
      [
        `${input.tool} exited with code ${result.exit_code ?? 'unknown'}.`,
        result.stderr,
        result.stdout,
      ].join('\n'),
    ),
  };
}

export function renderPhosApiGatewayLambdaTemplateJson() {
  return `${JSON.stringify(buildPhosApiGatewayLambdaTemplate(), null, 2)}\n`;
}

export function writePhosApiGatewayLambdaTemplate(input: {
  output_path?: string;
  template_json?: string;
}) {
  const outputPath = resolve(input.output_path ?? DEFAULT_TEMPLATE_PATH);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, input.template_json ?? renderPhosApiGatewayLambdaTemplateJson(), 'utf8');
  return outputPath;
}

function hasHandlerExport(source: string, exportName: string) {
  const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    [
      `export\\s+(?:const|function|async\\s+function)\\s+${escaped}\\b`,
      `exports\\.${escaped}\\s*=`,
      `module\\.exports\\.${escaped}\\s*=`,
    ].join('|'),
  ).test(source);
}

export function evaluateLambdaArtifactContract(input: {
  artifact_root?: string | null;
}): ValidationCheck {
  const artifactRoot = input.artifact_root?.trim();
  if (!artifactRoot) {
    return {
      name: 'lambda_artifact_contract',
      status: 'missing',
      detail: `Set ${ARTIFACT_ROOT_ENV} to an unpacked Lambda artifact directory and rerun validation.`,
    };
  }

  const failures: string[] = [];
  for (const binding of buildPhosApiRouteDeploymentBindings()) {
    const artifactFile = resolve(artifactRoot, `${binding.lambda_handler_file}.js`);
    if (!existsSync(artifactFile)) {
      failures.push(`${binding.route.route_key}: missing ${artifactFile}`);
      continue;
    }
    const source = readFileSync(artifactFile, 'utf8');
    if (!hasHandlerExport(source, binding.lambda_handler_export)) {
      failures.push(
        `${binding.route.route_key}: ${artifactFile} does not export ${binding.lambda_handler_export}`,
      );
    }
  }

  return failures.length > 0
    ? {
        name: 'lambda_artifact_contract',
        status: 'failed',
        detail: truncate(failures.join('\n')),
      }
    : {
        name: 'lambda_artifact_contract',
        status: 'passed',
        detail: `All PH-OS Lambda handlers referenced by CloudFormation exist under ${resolve(artifactRoot)}.`,
      };
}

export function buildPhosDeployTemplateValidationReport(input: {
  strict?: boolean;
  now?: Date;
  output_path?: string;
  runner?: CommandRunner;
  template_json?: string;
  env?: Record<string, string | undefined>;
} = {}): PhosDeployTemplateValidationReport {
  const strict = input.strict ?? false;
  const templatePath = writePhosApiGatewayLambdaTemplate({
    output_path: input.output_path,
    template_json: input.template_json,
  });
  const checks: ValidationCheck[] = [
    {
      name: 'cloudformation_template_export',
      status: 'passed',
      detail: `Wrote PH-OS API Gateway/Lambda CloudFormation template to ${templatePath}.`,
    },
  ];
  const runner = input.runner ?? runCommand;

  checks.push(
    evaluateCommandCheck({
      name: 'cloudformation_validate_template',
      tool: 'aws',
      args: ['cloudformation', 'validate-template', '--template-body', `file://${templatePath}`],
      runner,
    }),
  );
  checks.push(
    evaluateCommandCheck({
      name: 'cfn_lint',
      tool: 'cfn-lint',
      args: [templatePath],
      runner,
    }),
  );
  checks.push(
    evaluateLambdaArtifactContract({
      artifact_root: input.env?.[ARTIFACT_ROOT_ENV] ?? process.env[ARTIFACT_ROOT_ENV],
    }),
  );

  const missingTools = checks
    .filter((check) => check.status === 'missing')
    .map((check) =>
      check.name === 'cfn_lint'
        ? 'cfn-lint'
        : check.name === 'lambda_artifact_contract'
          ? ARTIFACT_ROOT_ENV
          : 'aws',
    );
  const ok = checks.every((check) => check.status === 'passed' || (!strict && check.status === 'missing'));
  const nextActions = missingTools.map((tool) =>
    tool === ARTIFACT_ROOT_ENV
      ? `Set ${ARTIFACT_ROOT_ENV} to the unpacked PH-OS Lambda artifact directory and rerun strict validation.`
      : `Install ${tool} and rerun the strict PH-OS deploy template validation.`,
  );

  return {
    ok,
    generated_at: (input.now ?? new Date()).toISOString(),
    strict,
    template_path: templatePath,
    checks,
    missing_tools: [...new Set(missingTools)].sort(),
    next_actions: nextActions.sort(),
  };
}

async function main() {
  const strict = process.argv.includes('--strict');
  const outputPathArgIndex = process.argv.indexOf('--output');
  const output_path =
    outputPathArgIndex >= 0 && process.argv[outputPathArgIndex + 1]
      ? process.argv[outputPathArgIndex + 1]
      : undefined;
  const report = buildPhosDeployTemplateValidationReport({ strict, output_path });
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
