// ── Constants ──────────────────────────────────────────────

export const DEFAULT_FIXED_PRICE = 10000;
export const MIN_DEPOSIT = 250;
export const MIN_MONTHLY_PAYMENT = 250;
export const DEFAULT_SLIDING_SCALE_MAX = 10000;
export const SLIDING_SCALE_STEP = 250;
export const DEFAULT_MIN = 4000;
export const DEPOSIT_PRESETS = [0.10, 0.25, 0.50];
/** Deposits at or above this fraction of package price unlock custom (non-subscription) schedules */
export const CUSTOM_SCHEDULE_MIN_DEPOSIT_FRACTION = 0.50;
/** Months between equal payments offered once the deposit unlocks flexible schedules */
export const PAYMENT_INTERVALS = [1, 2, 3];
export const SUBMISSION_API_URL = import.meta.env.VITE_SUBMISSION_API_URL || 'https://s2pod1tkk6.execute-api.us-east-1.amazonaws.com/Default/price-submission';

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

// Whole-dollar input display: 2500 → "2,500"; empty stays empty
export function formatAmountInput(value) {
  if (value === '' || value === null || value === undefined) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

// Typed text → whole dollars ('' when no digits), ignoring commas, "$", and stray characters
export function parseAmountInput(text) {
  const digits = String(text).replace(/\D/g, '');
  return digits === '' ? '' : parseInt(digits, 10);
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

export function getTodayLocal() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function toDateInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Adds whole months, clamping to the month's last day (Jan 31 + 1 → Feb 28, not Mar 3)
export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastDay));
  return d;
}

// ── URL parameters ─────────────────────────────────────────

export function parseUrlParams() {
  const params = new URLSearchParams(window.location.search);
  return {
    isSlidingScale: params.get('slidingScale') === 'true',
    originalPrice: params.get('originalPrice') ? parseInt(params.get('originalPrice'), 10) : null,
    dueDate: params.get('dueDate') || null,
    extendedParam: params.get('extended'),
    maxPrice: params.get('maxPrice') ? parseInt(params.get('maxPrice'), 10) : null,
    previewDone: params.get('preview') === 'done',
  };
}

// ── Max payment term ───────────────────────────────────────

const DEFAULT_MAX_MONTHS = 9;
const EXTENDED_MAX_MONTHS = 18;

// `extended=12` caps at 12 months; `extended=true` (or any other truthy value) caps at 18.
export function getMaxMonths(extendedParam) {
  if (extendedParam === '12') return 12;
  if (extendedParam === 'true') return EXTENDED_MAX_MONTHS;
  return DEFAULT_MAX_MONTHS;
}

// ── Business logic ─────────────────────────────────────────

export function calculateDefaultSlidingPrice(min, max, step = SLIDING_SCALE_STEP) {
  const midpoint = (min + max) / 2;
  const snapped = Math.round(midpoint / step) * step;
  return Math.max(min, Math.min(max, snapped));
}

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

export function qualifiesForCustomSchedule(deposit, totalPrice) {
  return deposit >= Math.round(totalPrice * CUSTOM_SCHEDULE_MIN_DEPOSIT_FRACTION);
}

export function sumInstallmentAmounts(installments) {
  return installments.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
}

export function getCustomSchedulePayoffDate(installments) {
  let latest = null;
  for (const row of installments) {
    if (!row.dueDate) continue;
    const d = parseDueDate(row.dueDate);
    if (!latest || d > latest) latest = d;
  }
  return latest;
}

export function distributeInstallmentAmounts(remainder, count) {
  const n = Math.max(1, count);
  const base = Math.floor(remainder / n);
  const amounts = Array(n).fill(base);
  let leftover = remainder - base * n;
  for (let i = n - 1; i >= 0 && leftover > 0; i--) {
    amounts[i] += 1;
    leftover -= 1;
  }
  return amounts;
}

/**
 * Most equal payments allowed at a given spacing: the last one must land within the
 * plan's max term (same span as `maxMonths` monthly invoices), and each must meet the minimum.
 */
export function getMaxIntervalPayments({ intervalMonths, maxMonths, remainder }) {
  const byTerm = Math.floor((maxMonths - 1) / intervalMonths) + 1;
  const byMinPayment = Math.floor(remainder / MIN_MONTHLY_PAYMENT);
  return Math.max(1, Math.min(byTerm, byMinPayment));
}

/**
 * Equal payments every `intervalMonths`, starting with the first invoice date (~30 days out).
 * Same shape as custom installments so both submit as one invoice per payment.
 */
export function buildIntervalInstallments({ remainder, count, intervalMonths, start = getFirstInvoiceDate() }) {
  return distributeInstallmentAmounts(remainder, count).map((amount, i) => ({
    id: `installment-${i}`,
    amount,
    dueDate: toDateInputValue(addMonths(start, i * intervalMonths)),
  }));
}

/**
 * Seed a custom schedule between first invoice date (~30 days) and due date (or default payoff).
 */
export function suggestCustomInstallments({ remainder, dueDate, count = 3 }) {
  const start = getFirstInvoiceDate();
  const end = dueDate ? parseDueDate(dueDate) : getPayoffDate(6);
  const maxByMinPayment = Math.max(1, Math.floor(remainder / MIN_MONTHLY_PAYMENT));
  const paymentCount = Math.max(2, Math.min(count, maxByMinPayment, 8));
  const amounts = distributeInstallmentAmounts(remainder, paymentCount);
  const startMs = start.getTime();
  const endMs = Math.max(end.getTime(), startMs);
  const span = endMs - startMs;

  const dates = amounts.map((_, i) => {
    const t = paymentCount === 1 ? startMs : startMs + (span * i) / (paymentCount - 1);
    return toDateInputValue(new Date(t));
  });

  return amounts.map((amount, i) => ({
    id: `installment-${i}`,
    amount,
    dueDate: dates[i],
  }));
}

export function validateCustomSchedule({ installments, remainder, dueDate, today = getTodayLocal() }) {
  const incompleteRows = installments.length === 0 || installments.some(
    (row) => row.dueDate === '' || row.amount === '' || row.amount === null || row.amount === undefined
      || Number.isNaN(Number(row.amount)) || Number(row.amount) <= 0,
  );
  const allocated = sumInstallmentAmounts(installments);
  const remainderMismatch = !incompleteRows && allocated !== remainder;
  const belowMinPayment = installments.some((row) => {
    const amt = Number(row.amount);
    return !Number.isNaN(amt) && amt > 0 && amt < MIN_MONTHLY_PAYMENT;
  });
  const invalidDates = installments.some((row) => {
    if (!row.dueDate) return false;
    return parseDueDate(row.dueDate) < today;
  });
  const payoffDate = getCustomSchedulePayoffDate(installments);
  const pastDueDate = !!(dueDate && payoffDate && payoffDate > parseDueDate(dueDate));

  const hasWarning = incompleteRows || remainderMismatch || belowMinPayment || invalidDates || pastDueDate;

  return {
    incompleteRows,
    remainderMismatch,
    belowMinPayment,
    invalidDates,
    pastDueDate,
    allocated,
    payoffDate,
    hasWarning,
  };
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
