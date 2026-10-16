import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EconomyApiClient } from './client.js';

describe('EconomyApiClient', () => {
  let client: EconomyApiClient;
  const originalFetch = global.fetch;

  beforeEach(() => {
    client = new EconomyApiClient('http://test-economy:8792');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('correctly sets and retrieves base URL', () => {
    expect(client.getBaseUrl()).toBe('http://test-economy:8792');
    client.setBaseUrl('http://127.0.0.1:9999');
    expect(client.getBaseUrl()).toBe('http://127.0.0.1:9999');
  });

  it('fetches economy summary successfully', async () => {
    const mockSummary = {
      issued_units: 101400000,
      supply_cap_units: 2100000000,
      burned_units: 0,
      escrow_locked_units: 0,
      treasury_balance_units: 100000000,
      current_reward_units: 5000,
      next_halving_height: 10000,
      block_height: 0,
      validator_count: 3,
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockSummary,
    });

    const summary = await client.getEconomySummary();
    expect(summary.issued_units).toBe(101400000);
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-economy:8792/api/v1/economy/summary',
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('handles API errors with descriptive server message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({
        error: 'Bad Request',
        message: 'Insufficient funds to post bounty: required 2040 units',
      }),
    });

    await expect(
      client.postBounty({
        poster_account: 'cooper',
        title: 'Test',
        description_md: 'Test description',
        price_units: 2000,
      })
    ).rejects.toThrow('Insufficient funds to post bounty: required 2040 units');
  });

  it('posts bounty with correct payload', async () => {
    const mockBounty = {
      id: 'bounty_123',
      poster_account: 'cooper',
      title: 'Fix issue',
      description_md: 'Fix issue details',
      price_units: 2000,
      fee_units: 40,
      status: 'open',
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockBounty,
    });

    const res = await client.postBounty({
      poster_account: 'cooper',
      title: 'Fix issue',
      description_md: 'Fix issue details',
      price_units: 2000,
    });

    expect(res.id).toBe('bounty_123');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://test-economy:8792/api/v1/bounties',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          poster_account: 'cooper',
          title: 'Fix issue',
          description_md: 'Fix issue details',
          price_units: 2000,
        }),
      })
    );
  });
});
