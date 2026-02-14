// ── Constants ──────────────────────────────────────────────

export const DEFAULT_FIXED_PRICE = 8500;
export const MIN_DEPOSIT = 250;
export const MIN_MONTHLY_PAYMENT = 250;
export const DEFAULT_SLIDING_SCALE_MAX = 8500;
export const SLIDING_SCALE_STEP = 250;
export const DEFAULT_MIN = 4000;
export const DEPOSIT_PRESETS = [0.10, 0.25, 0.50];
export const MAX_INSTALLMENT_MONTHS = 10;
export const MIN_INSTALLMENT_PAYMENT = MIN_MONTHLY_PAYMENT;
export const SUBMISSION_API_URL = import.meta.env.VITE_SUBMISSION_API_URL || 'https://s2pod1tkk6.execute-api.us-east-1.amazonaws.com/Default/price-submission';
export const IS_STRIPE_TEST_MODE = import.meta.env.VITE_STRIPE_TEST_MODE === 'true' || SUBMISSION_API_URL.includes('staging');

// ── Formatting ─────────────────────────────────────────────

export function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

export function formatCurrency(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount);
}

// ── Validation ─────────────────────────────────────────────

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── Date helpers ───────────────────────────────────────────

export function parseDueDate(dueDate) {
  return new Date(dueDate + 'T00:00:00');
}

export function getOneMonthBefore(date) {
  const d = new Date(date);
  d.setMonth(d.getMonth() - 1);
  return d;
}

export function getPayoffDate(months) {
  const payoff = new Date();
  payoff.setDate(payoff.getDate() + 30);
  payoff.setMonth(payoff.getMonth() + months);
  return payoff;
}

export function getFirstInvoiceDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

export function getMaxDueDate() {
  const d = new Date();
  d.setMonth(d.getMonth() + MAX_INSTALLMENT_MONTHS);
  return d;
}

export function getMinDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d;
}

// ── Installment validation ──────────────────────────────────

export function validateInstallmentDates(dates) {
  if (dates.length === 0) return { valid: false, reason: 'empty' };
  const minDate = getMinDueDate();
  minDate.setHours(0, 0, 0, 0);
  const maxDate = getMaxDueDate();
  maxDate.setHours(23, 59, 59, 999);

  const seen = new Set();
  for (const dateStr of dates) {
    if (!dateStr) return { valid: false, reason: 'missing_date' };
    const d = parseDueDate(dateStr);
    if (d < minDate) return { valid: false, reason: 'before_min' };
    if (d > maxDate) return { valid: false, reason: 'after_max' };
    const key = dateStr;
    if (seen.has(key)) return { valid: false, reason: 'duplicate' };
    seen.add(key);
  }
  return { valid: true };
}

export function validateInstallmentAmounts(amounts, remainder) {
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - remainder) > 0.01) return { valid: false, reason: 'sum_mismatch' };
  for (const amt of amounts) {
    if (amt < MIN_INSTALLMENT_PAYMENT) return { valid: false, reason: 'below_min' };
  }
  return { valid: true };
}

// ── URL parameters ─────────────────────────────────────────

export function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    isSlidingScale: params.get('slidingScale') === 'true',
    originalPrice: params.get('originalPrice') ? parseInt(params.get('originalPrice'), 10) : null,
    dueDate: params.get('dueDate') || null,
    isExtended: params.get('extended') === 'true',
    maxPrice: params.get('maxPrice') ? parseInt(params.get('maxPrice'), 10) : null,
    previewDone: params.get('preview') === 'done',
  };
}

// ── Business logic ─────────────────────────────────────────

export function calculateMinDeposit(totalPrice, isSlidingScale) {
  const minPercent = isSlidingScale ? 0 : 0.10;
  return Math.max(MIN_DEPOSIT, Math.round(totalPrice * minPercent));
}

export function calculateDeposit({ customDeposit, minDepositAmount, totalPrice, depositPercent }) {
  if (customDeposit !== null) {
    return Math.max(minDepositAmount, Math.min(customDeposit, totalPrice));
  }
  return Math.max(minDepositAmount, Math.round(totalPrice * depositPercent));
}

export function getWarnings({ customDeposit, minDepositAmount, deposit, totalPrice, isSlidingScale, monthlyPayment, dueDate, payoffDate }) {
  const depositBelowMin = customDeposit !== null && customDeposit < minDepositAmount;
  const depositBelowPercent = !isSlidingScale && deposit < Math.round(totalPrice * 0.10);
  const depositExceedsTotal = customDeposit !== null && customDeposit > totalPrice;
  const pastDueDate = !!(dueDate && payoffDate > parseDueDate(dueDate));
  const belowMinPayment = monthlyPayment < MIN_MONTHLY_PAYMENT;
  const hasWarning = pastDueDate || belowMinPayment || depositBelowMin || depositBelowPercent || depositExceedsTotal;

  return { depositBelowMin, depositBelowPercent, depositExceedsTotal, pastDueDate, belowMinPayment, hasWarning };
}

export function getInstallmentWarnings({
  customDeposit,
  minDepositAmount,
  deposit,
  totalPrice,
  isSlidingScale,
  installments,
  dueDate,
}) {
  const depositBelowMin = customDeposit !== null && customDeposit < minDepositAmount;
  const depositBelowPercent = !isSlidingScale && deposit < Math.round(totalPrice * 0.10);
  const depositExceedsTotal = customDeposit !== null && customDeposit > totalPrice;

  const remainder = totalPrice - deposit;
  const amounts = installments.map((i) => i.amount);
  const dates = installments.map((i) => i.dueDate);

  const datesValidation = validateInstallmentDates(dates);
  const amountsValidation = validateInstallmentAmounts(amounts, remainder);

  const dateBeforeMin = datesValidation.reason === 'before_min';
  const dateAfterMax = datesValidation.reason === 'after_max';
  const duplicateDates = datesValidation.reason === 'duplicate';
  const sumMismatch = amountsValidation.reason === 'sum_mismatch';
  const belowMinInstallment = amountsValidation.reason === 'below_min';

  const lastDueDate = dates.length
    ? new Date(Math.max(...dates.map((d) => parseDueDate(d).getTime())))
    : null;
  const pastDueDate = !!(dueDate && lastDueDate && lastDueDate > parseDueDate(dueDate));

  const hasWarning =
    depositBelowMin ||
    depositBelowPercent ||
    depositExceedsTotal ||
    !datesValidation.valid ||
    !amountsValidation.valid ||
    pastDueDate;

  return {
    depositBelowMin,
    depositBelowPercent,
    depositExceedsTotal,
    dateBeforeMin,
    dateAfterMax,
    duplicateDates,
    sumMismatch,
    belowMinInstallment,
    pastDueDate,
    hasWarning,
  };
}
