import { describe, it, expect } from 'vitest'
import {
  formatDate, formatCurrency, isValidEmail,
  parseDueDate, getOneMonthBefore, getPayoffDate, getFirstInvoiceDate,
  calculateMinDeposit, calculateDeposit, getWarnings,
  DEFAULT_FIXED_PRICE, MIN_DEPOSIT, MIN_MONTHLY_PAYMENT,
} from './utils'

// ── Formatting ─────────────────────────────────────────────

describe('formatCurrency', () => {
  it('formats whole dollar amounts with commas', () => {
    expect(formatCurrency(8500)).toBe('$8,500');
    expect(formatCurrency(250)).toBe('$250');
    expect(formatCurrency(10000)).toBe('$10,000');
  });

  it('formats zero', () => {
    expect(formatCurrency(0)).toBe('$0');
  });

  it('rounds to nearest dollar', () => {
    expect(formatCurrency(1275.6)).toBe('$1,276');
    expect(formatCurrency(1275.4)).toBe('$1,275');
  });
})

describe('formatDate', () => {
  it('formats dates in en-US short format', () => {
    const date = new Date(2026, 5, 15); // June 15, 2026
    expect(formatDate(date)).toBe('Jun 15, 2026');
  });

  it('handles single-digit days', () => {
    const date = new Date(2026, 0, 5); // Jan 5, 2026
    expect(formatDate(date)).toBe('Jan 5, 2026');
  });
})

// ── Validation ─────────────────────────────────────────────

describe('isValidEmail', () => {
  it('accepts valid emails', () => {
    expect(isValidEmail('test@example.com')).toBe(true);
    expect(isValidEmail('user.name@domain.co')).toBe(true);
    expect(isValidEmail('a@b.c')).toBe(true);
    expect(isValidEmail('user+tag@example.com')).toBe(true);
  });

  it('rejects invalid emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('@domain.com')).toBe(false);
    expect(isValidEmail('user@')).toBe(false);
    expect(isValidEmail('user @domain.com')).toBe(false);
    expect(isValidEmail('user@ domain.com')).toBe(false);
  });
})

// ── Date helpers ───────────────────────────────────────────

describe('parseDueDate', () => {
  it('parses YYYY-MM-DD to local midnight', () => {
    const date = parseDueDate('2026-06-15');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(5); // June = 5 (0-indexed)
    expect(date.getDate()).toBe(15);
    expect(date.getHours()).toBe(0);
    expect(date.getMinutes()).toBe(0);
  });
})

describe('getOneMonthBefore', () => {
  it('returns one month before', () => {
    const result = getOneMonthBefore(new Date(2026, 5, 15)); // June 15
    expect(result.getMonth()).toBe(4); // May
    expect(result.getDate()).toBe(15);
  });

  it('handles January to December rollover', () => {
    const result = getOneMonthBefore(new Date(2026, 0, 15)); // Jan 15, 2026
    expect(result.getMonth()).toBe(11); // December
    expect(result.getFullYear()).toBe(2025);
  });

  it('does not mutate the input', () => {
    const date = new Date(2026, 5, 15);
    const originalTime = date.getTime();
    getOneMonthBefore(date);
    expect(date.getTime()).toBe(originalTime);
  });
})

describe('getPayoffDate', () => {
  it('returns a future date', () => {
    const result = getPayoffDate(6);
    expect(result > new Date()).toBe(true);
  });

  it('adds 30 days plus N months from today', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 30);
    expected.setMonth(expected.getMonth() + 3);

    const result = getPayoffDate(3);
    // Allow 1 second tolerance for execution time
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });
})

describe('getFirstInvoiceDate', () => {
  it('returns 30 days from now', () => {
    const expected = new Date();
    expected.setDate(expected.getDate() + 30);

    const result = getFirstInvoiceDate();
    expect(Math.abs(result.getTime() - expected.getTime())).toBeLessThan(1000);
  });
})

// ── Business logic ─────────────────────────────────────────

describe('calculateMinDeposit', () => {
  it('returns 10% for fixed price mode when above $250', () => {
    expect(calculateMinDeposit(8500, false)).toBe(850);
    expect(calculateMinDeposit(4000, false)).toBe(400);
  });

  it('returns $250 floor when 10% is below it', () => {
    expect(calculateMinDeposit(2000, false)).toBe(MIN_DEPOSIT);
  });

  it('returns $250 for sliding scale (no percent minimum)', () => {
    expect(calculateMinDeposit(8500, true)).toBe(MIN_DEPOSIT);
    expect(calculateMinDeposit(4000, true)).toBe(MIN_DEPOSIT);
  });

  it('returns $250 for the default fixed price', () => {
    expect(calculateMinDeposit(DEFAULT_FIXED_PRICE, false)).toBe(850);
  });
})

describe('calculateDeposit', () => {
  it('uses preset percentage when no custom deposit', () => {
    expect(calculateDeposit({
      customDeposit: null,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.25,
    })).toBe(2125); // 25% of 8500
  });

  it('uses 10% preset correctly', () => {
    expect(calculateDeposit({
      customDeposit: null,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.10,
    })).toBe(850);
  });

  it('uses 50% preset correctly', () => {
    expect(calculateDeposit({
      customDeposit: null,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.50,
    })).toBe(4250);
  });

  it('enforces minimum deposit amount with preset', () => {
    expect(calculateDeposit({
      customDeposit: null,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.05, // 5% = 425, below 850 min
    })).toBe(850);
  });

  it('uses custom deposit when provided', () => {
    expect(calculateDeposit({
      customDeposit: 2000,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.10,
    })).toBe(2000);
  });

  it('clamps custom deposit to minimum', () => {
    expect(calculateDeposit({
      customDeposit: 100,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.10,
    })).toBe(850);
  });

  it('clamps custom deposit to total price', () => {
    expect(calculateDeposit({
      customDeposit: 10000,
      minDepositAmount: 850,
      totalPrice: 8500,
      depositPercent: 0.10,
    })).toBe(8500);
  });
})

describe('getWarnings', () => {
  const baseParams = {
    customDeposit: null,
    minDepositAmount: 850,
    deposit: 850,
    totalPrice: 8500,
    isSlidingScale: false,
    monthlyPayment: 500,
    dueDate: null,
    payoffDate: new Date(),
  };

  it('returns no warnings for a valid plan', () => {
    const result = getWarnings(baseParams);
    expect(result.hasWarning).toBe(false);
    expect(result.pastDueDate).toBe(false);
    expect(result.belowMinPayment).toBe(false);
    expect(result.depositBelowMin).toBe(false);
    expect(result.depositBelowPercent).toBe(false);
    expect(result.depositExceedsTotal).toBe(false);
  });

  it('warns when payoff is past due date', () => {
    const futurePayoff = new Date();
    futurePayoff.setFullYear(futurePayoff.getFullYear() + 2);

    const result = getWarnings({
      ...baseParams,
      dueDate: '2026-03-01',
      payoffDate: futurePayoff,
    });
    expect(result.pastDueDate).toBe(true);
    expect(result.hasWarning).toBe(true);
  });

  it('does not warn when payoff is before due date', () => {
    const result = getWarnings({
      ...baseParams,
      dueDate: '2099-12-31',
      payoffDate: new Date(),
    });
    expect(result.pastDueDate).toBe(false);
  });

  it('warns when monthly payment is below minimum', () => {
    const result = getWarnings({
      ...baseParams,
      monthlyPayment: MIN_MONTHLY_PAYMENT - 1,
    });
    expect(result.belowMinPayment).toBe(true);
    expect(result.hasWarning).toBe(true);
  });

  it('does not warn when monthly payment equals minimum', () => {
    const result = getWarnings({
      ...baseParams,
      monthlyPayment: MIN_MONTHLY_PAYMENT,
    });
    expect(result.belowMinPayment).toBe(false);
  });

  it('warns when custom deposit is below minimum', () => {
    const result = getWarnings({
      ...baseParams,
      customDeposit: 100,
      minDepositAmount: 850,
    });
    expect(result.depositBelowMin).toBe(true);
    expect(result.hasWarning).toBe(true);
  });

  it('does not warn about depositBelowMin when no custom deposit', () => {
    const result = getWarnings({
      ...baseParams,
      customDeposit: null,
    });
    expect(result.depositBelowMin).toBe(false);
  });

  it('warns when deposit is below 10% in fixed mode', () => {
    const result = getWarnings({
      ...baseParams,
      deposit: 500, // below 10% of 8500 = 850
      isSlidingScale: false,
    });
    expect(result.depositBelowPercent).toBe(true);
    expect(result.hasWarning).toBe(true);
  });

  it('does NOT warn about 10% in sliding scale mode', () => {
    const result = getWarnings({
      ...baseParams,
      deposit: 500,
      isSlidingScale: true,
    });
    expect(result.depositBelowPercent).toBe(false);
  });

  it('warns when custom deposit exceeds total price', () => {
    const result = getWarnings({
      ...baseParams,
      customDeposit: 10000,
      totalPrice: 8500,
    });
    expect(result.depositExceedsTotal).toBe(true);
    expect(result.hasWarning).toBe(true);
  });

  it('does not warn about exceeding total when no custom deposit', () => {
    const result = getWarnings({
      ...baseParams,
      customDeposit: null,
      totalPrice: 8500,
    });
    expect(result.depositExceedsTotal).toBe(false);
  });
})
