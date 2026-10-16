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

  // ==========================================
  // SCHEDULED PAYMENTS API TESTS
  // ==========================================

  it('calls listScheduledPayments with query parameters', async () => {
    const mockSchedules = [
      {
        id: 'sched_1',
        from_account: 'cooper',
        to_account: 'scotty',
        amount_units: 5000,
        status: 'active',
      },
    ];

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockSchedules,
    } as any);

    const res = await client.listScheduledPayments({
      account: 'cooper',
      status: 'active',
      limit: 10,
    });
    expect(res).toEqual(mockSchedules);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/schedules?account=cooper&status=active&limit=10`,
      expect.objectContaining({
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      })
    );
  });

  it('calls getScheduledPayment endpoint', async () => {
    const mockDetail = {
      schedule: { id: 'sched_1', from_account: 'cooper', to_account: 'scotty', amount_units: 5000 },
      executions: [{ id: 'exec_1', schedule_id: 'sched_1', status: 'succeeded' }],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockDetail,
    } as any);

    const res = await client.getScheduledPayment('sched_1');
    expect(res).toEqual(mockDetail);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/schedules/sched_1`,
      expect.anything()
    );
  });

  it('calls createScheduledPayment endpoint', async () => {
    const mockInput = {
      from_account: 'cooper',
      to_account: 'scotty',
      amount_units: 1000,
      schedule_type: 'one_off' as const,
      memo: 'Test memo',
    };
    const mockCreated = { id: 'sched_new', ...mockInput, status: 'active' };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockCreated,
    } as any);

    const res = await client.createScheduledPayment(mockInput);
    expect(res).toEqual(mockCreated);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/schedules`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(mockInput),
      })
    );
  });

  it('calls cancelScheduledPayment endpoint', async () => {
    const mockCancelled = { id: 'sched_1', status: 'cancelled' };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockCancelled,
    } as any);

    const res = await client.cancelScheduledPayment('sched_1', 'cooper');
    expect(res).toEqual(mockCancelled);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/schedules/sched_1/cancel`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ caller_account: 'cooper' }),
      })
    );
  });

  it('calls processDueScheduledPayments endpoint', async () => {
    const mockResult = {
      processed_count: 1,
      succeeded_count: 1,
      failed_count: 0,
      skipped_count: 0,
      executions: [],
    };

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => mockResult,
    } as any);

    const res = await client.processDueScheduledPayments('2026-10-16T12:00:00Z', 10);
    expect(res).toEqual(mockResult);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `${mockBaseUrl}/api/v1/schedules/process`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ now: '2026-10-16T12:00:00Z', block_height: 10 }),
      })
    );
  });
});
