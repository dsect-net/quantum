import { formatCredits } from './currency.js';

export interface TransferValidationInput {
  from_account: string;
  to_account: string;
  amount_units: number;
  available_units: number;
}

export interface ValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Validates a proposed transfer against the Quantum Credits ledger protocol rules.
 */
export function validateTransfer(input: TransferValidationInput): ValidationResult {
  const { from_account, to_account, amount_units, available_units } = input;

  if (!from_account || !from_account.trim()) {
    return { isValid: false, error: 'Source account is required.' };
  }

  if (!to_account || !to_account.trim()) {
    return { isValid: false, error: 'Destination account is required.' };
  }

  if (amount_units <= 0) {
    return { isValid: false, error: 'Transfer amount must be greater than zero.' };
  }

  if (!Number.isInteger(amount_units)) {
    return { isValid: false, error: 'Transfer amount must be in exact integer units (no partial cents).' };
  }

  if (from_account.trim() === to_account.trim()) {
    return { isValid: false, error: 'Self-transfer is forbidden. Source and destination accounts cannot be identical.' };
  }

  if (amount_units > available_units) {
    return {
      isValid: false,
      error: `Insufficient available funds: available balance is ${formatCredits(available_units)}, but transfer requires ${formatCredits(amount_units)}.`,
    };
  }

  // Savings account protocol restrictions (Amendment A4)
  const isFromSavings = from_account.endsWith(':savings');
  const isToSavings = to_account.endsWith(':savings');

  if (isFromSavings) {
    const ownerId = from_account.replace(/:savings$/, '');
    if (to_account !== ownerId) {
      return {
        isValid: false,
        error: `Savings accounts cannot transfer directly to third parties. Funds must be moved to your checking account (${ownerId}) first.`,
      };
    }
  }

  if (isToSavings) {
    const ownerId = to_account.replace(/:savings$/, '');
    if (from_account !== ownerId) {
      return {
        isValid: false,
        error: `Direct transfers into third-party savings accounts are not permitted. Only the owner (${ownerId}) may fund their savings account.`,
      };
    }
  }

  return { isValid: true };
}
