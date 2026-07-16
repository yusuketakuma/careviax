import { BlockList, isIP } from 'node:net';

export const MAX_TRUSTED_PROXY_HOPS = 8;

export const TRUSTED_PROXY_TOPOLOGIES = ['single-overwrite', 'append-chain'] as const;

export type TrustedProxyTopology = (typeof TRUSTED_PROXY_TOPOLOGIES)[number];

type EnvSource = Record<string, string | undefined>;

export type TrustedProxyConfig = {
  topology: TrustedProxyTopology;
  trustedProxyHops: number;
  trustedProxyCidrs: string[];
};

export type TrustedProxyConfigResult =
  | { ok: true; config: TrustedProxyConfig }
  | { ok: false; reason: string };

export const LIGHTSAIL_SINGLE_PROXY_ENV = {
  TRUST_PROXY_HEADERS: 'true',
  TRUSTED_PROXY_TOPOLOGY: 'single-overwrite',
  TRUSTED_PROXY_HOPS: '0',
  TRUSTED_PROXY_CIDRS: '',
} as const;

function normalize(value: string | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function isCanonicalNonNegativeInteger(value: string) {
  return /^(?:0|[1-9]\d*)$/u.test(value);
}

function parseTrustedProxyCidrs(value: string | undefined): string[] | null {
  const raw = value?.trim() ?? '';
  if (!raw) return [];

  const cidrs = raw.split(',').map((entry) => entry.trim());
  if (cidrs.some((entry) => entry.length === 0)) return null;

  for (const cidr of cidrs) {
    const separator = cidr.lastIndexOf('/');
    if (separator <= 0) return null;
    const address = cidr.slice(0, separator);
    const rawPrefix = cidr.slice(separator + 1);
    if (!isCanonicalNonNegativeInteger(rawPrefix)) return null;
    const family = isIP(address);
    const prefix = Number(rawPrefix);
    if ((family === 4 && prefix <= 32) || (family === 6 && prefix <= 128)) continue;
    return null;
  }

  return cidrs;
}

export function isAddressInCidr(address: string, cidr: string): boolean {
  const separator = cidr.lastIndexOf('/');
  const network = cidr.slice(0, separator);
  const prefix = Number(cidr.slice(separator + 1));
  const family = isIP(address);
  if (family === 0 || family !== isIP(network)) return false;

  try {
    const blockList = new BlockList();
    blockList.addSubnet(network, prefix, family === 4 ? 'ipv4' : 'ipv6');
    return blockList.check(address, family === 4 ? 'ipv4' : 'ipv6');
  } catch {
    return false;
  }
}

/**
 * Resolves the declared reverse-proxy contract used for client-IP security decisions.
 * The network path must independently prevent direct access to the application port.
 */
export function resolveTrustedProxyConfig(env: EnvSource = process.env): TrustedProxyConfigResult {
  const trustHeaders = normalize(env.TRUST_PROXY_HEADERS);
  if (trustHeaders !== '1' && trustHeaders !== 'true') {
    return {
      ok: false,
      reason: 'TRUST_PROXY_HEADERS must be explicitly set to true',
    };
  }

  const topology = normalize(env.TRUSTED_PROXY_TOPOLOGY);
  if (!TRUSTED_PROXY_TOPOLOGIES.includes(topology as TrustedProxyTopology)) {
    return {
      ok: false,
      reason: `TRUSTED_PROXY_TOPOLOGY must be one of: ${TRUSTED_PROXY_TOPOLOGIES.join(', ')}`,
    };
  }

  const rawHops = env.TRUSTED_PROXY_HOPS?.trim() ?? '';
  if (!isCanonicalNonNegativeInteger(rawHops)) {
    return {
      ok: false,
      reason: 'TRUSTED_PROXY_HOPS must be an explicit canonical non-negative integer',
    };
  }

  const trustedProxyHops = Number(rawHops);
  if (trustedProxyHops > MAX_TRUSTED_PROXY_HOPS) {
    return {
      ok: false,
      reason: `TRUSTED_PROXY_HOPS must not exceed ${MAX_TRUSTED_PROXY_HOPS}`,
    };
  }

  if (topology === 'single-overwrite' && trustedProxyHops !== 0) {
    return {
      ok: false,
      reason: 'single-overwrite topology requires TRUSTED_PROXY_HOPS=0',
    };
  }

  const trustedProxyCidrs = parseTrustedProxyCidrs(env.TRUSTED_PROXY_CIDRS);
  if (!trustedProxyCidrs) {
    return {
      ok: false,
      reason: 'TRUSTED_PROXY_CIDRS must be a comma-separated list of valid CIDR blocks',
    };
  }
  if (topology === 'single-overwrite' && trustedProxyCidrs.length !== 0) {
    return {
      ok: false,
      reason: 'single-overwrite topology must not declare TRUSTED_PROXY_CIDRS',
    };
  }
  if (topology === 'append-chain' && trustedProxyCidrs.length !== trustedProxyHops) {
    return {
      ok: false,
      reason:
        'append-chain requires one ordered TRUSTED_PROXY_CIDRS entry per trusted trailing hop',
    };
  }

  return {
    ok: true,
    config: {
      topology: topology as TrustedProxyTopology,
      trustedProxyHops,
      trustedProxyCidrs,
    },
  };
}
