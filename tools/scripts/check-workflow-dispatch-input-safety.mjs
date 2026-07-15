#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW_PATH = '.github/workflows/aws-container-image.yml';
const VALIDATION_STEP_NAME = 'Validate workflow dispatch inputs';
const VALIDATION_STEP_ID = 'validate-inputs';

const REQUIRED_INPUT_ENV = new Map([
  ['INPUT_AWS_REGION', 'aws_region'],
  ['INPUT_ECR_REPOSITORY', 'ecr_repository'],
  ['INPUT_IMAGE_TAG', 'image_tag'],
  ['INPUT_NEXT_PUBLIC_APP_URL', 'next_public_app_url'],
  ['INPUT_NEXT_PUBLIC_COGNITO_USER_POOL_ID', 'next_public_cognito_user_pool_id'],
  ['INPUT_NEXT_PUBLIC_COGNITO_CLIENT_ID', 'next_public_cognito_client_id'],
]);

const REQUIRED_OUTPUTS = [
  'aws_region',
  'image_suffix',
  'next_public_app_url',
  'next_public_cognito_user_pool_id',
  'next_public_cognito_client_id',
];

const PRIVILEGED_OR_SIDE_EFFECT_MARKERS = [
  'uses: pnpm/action-setup@',
  'uses: actions/setup-node@',
  'name: Install dependencies',
  'name: Validate AWS deployment artifacts',
  'uses: aws-actions/configure-aws-credentials@',
  'uses: aws-actions/amazon-ecr-login@',
  'uses: docker/setup-buildx-action@',
  'uses: docker/build-push-action@',
];

function fail(message) {
  throw new Error(`workflow dispatch input safety drift: ${message}`);
}

function extractStep(workflow, stepName) {
  const startMarker = `      - name: ${stepName}`;
  const start = workflow.indexOf(startMarker);
  if (start < 0) fail(`missing step "${stepName}"`);

  const remainder = workflow.slice(start + startMarker.length);
  const nextNamedStep = remainder.search(/\n      - (?:name|uses): /);
  const end = nextNamedStep < 0 ? workflow.length : start + startMarker.length + nextNamedStep;
  return { start, text: workflow.slice(start, end) };
}

export function extractInputValidationScript(workflow) {
  const step = extractStep(workflow, VALIDATION_STEP_NAME).text;
  const match = step.match(/\n        run: \|\n([\s\S]*)$/);
  if (!match) fail('validation step must use a multiline run block');

  return match[1]
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
}

function validateOrdering(workflow, validationStart) {
  const firstRun = workflow.indexOf('\n        run:');
  if (firstRun >= 0 && firstRun < validationStart) {
    fail('input validation must be the first run step');
  }

  for (const marker of PRIVILEGED_OR_SIDE_EFFECT_MARKERS) {
    const markerIndex = workflow.indexOf(marker);
    if (markerIndex < 0) fail(`missing protected workflow marker "${marker}"`);
    if (markerIndex < validationStart) {
      fail(`"${marker}" must remain after input validation`);
    }
  }
}

function validateInputBoundary(workflow, validationStep) {
  if (!validationStep.text.includes(`id: ${VALIDATION_STEP_ID}`)) {
    fail(`validation step must keep id "${VALIDATION_STEP_ID}"`);
  }

  for (const [environmentName, inputName] of REQUIRED_INPUT_ENV) {
    const mapping = `${environmentName}: \${{ inputs.${inputName} }}`;
    if (!validationStep.text.includes(mapping)) {
      fail(`missing validation environment mapping for ${inputName}`);
    }
  }

  const workflowOutsideValidation =
    workflow.slice(0, validationStep.start) +
    workflow.slice(validationStep.start + validationStep.text.length);
  if (workflowOutsideValidation.includes('${{ inputs.')) {
    fail('raw workflow_dispatch input is used outside the validation step');
  }

  const script = extractInputValidationScript(workflow);
  for (const requiredFragment of [
    'reject_control_characters',
    '[[ "$INPUT_AWS_REGION" == "ap-northeast-1" ]]',
    '${#INPUT_ECR_REPOSITORY} >= 2',
    '${#INPUT_ECR_REPOSITORY} <= 256',
    '${#INPUT_IMAGE_TAG} <= 128',
    '^https:\\/\\/',
    '${#app_host} <= 253',
    '${#app_host_label} >= 1',
    '${#app_host_label} <= 63',
    'app_port_number >= 1 && app_port_number <= 65535',
    '${#INPUT_NEXT_PUBLIC_COGNITO_USER_POOL_ID} <= 55',
    '^ap-northeast-1_[A-Za-z0-9]+$',
    '^[A-Za-z0-9_+]+$',
  ]) {
    if (!script.includes(requiredFragment)) {
      fail(`validation script lost required contract fragment ${requiredFragment}`);
    }
  }

  for (const outputName of REQUIRED_OUTPUTS) {
    if (!script.includes(`printf '${outputName}=%s\\n'`)) {
      fail(`validation script does not emit ${outputName}`);
    }
    if (!workflowOutsideValidation.includes(`steps.${VALIDATION_STEP_ID}.outputs.${outputName}`)) {
      fail(`validated output ${outputName} is not consumed`);
    }
  }
}

export function validateWorkflow(workflow) {
  const validationStep = extractStep(workflow, VALIDATION_STEP_NAME);
  validateOrdering(workflow, validationStep.start);
  validateInputBoundary(workflow, validationStep);

  if (!workflow.includes('aws-region: ${{ steps.validate-inputs.outputs.aws_region }}')) {
    fail('AWS credential configuration must use the validated region output');
  }
  if (!workflow.includes('IMAGE_SUFFIX: ${{ steps.validate-inputs.outputs.image_suffix }}')) {
    fail('image composition must use the pre-credential validated image suffix');
  }
}

export function checkWorkflowDispatchInputSafety(root = process.cwd()) {
  const workflow = readFileSync(path.join(root, WORKFLOW_PATH), 'utf8');
  validateWorkflow(workflow);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  checkWorkflowDispatchInputSafety();
  console.log('Workflow dispatch input safety check passed.');
}
