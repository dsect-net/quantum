/**
 * Quantum Credits Currency Formatting & Parsing
 *
 * Invariant: 1 credit = 100 integer units.
 * Always integer units, never floats.
 */

/**
 * Converts integer units to a standard decimal string (e.g. 1050 -> "10.50", -50 -> "-0.50")
 */
export function unitsToCredits(units: number): string {
  if (!Number.isFinite(units)) return '0.00';
  const isNegative = units < 0;
  const abs = Math.abs(Math.round(units));
  const whole = Math.floor(abs / 100);
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${isNegative ? '-' : ''}${whole.toLocaleString('en-US')}.${fraction}`;
}

/**
 * Formats units for display in the UI (e.g. "1,250.00 QC" or "+50.00 credits")
 */
export function formatCredits(
  units: number,
  options: {
    showUnit?: boolean;
    showSign?: boolean;
    unitLabel?: string;
  } = {}
): string {
  const { showUnit = true, showSign = false, unitLabel = 'QC' } = options;
  const isPositive = units > 0;
  const formatted = unitsToCredits(units);
  const signPrefix = showSign && isPositive ? '+' : '';
  const labelSuffix = showUnit ? ` ${unitLabel}` : '';
  return `${signPrefix}${formatted}${labelSuffix}`;
}

/**
 * Converts human-entered credit string or number into exact integer units.
 * Safely parses decimals without IEEE 754 floating point arithmetic issues.
 */
export function creditsToUnits(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return 0;
    input = input.toString();
  }

  const clean = input.trim();
  if (!clean) return 0;

  const isNegative = clean.startsWith('-');
  const unsigned = isNegative ? clean.slice(1) : clean;

  const parts = unsigned.split('.');
  if (parts.length > 2) return 0; // Malformed input

  const wholeStr = parts[0].replace(/,/g, '');
  const fractionStr = parts[1] || '';

  const whole = parseInt(wholeStr || '0', 10);
  if (isNaN(whole)) return 0;

  // Take up to 2 decimal places, pad with zeros if needed (e.g. "5" -> "50")
  const fractionNormalized = (fractionStr.slice(0, 2) + '00').slice(0, 2);
  const fraction = parseInt(fractionNormalized, 10);

  const units = whole * 100 + fraction;
  return isNegative ? -units : units;
}

/**
 * Bank-style formatting for internal account IDs:
 * e.g. "scotty" -> "QB-CHK-SCOTTY"
 * "scotty:savings" -> "QB-SAV-SCOTTY"
 */
export function formatBankAccountId(id: string, type?: 'checking' | 'savings' | 'system'): string {
  const isSavings = id.endsWith(':savings') || type === 'savings';
  const rawName = id.replace(/:savings$/, '').toUpperCase();
  const prefix = isSavings ? 'QB-SAV' : 'QB-CHK';
  return `${prefix}-${rawName}`;
}

/**
 * Formats basis points into human percentage (e.g. 250 bps -> "2.50%")
 */
export function formatBps(bps: number): string {
  if (!Number.isFinite(bps)) return '0.00%';
  const pct = (bps / 100).toFixed(2);
  return `${pct}%`;
}
