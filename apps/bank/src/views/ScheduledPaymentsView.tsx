import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAccount } from '../context/AccountContext.js';
import {
  ScheduledPayment,
  ScheduledPaymentExecution,
  ScheduleType,
} from '../types.js';
import { api } from '../api/client.js';
import {
  formatInterval,
  formatScheduleStatus,
  formatExecutionStatus,
  formatNextDue,
  validateScheduleInput,
  MIN_SCHEDULE_INTERVAL_SECONDS,
  MAX_ACTIVE_SCHEDULES_PER_ACCOUNT,
} from '../utils/schedules.js';
import {
  formatCredits,
  creditsToUnits,
  formatBankAccountId,
} from '../utils/currency.js';
import {
  CalendarClock,
  PlusCircle,
  RotateCcw,
  AlertCircle,
  History,
  Ban,
  ShieldCheck,
  Calendar,
} from 'lucide-react';
import { Modal } from '../components/Modal.js';
import { EmptyState } from '../components/EmptyState.js';

type StatusFilter = 'all' | 'active' | 'completed' | 'cancelled' | 'failed';

export const ScheduledPaymentsView: React.FC = () => {
  const { actingAccount, allAccounts, checkingBalance, refreshAll } = useAccount();

  const [schedules, setSchedules] = useState<ScheduledPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');

  // Create Modal State
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [recipientId, setRecipientId] = useState('');
  const [customRecipient, setCustomRecipient] = useState('');
  const [amountInput, setAmountInput] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('one_off');
  const [intervalSeconds, setIntervalSeconds] = useState<number>(60);
  const [customInterval, setCustomInterval] = useState<string>('');
  const [dueAtOffset, setDueAtOffset] = useState<'now' | '5m' | '1h' | '1d' | 'custom'>('now');
  const [customDueAt, setCustomDueAt] = useState('');
  const [memoInput, setMemoInput] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // Cancel Modal State
  const [scheduleToCancel, setScheduleToCancel] = useState<ScheduledPayment | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  // History Inspection Modal State
  const [inspectedSchedule, setInspectedSchedule] = useState<ScheduledPayment | null>(null);
  const [inspectedExecutions, setInspectedExecutions] = useState<ScheduledPaymentExecution[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  // Third party accounts eligible for scheduling
  const thirdPartyAccounts = useMemo(() => {
    if (!actingAccount) return [];
    return allAccounts.filter(
      (a) => a.id !== actingAccount.id && !a.id.endsWith(':savings') && a.kind !== 'system'
    );
  }, [allAccounts, actingAccount]);

  const loadSchedules = useCallback(async () => {
    if (!actingAccount) return;
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const list = await api.listScheduledPayments({ account: actingAccount.id });
      // Only keep schedules created by or targeting this account
      setSchedules(list);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to load scheduled payments');
      setSchedules([]);
    } finally {
      setIsLoading(false);
    }
  }, [actingAccount]);

  useEffect(() => {
    loadSchedules();
  }, [loadSchedules]);

  const activeSchedulesCount = useMemo(() => {
    if (!actingAccount) return 0;
    return schedules.filter(
      (s) => s.from_account === actingAccount.id && s.status === 'active'
    ).length;
  }, [schedules, actingAccount]);

  // Filtered list
  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (selectedStatus === 'all') return true;
      return s.status === selectedStatus;
    });
  }, [schedules, selectedStatus]);

  // Handle Create Submit
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actingAccount) return;
    setCreateError(null);

    const targetRecipient = recipientId === 'custom' ? customRecipient.trim() : recipientId.trim();
    const amountUnits = creditsToUnits(amountInput);

    let effectiveInterval = intervalSeconds;
    if (scheduleType === 'recurring' && intervalSeconds === -1) {
      effectiveInterval = parseInt(customInterval, 10) || 0;
    }

    // Determine first_due_at
    let firstDueAt: string | undefined = undefined;
    const now = new Date();
    if (scheduleType === 'one_off') {
      if (dueAtOffset === 'now') {
        firstDueAt = now.toISOString();
      } else if (dueAtOffset === '5m') {
        firstDueAt = new Date(now.getTime() + 5 * 60 * 1000).toISOString();
      } else if (dueAtOffset === '1h') {
        firstDueAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      } else if (dueAtOffset === '1d') {
        firstDueAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      } else if (dueAtOffset === 'custom' && customDueAt) {
        firstDueAt = new Date(customDueAt).toISOString();
      }
    }

    // Client-side validation
    const validation = validateScheduleInput({
      from_account: actingAccount.id,
      to_account: targetRecipient,
      amount_units: amountUnits,
      schedule_type: scheduleType,
      interval_seconds: scheduleType === 'recurring' ? effectiveInterval : undefined,
      active_schedules_count: activeSchedulesCount,
      first_due_at: firstDueAt,
    });

    if (!validation.isValid) {
      setCreateError(validation.error || 'Invalid schedule parameters');
      return;
    }

    try {
      setIsCreating(true);
      await api.createScheduledPayment({
        from_account: actingAccount.id,
        to_account: targetRecipient,
        amount_units: amountUnits,
        schedule_type: scheduleType,
        first_due_at: firstDueAt,
        interval_seconds: scheduleType === 'recurring' ? effectiveInterval : undefined,
        memo: memoInput.trim() || undefined,
        caller_account: actingAccount.id,
      });

      // Reset and close
      setIsCreateOpen(false);
      setRecipientId('');
      setCustomRecipient('');
      setAmountInput('');
      setMemoInput('');
      setScheduleType('one_off');
      setIntervalSeconds(60);
      setCustomInterval('');
      setDueAtOffset('now');
      setCustomDueAt('');
      await loadSchedules();
      await refreshAll();
    } catch (err: any) {
      // Surface API errors verbatim-ish
      setCreateError(err.message || 'Failed to create scheduled payment');
    } finally {
      setIsCreating(false);
    }
  };

  // Handle Cancel Submit
  const handleConfirmCancel = async () => {
    if (!scheduleToCancel || !actingAccount) return;
    try {
      setIsCancelling(true);
      setCancelError(null);
      const updated = await api.cancelScheduledPayment(
        scheduleToCancel.id,
        actingAccount.id
      );

      // Reflect cancelled state from API response
      setSchedules((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
      setScheduleToCancel(null);
      await refreshAll();
    } catch (err: any) {
      setCancelError(err.message || 'Failed to cancel scheduled payment');
    } finally {
      setIsCancelling(false);
    }
  };

  // Inspect History
  const handleInspectSchedule = async (schedule: ScheduledPayment) => {
    setInspectedSchedule(schedule);
    try {
      setIsLoadingHistory(true);
      const detail = await api.getScheduledPayment(schedule.id);
      setInspectedExecutions(detail.executions || []);
    } catch {
      setInspectedExecutions([]);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  if (!actingAccount) {
    return <div className="p-8 text-center text-xs text-neutral-400">Loading account...</div>;
  }

  return (
    <div data-testid="scheduled-payments-view" className="space-y-6">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-neutral-900 tracking-tight">
              Scheduled Payments
            </h2>
            <span
              data-testid="active-schedules-badge"
              className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-neutral-100 text-neutral-600"
            >
              {activeSchedulesCount} / {MAX_ACTIVE_SCHEDULES_PER_ACCOUNT} active
            </span>
          </div>
          <p className="text-xs text-neutral-500 mt-0.5">
            Automatic standing orders and future payments enforced directly on the ledger
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="refresh-schedules-button"
            onClick={loadSchedules}
            title="Refresh Schedules"
            className="p-2 border border-neutral-200 rounded-xl hover:bg-neutral-50 text-neutral-500 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <button
            type="button"
            data-testid="create-schedule-button"
            onClick={() => {
              setIsCreateOpen(true);
              setCreateError(null);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer"
          >
            <PlusCircle className="w-4 h-4" />
            <span>New Schedule</span>
          </button>
        </div>
      </div>

      {/* Protocol Bounds Notice Card */}
      <div
        data-testid="schedule-bounds-notice"
        className="p-4 bg-white border border-neutral-200/90 rounded-2xl text-xs text-neutral-600 shadow-2xs space-y-2"
      >
        <div className="flex items-center gap-2 font-medium text-neutral-800">
          <ShieldCheck className="w-4 h-4 text-emerald-600" />
          <span>Protocol Execution & Integrity Rules (Chunk 5)</span>
        </div>
        <p className="text-neutral-500 text-[11px] leading-relaxed">
          Schedules execute as signed standard ledger transfers when validators seal blocks.
          Recurring schedules that encounter insufficient balance are recorded as{' '}
          <span className="font-semibold text-neutral-700">skipped</span> (preserving the schedule for the next interval), while one-off orders mark as failed. Minimum interval:{' '}
          <span className="font-semibold text-neutral-700">{MIN_SCHEDULE_INTERVAL_SECONDS} seconds</span>. Maximum active limit:{' '}
          <span className="font-semibold text-neutral-700">{MAX_ACTIVE_SCHEDULES_PER_ACCOUNT} active schedules per account</span>.
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between border-b border-neutral-200/90 pb-2">
        <div className="flex items-center gap-1 text-xs font-medium">
          {(['all', 'active', 'completed', 'cancelled', 'failed'] as StatusFilter[]).map((tab) => (
            <button
              key={tab}
              type="button"
              data-testid={`schedule-filter-${tab}`}
              onClick={() => setSelectedStatus(tab)}
              className={`px-3 py-1.5 rounded-lg capitalize transition-colors cursor-pointer ${
                selectedStatus === tab
                  ? 'bg-neutral-900 text-white font-semibold'
                  : 'text-neutral-500 hover:text-neutral-800 hover:bg-neutral-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Schedules List */}
      <div
        data-testid="scheduled-payments-list"
        className="bg-white border border-neutral-200/90 rounded-2xl overflow-hidden shadow-2xs"
      >
        <div className="px-5 py-3.5 border-b border-neutral-100 flex items-center justify-between bg-neutral-50/60">
          <span className="text-xs font-semibold text-neutral-500 uppercase tracking-wider">
            Schedules ({filteredSchedules.length})
          </span>
          <span className="text-[11px] font-mono text-neutral-400">
            {formatBankAccountId(actingAccount.id)}
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-xs text-neutral-400">
            <div className="inline-block animate-spin rounded-full h-4 w-4 border-2 border-neutral-300 border-t-neutral-900 mr-2" />
            Loading scheduled orders...
          </div>
        ) : errorMsg ? (
          <div className="p-6 text-center text-xs text-rose-600 space-y-2">
            <AlertCircle className="w-5 h-5 mx-auto text-rose-500" />
            <p>{errorMsg}</p>
          </div>
        ) : filteredSchedules.length === 0 ? (
          <div className="p-8">
            <EmptyState
              icon={CalendarClock}
              title="No Scheduled Payments"
              description={
                selectedStatus === 'all'
                  ? 'You have not set up any standing or deferred payments yet.'
                  : `No scheduled payments with status '${selectedStatus}'.`
              }
            />
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {filteredSchedules.map((schedule) => {
              const statusCfg = formatScheduleStatus(schedule.status);
              const intervalText = formatInterval(schedule.interval_seconds, schedule.interval_blocks);
              const isCreator = schedule.from_account === actingAccount.id;

              return (
                <div
                  key={schedule.id}
                  data-testid={`schedule-card-${schedule.id}`}
                  className="p-4 hover:bg-neutral-50/70 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        schedule.schedule_type === 'recurring'
                          ? 'bg-violet-50 text-violet-700'
                          : 'bg-neutral-100 text-neutral-700'
                      }`}
                    >
                      {schedule.schedule_type === 'recurring' ? (
                        <RotateCcw className="w-4 h-4" />
                      ) : (
                        <Calendar className="w-4 h-4" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          data-testid={`schedule-status-${schedule.id}`}
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${statusCfg.badgeClass}`}
                        >
                          {statusCfg.label}
                        </span>

                        <span
                          data-testid={`schedule-interval-${schedule.id}`}
                          className="px-2 py-0.5 rounded text-[10px] font-medium bg-neutral-100 text-neutral-700"
                        >
                          {intervalText}
                        </span>

                        {schedule.memo && (
                          <span className="text-xs font-semibold text-neutral-900">
                            {schedule.memo}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 text-[11px] text-neutral-500 flex-wrap">
                        <span
                          data-testid={`schedule-recipient-${schedule.id}`}
                          className="font-medium text-neutral-700"
                        >
                          {isCreator ? `To: ${formatBankAccountId(schedule.to_account)}` : `From: ${formatBankAccountId(schedule.from_account)}`}
                        </span>
                        <span>•</span>
                        <span
                          data-testid={`schedule-next-due-${schedule.id}`}
                          className="font-mono text-[10px]"
                        >
                          Next Due: {formatNextDue(schedule.next_due_at)}
                        </span>
                        <span>•</span>
                        <span
                          data-testid={`schedule-executions-${schedule.id}`}
                          className="font-mono text-[10px] text-neutral-400"
                        >
                          {schedule.total_executions}{' '}
                          {schedule.total_executions === 1 ? 'execution' : 'executions'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-3 sm:pt-0 border-neutral-100">
                    <div className="text-left sm:text-right">
                      <div
                        data-testid={`schedule-amount-${schedule.id}`}
                        className="text-sm font-bold font-mono text-neutral-900"
                      >
                        {formatCredits(schedule.amount_units)}
                      </div>
                      <div className="text-[10px] font-mono text-neutral-400">
                        {schedule.amount_units.toLocaleString('en-US')} units
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        data-testid={`view-history-button-${schedule.id}`}
                        onClick={() => handleInspectSchedule(schedule)}
                        className="flex items-center gap-1 px-2.5 py-1.5 border border-neutral-200 rounded-lg text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors cursor-pointer"
                      >
                        <History className="w-3.5 h-3.5 text-neutral-500" />
                        <span>History</span>
                      </button>

                      {schedule.status === 'active' && isCreator && (
                        <button
                          type="button"
                          data-testid={`cancel-schedule-button-${schedule.id}`}
                          onClick={() => {
                            setScheduleToCancel(schedule);
                            setCancelError(null);
                          }}
                          className="flex items-center gap-1 px-2.5 py-1.5 border border-rose-200 bg-rose-50/50 text-rose-700 rounded-lg text-xs font-medium hover:bg-rose-100 transition-colors cursor-pointer"
                        >
                          <Ban className="w-3.5 h-3.5" />
                          <span>Cancel</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ===================================================================== */}
      {/* Create Schedule Modal */}
      {/* ===================================================================== */}
      <Modal
        isOpen={isCreateOpen}
        onClose={() => {
          if (!isCreating) {
            setIsCreateOpen(false);
            setCreateError(null);
          }
        }}
        title="New Scheduled Payment"
        subtitle="Authorize an automated future or recurring transfer on the ledger"
      >
        <form data-testid="create-schedule-form" onSubmit={handleCreateSchedule} className="space-y-4">
          {createError && (
            <div
              data-testid="schedule-create-error"
              className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <span>{createError}</span>
            </div>
          )}

          {/* Acting Account (Enforced Source) */}
          <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200/80 space-y-1">
            <div className="flex items-center justify-between text-xs text-neutral-500">
              <span>Originating Account:</span>
              <span className="font-semibold text-neutral-700">Acting Owner</span>
            </div>
            <div
              data-testid="schedule-from-account"
              className="font-mono text-xs font-semibold text-neutral-900"
            >
              {formatBankAccountId(actingAccount.id)} ({actingAccount.display_name})
            </div>
            <p className="text-[10px] text-neutral-400">
              Only the acting account may schedule payments from itself. Foreign authorization is strictly rejected.
            </p>
          </div>

          {/* Recipient Account */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">Recipient Account</label>
            <select
              data-testid="schedule-recipient-select"
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 cursor-pointer"
              required
            >
              <option value="">Select recipient...</option>
              {thirdPartyAccounts.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.display_name} ({formatBankAccountId(acc.id)})
                </option>
              ))}
              <option value="custom">+ Enter custom account ID...</option>
            </select>

            {recipientId === 'custom' && (
              <input
                data-testid="schedule-recipient-input"
                type="text"
                placeholder="e.g. scotty"
                value={customRecipient}
                onChange={(e) => setCustomRecipient(e.target.value)}
                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 mt-2"
                required
              />
            )}
          </div>

          {/* Amount Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-medium text-neutral-700">Amount (QC)</label>
              <span className="text-[11px] text-neutral-400">
                Checking bal: {formatCredits(checkingBalance?.available_units || 0)}
              </span>
            </div>
            <input
              data-testid="schedule-amount-input"
              type="text"
              inputMode="decimal"
              placeholder="0.00"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs font-mono text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
              required
            />
            <div
              data-testid="schedule-amount-integer-preview"
              className="text-[11px] text-neutral-500 font-mono"
            >
              Exact units: {creditsToUnits(amountInput).toLocaleString('en-US')} integer units
            </div>
          </div>

          {/* Schedule Type Toggle */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">Schedule Type</label>
            <div className="grid grid-cols-2 gap-1 p-1 bg-neutral-100 rounded-xl text-xs font-medium">
              <button
                type="button"
                data-testid="schedule-type-one-off"
                onClick={() => setScheduleType('one_off')}
                className={`py-1.5 rounded-lg transition-colors cursor-pointer ${
                  scheduleType === 'one_off'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                One-Off Future
              </button>
              <button
                type="button"
                data-testid="schedule-type-recurring"
                onClick={() => setScheduleType('recurring')}
                className={`py-1.5 rounded-lg transition-colors cursor-pointer ${
                  scheduleType === 'recurring'
                    ? 'bg-white text-neutral-900 shadow-2xs font-semibold'
                    : 'text-neutral-500 hover:text-neutral-700'
                }`}
              >
                Recurring Standing
              </button>
            </div>
          </div>

          {/* Type-Specific Settings */}
          {scheduleType === 'one_off' ? (
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-neutral-700">First Due Date / Time</label>
              <div className="grid grid-cols-4 gap-1 text-[11px] font-medium">
                {(
                  [
                    { id: 'now', label: 'Due Soon / Now' },
                    { id: '5m', label: '+5 Mins' },
                    { id: '1h', label: '+1 Hour' },
                    { id: '1d', label: '+1 Day' },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    data-testid={`due-offset-${opt.id}`}
                    onClick={() => setDueAtOffset(opt.id)}
                    className={`py-1.5 rounded-lg border text-center transition-colors cursor-pointer ${
                      dueAtOffset === opt.id
                        ? 'border-neutral-900 bg-neutral-900 text-white font-semibold'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-600 hover:bg-neutral-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-medium text-neutral-700">Recurrence Interval</label>
                <span className="text-[10px] text-neutral-400">Min 60 seconds</span>
              </div>
              <select
                data-testid="schedule-interval-select"
                value={intervalSeconds}
                onChange={(e) => setIntervalSeconds(Number(e.target.value))}
                className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 cursor-pointer"
              >
                <option value={60}>Every 60 seconds (1 min)</option>
                <option value={300}>Every 5 minutes (300s)</option>
                <option value={3600}>Every 1 hour (3600s)</option>
                <option value={86400}>Daily (24 hours)</option>
                <option value={604800}>Weekly (7 days)</option>
                <option value={-1}>+ Custom interval (seconds)...</option>
              </select>

              {intervalSeconds === -1 && (
                <input
                  data-testid="schedule-custom-interval-input"
                  type="number"
                  min={60}
                  placeholder="Interval in seconds (>= 60)"
                  value={customInterval}
                  onChange={(e) => setCustomInterval(e.target.value)}
                  className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs font-mono text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900 mt-2"
                  required
                />
              )}
            </div>
          )}

          {/* Memo */}
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-neutral-700">Optional Memo</label>
            <input
              data-testid="schedule-memo-input"
              type="text"
              placeholder="e.g. Monthly maintenance retainer"
              value={memoInput}
              onChange={(e) => setMemoInput(e.target.value)}
              className="w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-xs text-neutral-900 focus:outline-none focus:ring-1 focus:ring-neutral-900"
            />
          </div>

          <div className="pt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              disabled={isCreating}
              className="flex-1 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs font-medium text-neutral-700 hover:bg-neutral-50 transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              data-testid="submit-create-schedule-button"
              type="submit"
              disabled={isCreating}
              className="flex-1 py-2.5 bg-neutral-900 text-white rounded-xl text-xs font-semibold hover:bg-neutral-800 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
            >
              {isCreating ? 'Creating Order...' : 'Create Scheduled Payment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ===================================================================== */}
      {/* Cancel Confirmation Modal */}
      {/* ===================================================================== */}
      <Modal
        isOpen={Boolean(scheduleToCancel)}
        onClose={() => {
          if (!isCancelling) setScheduleToCancel(null);
        }}
        title="Cancel Scheduled Payment"
        subtitle="This action will permanently cancel future occurrences of this schedule."
      >
        {scheduleToCancel && (
          <div data-testid="cancel-schedule-modal" className="space-y-4">
            {cancelError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-700">
                {cancelError}
              </div>
            )}

            <div className="p-4 bg-neutral-50 rounded-xl border border-neutral-200/90 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-neutral-500">Recipient:</span>
                <span className="font-semibold text-neutral-900">
                  {formatBankAccountId(scheduleToCancel.to_account)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Amount:</span>
                <span className="font-mono font-bold text-neutral-900">
                  {formatCredits(scheduleToCancel.amount_units)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-500">Interval:</span>
                <span className="font-medium text-neutral-800">
                  {formatInterval(scheduleToCancel.interval_seconds, scheduleToCancel.interval_blocks)}
                </span>
              </div>
            </div>

            <p className="text-xs text-neutral-600">
              Are you sure you want to cancel this scheduled order? No further transfers will be executed.
            </p>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setScheduleToCancel(null)}
                disabled={isCancelling}
                className="flex-1 py-2.5 bg-white border border-neutral-200 rounded-xl text-xs font-medium text-neutral-700 hover:bg-neutral-50 cursor-pointer"
              >
                Keep Schedule
              </button>
              <button
                data-testid="confirm-cancel-schedule-button"
                type="button"
                onClick={handleConfirmCancel}
                disabled={isCancelling}
                className="flex-1 py-2.5 bg-rose-600 text-white rounded-xl text-xs font-semibold hover:bg-rose-700 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              >
                {isCancelling ? 'Cancelling...' : 'Confirm Cancellation'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ===================================================================== */}
      {/* Schedule Execution History Modal */}
      {/* ===================================================================== */}
      <Modal
        isOpen={Boolean(inspectedSchedule)}
        onClose={() => setInspectedSchedule(null)}
        title="Schedule Execution History"
        subtitle={inspectedSchedule ? `Order ID: ${inspectedSchedule.id}` : ''}
      >
        {inspectedSchedule && (
          <div data-testid="schedule-history-modal" className="space-y-4">
            {/* Summary Banner */}
            <div className="p-3 bg-neutral-50 border border-neutral-200/90 rounded-xl text-xs space-y-1">
              <div className="flex justify-between items-center">
                <span className="text-neutral-500">Amount & Recipient:</span>
                <span className="font-bold text-neutral-900">
                  {formatCredits(inspectedSchedule.amount_units)} to {formatBankAccountId(inspectedSchedule.to_account)}
                </span>
              </div>
              <div className="flex justify-between items-center text-[11px] text-neutral-400">
                <span>Total Executions: {inspectedSchedule.total_executions}</span>
                <span>Type: {formatInterval(inspectedSchedule.interval_seconds, inspectedSchedule.interval_blocks)}</span>
              </div>
            </div>

            {/* Execution Occurrences */}
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-neutral-700">Execution Occurrences</h4>

              {isLoadingHistory ? (
                <div className="p-6 text-center text-xs text-neutral-400">
                  Loading occurrences...
                </div>
              ) : inspectedExecutions.length === 0 ? (
                <div className="p-6 text-center text-xs text-neutral-400 border border-neutral-200/60 rounded-xl">
                  No execution occurrences recorded yet.
                </div>
              ) : (
                <div
                  data-testid="execution-occurrence-list"
                  className="space-y-2 max-h-60 overflow-y-auto pr-1"
                >
                  {inspectedExecutions.map((exec) => {
                    const statusInfo = formatExecutionStatus(exec.status, exec.reason);

                    return (
                      <div
                        key={exec.id}
                        data-testid={`occurrence-row-${exec.id}`}
                        className="p-3 border border-neutral-200/80 rounded-xl bg-white space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider border ${statusInfo.badgeClass}`}
                          >
                            {statusInfo.label}
                          </span>
                          <span className="text-[10px] text-neutral-400 font-mono">
                            {new Date(exec.executed_at).toLocaleString()}
                          </span>
                        </div>

                        <p className="text-xs text-neutral-700">{statusInfo.explanation}</p>

                        {exec.tx_id && (
                          <div
                            data-testid={`occurrence-tx-${exec.id}`}
                            className="text-[10px] font-mono text-neutral-500 bg-neutral-50 px-2 py-1 rounded"
                          >
                            TX: {exec.tx_id}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setInspectedSchedule(null)}
                className="w-full py-2 bg-neutral-900 text-white rounded-xl text-xs font-medium hover:bg-neutral-800 transition-colors cursor-pointer"
              >
                Close History
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
