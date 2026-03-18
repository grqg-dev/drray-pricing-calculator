// ── Constants ──────────────────────────────────────────────

export const DEFAULT_FIXED_PRICE = 9000;
export const MIN_DEPOSIT = 250;
export const MIN_MONTHLY_PAYMENT = 250;
export const DEFAULT_SLIDING_SCALE_MAX = 9000;
export const SLIDING_SCALE_STEP = 250;
export const DEFAULT_MIN = 4000;
export const DEPOSIT_PRESETS = [0.10, 0.25, 0.50];
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
