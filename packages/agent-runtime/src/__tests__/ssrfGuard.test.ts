import { describe, expect, it } from 'vitest';
import { assertSafeOutboundUrl } from '../security/ssrfGuard.js';

describe('assertSafeOutboundUrl', () => {
  it('rejects localhost hostnames', async () => {
    await expect(assertSafeOutboundUrl('http://localhost:3000/hook')).rejects.toThrow('Blocked hostname');
  });

  it('rejects metadata endpoints', async () => {
    await expect(assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data')).rejects.toThrow('Blocked IPv4');
  });

  it('rejects private CIDR direct IPs', async () => {
    await expect(assertSafeOutboundUrl('http://10.1.2.3/hook')).rejects.toThrow('Private IPv4');
  });

  it('enforces host allowlist when provided', async () => {
    await expect(
      assertSafeOutboundUrl('https://example.com/hook', { allowedHosts: ['hooks.company.com'] }),
    ).rejects.toThrow('Host is not in allowlist');
  });
});
