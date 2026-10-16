/**
 * Quantum Credits Currency Formatting & Parsing
 *
 * Denomination invariant:
 * 1 credit = 100 units.
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
 * Formats units for display in the UI (e.g. "1,250.00 credits" or "+50.00 credits")
 */
export function formatCredits(
  units: number,
  options: {
    showUnit?: boolean;
    showSign?: boolean;
    unitLabel?: string;
  } = {}
): string {
  const { showUnit = true, showSign = false, unitLabel = 'credits' } = options;
  const isPositive = units > 0;
  const formatted = unitsToCredits(units);
  const signPrefix = showSign && isPositive ? '+' : '';
  const labelSuffix = showUnit ? ` ${unitLabel}` : '';
  return `${signPrefix}${formatted}${labelSuffix}`;
}

/**
 * Converts a human-entered credit string or number into exact integer units.
 * Safely parses decimals without IEEE 754 floating point arithmetic issues.
 * Examples:
 *   "10" -> 1000
 *   "10.5" -> 1050
 *   "10.50" -> 1050
 *   "0.05" -> 5
 *   "-5.25" -> -525
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
