import { vi } from 'vitest';
import { setupDomTestEnv } from '@/test/dom-test-utils';
import { jsonResponse, stubJsonFetch } from '@/test/fetch-test-utils';
import { buildOrgHeaders, buildOrgJsonHeaders } from '@/lib/api/org-headers';
import { buildPatientApiPath } from '@/lib/patient/api-paths';
import { buildPatientHref } from '@/lib/patient/navigation';
import { toast } from 'sonner';

const useMutationMock = vi.hoisted(() => vi.fn());
const useOrgIdMock = vi.hoisted(() => vi.fn());
const useQueryMock = vi.hoisted(() => vi.fn());
const useQueryClientMock = vi.hoisted(() => vi.fn());
const qrModuleLoadMock = vi.hoisted(() => vi.fn());
const qrToDataUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useMutation: useMutationMock,
  useQuery: useQueryMock,
  useQueryClient: useQueryClientMock,
}));

// Actual-backed spies so URL/header teeth prove helper adoption via return-value identity.
vi.mock('@/lib/api/org-headers', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/org-headers')>();
  return {
    ...actual,
    buildOrgHeaders: vi.fn(actual.buildOrgHeaders),
    buildOrgJsonHeaders: vi.fn(actual.buildOrgJsonHeaders),
  };
});

vi.mock('@/lib/patient/api-paths', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/api-paths')>();
  return { ...actual, buildPatientApiPath: vi.fn(actual.buildPatientApiPath) };
});

vi.mock('@/lib/patient/navigation', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/patient/navigation')>();
  return { ...actual, buildPatientHref: vi.fn(actual.buildPatientHref) };
});

vi.mock('@/lib/hooks/use-org-id', () => ({
  useOrgId: useOrgIdMock,
}));

vi.mock('qrcode', () => {
  qrModuleLoadMock();
  return { toDataURL: qrToDataUrlMock };
});

vi.mock('@/components/features/patients/residual-medication-chart', () => ({
  ResidualMedicationChart: () => <div data-testid="residual-chart" />,
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { MedicationsContent } from '../medications-content';

setupDomTestEnv();

export type MedicationsContentPropsForTest = Parameters<typeof MedicationsContent>[0];

export function getMedicationsContentTestSupport() {
  return {
    buildOrgHeaders,
    buildOrgJsonHeaders,
    buildPatientApiPath,
    buildPatientHref,
    jsonResponse,
    MedicationsContent,
    qrModuleLoadMock,
    qrToDataUrlMock,
    stubJsonFetch,
    toast,
    useMutationMock,
    useOrgIdMock,
    useQueryClientMock,
    useQueryMock,
  };
}
