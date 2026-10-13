const signed = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' });

/**
 * A move's quantity change as sent, with its sign and a real minus sign: -1 → "−1", 2 → "+2".
 * Presentation only; no arithmetic on the value.
 */
export function signedQuantity(change: number): string {
  return signed.format(change).replace('-', '−');
}
