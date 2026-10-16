import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BankApiClient } from './client.js';

describe('BankApiClient', () => {
  let client: BankApiClient;
  const mockBaseUrl = 'http://127.0.0.1:9999';

  beforeEach(() => {
    client = new BankApiClient(mockBaseUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses configured base URL', () => {
    expect(client.getBaseUrl()).toBe(mockBaseUrl);
    client.setBaseUrl('http://localhost:8792');
    expect(client.getBaseUrl()).toBe('http://localhost:8792');
  });

  it('calls listAccounts endpoint', async () => {
    const mockAccounts = [
      { id: 'scotty', kind: 'human', account_type: 'checking', display_name: 'Scotty' },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockAccounts,
    } as any);

    const res = await client.listAccounts();
    expect(res).toEqual(mockAccounts);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/accounts`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('calls createSavingsAccount endpoint', async () => {
    const mockCreated = {
      id: 'scotty:savings',
      kind: 'human',
      account_type: 'savings',
      display_name: 'Scotty (Savings)',
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockCreated,
    } as any);

    const res = await client.createSavingsAccount('scotty');
    expect(res).toEqual(mockCreated);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/accounts/scotty/savings`,
      expect.objectContaining({
        method: 'POST',
      })
    );
  });

  it('handles API errors properly', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: async () => ({ message: 'Insufficient funds' }),
    } as any);

    await expect(
      client.postTransfer({
        from_account: 'scotty',
        to_account: 'cooper',
        amount_units: 99999999,
      })
    ).rejects.toThrow('Insufficient funds');
  });
});
