import { BlockList, isIP } from 'node:net';

/** Node-only CIDR membership check for trusted proxy request processing. */
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
