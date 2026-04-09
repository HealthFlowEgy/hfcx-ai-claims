import { describe, expect, it, vi, beforeEach } from 'vitest';

import { ApiError, api } from '@/lib/api';

describe('api client', () => {
  beforeEach(() => {
    // Fresh fetch stub per test.
    vi.stubGlobal('fetch', vi.fn());
  });

  it('sends the correlation header on every request', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        claims_today: 3,
        pending_responses: 0,
        denial_rate_30d: 0.1,
        payments_this_month_egp: 500,
        claim_status_distribution: [],
      }),
    } as Response);

    const out = await api.providerSummary();
    expect(out.claims_today).toBe(3);

    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get('X-HCX-Correlation-ID')).toMatch(/^fe-/);
  });

  it('raises ApiError on non-ok with parsed detail', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 503,
      json: async () => ({ error: 'ERR-AI-503', message: 'AI down' }),
    } as Response);

    try {
      await api.providerSummary();
      expect.fail('expected ApiError to be thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(503);
      expect(err.code).toBe('ERR-AI-503');
      expect(err.message).toBe('AI down');
    }
  });

  it('raises ApiError on network failure', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('ECONNREFUSED'),
    );
    await expect(api.providerSummary()).rejects.toMatchObject({
      status: 0,
      code: 'ERR-NET',
    });
  });

  it('builds the list-claims query string correctly', async () => {
    (fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ items: [], total: 0 }),
    } as Response);

    await api.listClaims({
      portal: 'siu',
      status: ['denied', 'investigating'],
      limit: 25,
      offset: 50,
      search: 'CLAIM-001',
    });

    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('portal=siu');
    expect(url).toContain('status=denied%2Cinvestigating');
    expect(url).toContain('limit=25');
    expect(url).toContain('offset=50');
    expect(url).toContain('search=CLAIM-001');
  });
});
