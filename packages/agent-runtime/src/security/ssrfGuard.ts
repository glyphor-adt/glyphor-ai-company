import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
]);

const BLOCKED_IPV4 = new Set([
  '0.0.0.0',
  '127.0.0.1',
  '169.254.169.254',
]);

const IPV6_LOOPBACK = '::1';

export interface SsrfGuardOptions {
  allowedHosts?: string[];
}

export async function assertSafeOutboundUrl(rawUrl: string, options: SsrfGuardOptions = {}): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported URL protocol: ${parsed.protocol}`);
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host) {
    throw new Error('URL hostname is required');
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    const normalizedAllowlist = new Set(options.allowedHosts.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
    if (!normalizedAllowlist.has(host)) {
      throw new Error(`Host is not in allowlist: ${host}`);
    }
  }

  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new Error(`Blocked hostname: ${host}`);
  }

  const directIpVersion = isIP(host);
  if (directIpVersion !== 0) {
    assertPublicIp(host, directIpVersion);
    return parsed;
  }

  const resolved = await lookup(host, { all: true, verbatim: true });
  if (resolved.length === 0) {
    throw new Error(`Host resolution returned no addresses: ${host}`);
  }

  for (const entry of resolved) {
    assertPublicIp(entry.address, entry.family);
  }

  return parsed;
}

function assertPublicIp(address: string, family: number): void {
  if (family === 4) {
    if (BLOCKED_IPV4.has(address)) {
      throw new Error(`Blocked IPv4 address: ${address}`);
    }
    if (isPrivateIpv4(address)) {
      throw new Error(`Private IPv4 address blocked: ${address}`);
    }
    return;
  }

  if (family === 6) {
    if (address === IPV6_LOOPBACK) {
      throw new Error(`Blocked IPv6 address: ${address}`);
    }
    if (isPrivateIpv6(address)) {
      throw new Error(`Private IPv6 address blocked: ${address}`);
    }
    return;
  }

  throw new Error(`Unknown IP family for address ${address}`);
}

function isPrivateIpv4(address: string): boolean {
  const octets = address.split('.').map((segment) => Number(segment));
  if (octets.length !== 4 || octets.some((part) => Number.isNaN(part))) return true;
  const [a, b] = octets;

  return (
    a === 10 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 127) ||
    (a === 169 && b === 254) ||
    a === 0
  );
}

function isPrivateIpv6(address: string): boolean {
  const normalized = address.toLowerCase();
  return (
    normalized === '::1' ||
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80:') ||
    normalized.startsWith('::ffff:127.') ||
    normalized === '::'
  );
}
