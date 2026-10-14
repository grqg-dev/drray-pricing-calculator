import { readFileSync } from 'fs'
import { describe, it, expect } from 'vitest'
import { createRequire } from 'module'
import {
  canonicalLockMessage as clientLockMessage,
  parseLockQuery,
  describeLockState,
  signatureMatches,
  isLockExpired,
} from './lock'
import {
  formatDate, formatCurrency, isValidEmail,
  parseDueDate, getOneMonthBefore, getPayoffDate, getFirstInvoiceDate,
  calculateDefaultSlidingPrice, calculateMinDeposit, calculateDeposit, getWarnings,
  getMaxMonths, qualifiesForCustomSchedule, formatAmountInput, parseAmountInput,
  addMonths, getMaxIntervalPayments, buildIntervalInstallments, distributeInstallmentAmounts,
  suggestCustomInstallments, validateCustomSchedule, sumInstallmentAmounts,
  DEFAULT_FIXED_PRICE, MIN_DEPOSIT, MIN_MONTHLY_PAYMENT, CUSTOM_SCHEDULE_MIN_DEPOSIT_FRACTION,
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

describe('calculateDefaultSlidingPrice', () => {
  it('defaults to the midpoint of the range', () => {
    expect(calculateDefaultSlidingPrice(6000, 10000)).toBe(8000);
    expect(calculateDefaultSlidingPrice(4000, 9000)).toBe(6500);
  });

  it('snaps to the nearest step increment', () => {
    expect(calculateDefaultSlidingPrice(4000, 8500)).toBe(6250);
    expect(calculateDefaultSlidingPrice(4000, 9100)).toBe(6500);
  });

  it('clamps to min and max when snapping would exceed bounds', () => {
    expect(calculateDefaultSlidingPrice(6000, 6250)).toBe(6250);
    expect(calculateDefaultSlidingPrice(6000, 6000)).toBe(6000);
  });
});

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
    expect(calculateMinDeposit(DEFAULT_FIXED_PRICE, false)).toBe(1000);
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

// ── Max payment term ───────────────────────────────────────

describe('qualifiesForCustomSchedule', () => {
  it('qualifies at exactly 50%', () => {
    expect(qualifiesForCustomSchedule(5000, 10000)).toBe(true);
  });

  it('does not qualify below 50%', () => {
    expect(qualifiesForCustomSchedule(4999, 10000)).toBe(false);
    expect(qualifiesForCustomSchedule(2500, 10000)).toBe(false);
  });
});

describe('distributeInstallmentAmounts', () => {
  it('splits remainder into whole dollars that sum to remainder', () => {
    expect(distributeInstallmentAmounts(5000, 3)).toEqual([1666, 1667, 1667]);
    expect(distributeInstallmentAmounts(100, 3).reduce((a, b) => a + b, 0)).toBe(100);
  });
});

describe('validateCustomSchedule', () => {
  const remainder = 6000;
  const validInstallments = [
    { id: 'a', amount: 3000, dueDate: '2026-08-01' },
    { id: 'b', amount: 3000, dueDate: '2026-09-01' },
  ];

  it('accepts a schedule that sums to remainder and is before due date', () => {
    const result = validateCustomSchedule({
      installments: validInstallments,
      remainder,
      dueDate: '2026-10-01',
      today: new Date(2026, 0, 1),
    });
    expect(result.hasWarning).toBe(false);
    expect(result.remainderMismatch).toBe(false);
  });

  it('warns when amounts do not sum to remainder', () => {
    const result = validateCustomSchedule({
      installments: [{ id: 'a', amount: 2000, dueDate: '2026-08-01' }],
      remainder,
      dueDate: null,
      today: new Date(2026, 0, 1),
    });
    expect(result.remainderMismatch).toBe(true);
    expect(result.hasWarning).toBe(true);
  });

  it('warns when last payment is after due date', () => {
    const result = validateCustomSchedule({
      installments: validInstallments,
      remainder,
      dueDate: '2026-08-15',
      today: new Date(2026, 0, 1),
    });
    expect(result.pastDueDate).toBe(true);
  });

  it('warns when a payment is due less than 15 days from today', () => {
    const result = validateCustomSchedule({
      installments: [
        { id: 'a', amount: 3000, dueDate: '2026-01-15' },
        { id: 'b', amount: 3000, dueDate: '2026-02-01' },
      ],
      remainder,
      dueDate: null,
      today: new Date(2026, 0, 1),
    });
    expect(result.invalidDates).toBe(true);
  });

  it('accepts a payment due exactly 15 days from today', () => {
    const result = validateCustomSchedule({
      installments: [
        { id: 'a', amount: 3000, dueDate: '2026-01-16' },
        { id: 'b', amount: 3000, dueDate: '2026-02-01' },
      ],
      remainder,
      dueDate: null,
      today: new Date(2026, 0, 1),
    });
    expect(result.invalidDates).toBe(false);
  });

  it('warns when a payment is below minimum', () => {
    const result = validateCustomSchedule({
      installments: [
        { id: 'a', amount: 200, dueDate: '2026-08-01' },
        { id: 'b', amount: 5800, dueDate: '2026-09-01' },
      ],
      remainder: 6000,
      dueDate: null,
      today: new Date(2026, 0, 1),
    });
    expect(result.belowMinPayment).toBe(true);
  });
});

describe('suggestCustomInstallments', () => {
  it('returns installments that sum to the remainder', () => {
    const rows = suggestCustomInstallments({ remainder: 7500, dueDate: '2027-01-01' });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(sumInstallmentAmounts(rows)).toBe(7500);
    rows.forEach((row) => {
      expect(row.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(row.amount).toBeGreaterThanOrEqual(MIN_MONTHLY_PAYMENT);
    });
  });
});

describe('getMaxMonths', () => {
  it('defaults to 9 months when extended param is absent', () => {
    expect(getMaxMonths(null)).toBe(9);
  });

  it('caps at 3 or 6 months when asked', () => {
    expect(getMaxMonths('3')).toBe(3);
    expect(getMaxMonths('6')).toBe(6);
  });

  it('caps at 12 months for extended=12', () => {
    expect(getMaxMonths('12')).toBe(12);
  });

  it('caps at 18 months for extended=true', () => {
    expect(getMaxMonths('true')).toBe(18);
  });

  it('falls back to 9 months for an unrecognized extended value', () => {
    expect(getMaxMonths('false')).toBe(9);
    expect(getMaxMonths('18')).toBe(9);
  });
})

describe('formatAmountInput', () => {
  it('adds thousands separators', () => {
    expect(formatAmountInput(2500)).toBe('2,500');
    expect(formatAmountInput(10000)).toBe('10,000');
    expect(formatAmountInput(250)).toBe('250');
  });

  it('keeps empty values empty', () => {
    expect(formatAmountInput('')).toBe('');
    expect(formatAmountInput(null)).toBe('');
  });
})

describe('parseAmountInput', () => {
  it('reads formatted text back to whole dollars', () => {
    expect(parseAmountInput('2,500')).toBe(2500);
    expect(parseAmountInput('$10,000')).toBe(10000);
  });

  it('returns empty string when there are no digits', () => {
    expect(parseAmountInput('')).toBe('');
    expect(parseAmountInput('$,')).toBe('');
  });
})

describe('addMonths', () => {
  it('adds months on an ordinary day', () => {
    expect(addMonths(new Date(2026, 10, 2), 2)).toEqual(new Date(2027, 0, 2));
  });

  it('clamps to the last day of a shorter month', () => {
    expect(addMonths(new Date(2027, 0, 31), 1)).toEqual(new Date(2027, 1, 28));
    expect(addMonths(new Date(2026, 7, 31), 3)).toEqual(new Date(2026, 10, 30));
  });
})

describe('getMaxIntervalPayments', () => {
  it('fits payments inside the default 9-month term', () => {
    expect(getMaxIntervalPayments({ intervalMonths: 1, maxMonths: 9, remainder: 7500 })).toBe(9);
    expect(getMaxIntervalPayments({ intervalMonths: 2, maxMonths: 9, remainder: 7500 })).toBe(5);
    expect(getMaxIntervalPayments({ intervalMonths: 3, maxMonths: 9, remainder: 7500 })).toBe(3);
  });

  it('allows more payments on an extended term', () => {
    expect(getMaxIntervalPayments({ intervalMonths: 2, maxMonths: 18, remainder: 7500 })).toBe(9);
  });

  it('caps the count so each payment meets the minimum', () => {
    expect(getMaxIntervalPayments({ intervalMonths: 1, maxMonths: 9, remainder: 1000 })).toBe(4);
  });

  it('always allows at least one payment', () => {
    expect(getMaxIntervalPayments({ intervalMonths: 2, maxMonths: 9, remainder: 100 })).toBe(1);
  });
})

const require = createRequire(import.meta.url)
const {
  canonicalLockMessage: apiLockMessage,
  signLock,
  verifyLockSignature,
  gateLockedRequest,
  buildLockedUrl,
  PUBLIC_LOCK_ERROR,
} = require('../api/lock-link.js')

const LOCK_SECRET = 'test-lock-secret'

describe('locked price links', () => {
  it('uses the same signed message in the page and the Lambda', () => {
    const fields = { maxPrice: 6000, deposit: 3000, exp: null }
    expect(clientLockMessage(fields)).toBe('v1|6000|3000|')
    expect(clientLockMessage(fields)).toBe(apiLockMessage(fields))
    expect(clientLockMessage({ ...fields, exp: 1893456000 })).toBe('v1|6000|3000|1893456000')
  })

  it('signs a $6,000 total with a $3,000 deposit and locks the page', async () => {
    const url = buildLockedUrl({
      appUrl: 'https://payment-calculator.drjuliaray.com',
      maxPrice: 6000,
      deposit: 3000,
      secret: LOCK_SECRET,
    })
    const query = parseLockQuery(url.slice(url.indexOf('?')))
    expect(url).toContain('maxPrice=6000')
    expect(url).toContain('deposit=3000')
    expect(url).toContain('lock=1')
    expect(verifyLockSignature(query, LOCK_SECRET).ok).toBe(true)
    expect(await signatureMatches(query, LOCK_SECRET)).toBe(true)
    expect(describeLockState(query, true)).toEqual({
      mode: 'locked',
      total: 6000,
      deposit: 3000,
      priceEditable: false,
      depositEditable: false,
      showPayInFull: false,
      showScheduleCards: true,
    })
  })

  it('shows pay in full only when the locked deposit is the whole total', () => {
    const sig = signLock({ maxPrice: 6000, deposit: 6000, exp: null }, LOCK_SECRET)
    const query = parseLockQuery(`?maxPrice=6000&deposit=6000&lock=1&sig=${sig}`)
    expect(describeLockState(query, true)).toMatchObject({
      mode: 'locked',
      showPayInFull: true,
      showScheduleCards: false,
      depositEditable: false,
    })
  })

  it('keeps a smaller locked deposit on the monthly slider', () => {
    const state = describeLockState({
      requested: true, maxPrice: 6000, deposit: 600, exp: null, sig: 'x',
    }, true)
    expect(state).toMatchObject({
      mode: 'locked',
      showPayInFull: false,
      showScheduleCards: false,
      priceEditable: false,
      depositEditable: false,
    })
  })

  it('leaves links without lock params open', () => {
    const query = parseLockQuery('?maxPrice=6000&dueDate=2026-08-01')
    expect(query.requested).toBe(false)
    expect(describeLockState(query, false)).toMatchObject({
      mode: 'open',
      priceEditable: true,
      depositEditable: true,
      showPayInFull: true,
    })
  })

  it('rejects a signed param that was edited', async () => {
    const sig = signLock({ maxPrice: 6000, deposit: 3000, exp: null }, LOCK_SECRET)
    const cases = [
      `?maxPrice=1000&deposit=3000&lock=1&sig=${sig}`,
      `?maxPrice=6000&deposit=1000&lock=1&sig=${sig}`,
      `?maxPrice=6000&deposit=3000&lock=1&exp=1893456000&sig=${sig}`,
      `?maxPrice=6000&deposit=3000&lock=1&sig=${sig}x`,
    ]
    for (const search of cases) {
      const query = parseLockQuery(search)
      expect(verifyLockSignature(query, LOCK_SECRET).ok).toBe(false)
      expect(describeLockState(query, false).mode).toBe('invalid')
    }
    const query = parseLockQuery(`?maxPrice=6000&deposit=1000&lock=1&sig=${sig}`)
    expect(await signatureMatches({ ...query, maxPrice: 6000, deposit: 3000 }, LOCK_SECRET)).toBe(true)
    expect(await signatureMatches(query, LOCK_SECRET)).toBe(false)
  })

  it('rejects an expired link and ignores unsigned due dates', () => {
    const exp = Math.floor(Date.now() / 1000) - 60
    const url = buildLockedUrl({
      appUrl: 'https://payment-calculator.drjuliaray.com',
      maxPrice: 6000,
      deposit: 3000,
      exp,
      dueDate: '2026-08-01',
      secret: LOCK_SECRET,
    })
    const query = parseLockQuery(url.slice(url.indexOf('?')))
    expect(isLockExpired(exp)).toBe(true)
    expect(verifyLockSignature(query, LOCK_SECRET).reason).toBe('expired')

    const fresh = buildLockedUrl({
      appUrl: 'https://payment-calculator.drjuliaray.com',
      maxPrice: 6000,
      deposit: 3000,
      dueDate: '2026-08-01',
      extended: '12',
      secret: LOCK_SECRET,
    })
    const edited = fresh.replace('dueDate=2026-08-01', 'dueDate=2026-01-01').replace('extended=12', 'extended=true')
    expect(verifyLockSignature(parseLockQuery(edited.slice(edited.indexOf('?'))), LOCK_SECRET).ok).toBe(true)
  })

  it('rejects a mismatched locked submission before it would be accepted', () => {
    const sig = signLock({ maxPrice: 6000, deposit: 3000, exp: null }, LOCK_SECRET)
    const lock = { maxPrice: 6000, deposit: 3000, sig }
    const mismatched = gateLockedRequest({
      name: 'Test Patient',
      email: 'mattdennis-info@agentmail.to',
      totalPrice: 1000,
      deposit: 300,
      paymentOption: 'plan',
      months: 6,
      monthlyPayment: 500,
      lock,
    }, LOCK_SECRET)
    expect(mismatched).toMatchObject({
      type: 'reject',
      statusCode: 400,
      reason: 'total',
      body: { error: PUBLIC_LOCK_ERROR },
    })

    const shortSchedule = gateLockedRequest({
      totalPrice: 6000,
      deposit: 3000,
      paymentOption: 'installment',
      installments: [{ amount: 1000, dueDate: '2026-08-01' }],
      lock,
    }, LOCK_SECRET)
    expect(shortSchedule.reason).toBe('remainder')

    const payInFull = gateLockedRequest({
      totalPrice: 6000,
      deposit: 6000,
      paymentOption: 'full',
      lock,
    }, LOCK_SECRET)
    expect(payInFull.reason).toBe('pay-in-full')
  })

  it('accepts a locked plan whose remainder matches, and still accepts unsigned submissions', () => {
    const sig = signLock({ maxPrice: 6000, deposit: 3000, exp: null }, LOCK_SECRET)
    const lock = { maxPrice: 6000, deposit: 3000, sig }
    expect(gateLockedRequest({
      totalPrice: 6000,
      deposit: 3000,
      paymentOption: 'plan',
      months: 6,
      monthlyPayment: 500,
      lock,
    }, LOCK_SECRET)).toMatchObject({ type: 'continue', locked: true })

    expect(gateLockedRequest({
      totalPrice: 6000,
      deposit: 3000,
      paymentOption: 'installment',
      installments: [
        { amount: 1500, dueDate: '2026-08-01' },
        { amount: 1500, dueDate: '2026-10-01' },
      ],
      lock,
    }, LOCK_SECRET).type).toBe('continue')

    expect(gateLockedRequest({
      totalPrice: 1000,
      deposit: 100,
      paymentOption: 'plan',
      months: 3,
      monthlyPayment: 300,
    }, LOCK_SECRET)).toEqual({ type: 'continue', locked: false })
  })

  it('checks a lock in the handler before DynamoDB or Stripe', () => {
    const source = readFileSync(new URL('../api/index.js', import.meta.url), 'utf8')
    const gateAt = source.indexOf('gateLockedRequest')
    const dynamoAt = source.indexOf('dynamodb.put')
    const stripeAt = source.indexOf('createStripeInvoice')
    expect(gateAt).toBeGreaterThan(0)
    expect(gateAt).toBeLessThan(dynamoAt)
    expect(gateAt).toBeLessThan(stripeAt)
  })

  it('mints a patient link the live page will accept', () => {
    const gate = gateLockedRequest({
      action: 'signLock',
      maxPrice: 6000,
      deposit: 3000,
      dueDate: '2026-08-01',
      extended: '12',
      appUrl: 'https://evil.example',
    }, LOCK_SECRET)
    expect(gate.statusCode).toBe(200)
    expect(gate.body.url.startsWith('https://payment-calculator.drjuliaray.com/?')).toBe(true)
    expect(gate.body.url).toContain('dueDate=2026-08-01')
    expect(gate.body.url).toContain('extended=12')
    expect(gate.body.url).not.toContain('evil.example')
    const query = parseLockQuery(gate.body.url.slice(gate.body.url.indexOf('?')))
    expect(verifyLockSignature(query, LOCK_SECRET).ok).toBe(true)
    expect(describeLockState(query, true)).toMatchObject({
      mode: 'locked',
      total: 6000,
      deposit: 3000,
      showPayInFull: false,
      showScheduleCards: true,
    })
  })

  it('refuses a deposit above the total and a missing signing secret', () => {
    expect(gateLockedRequest({
      action: 'signLock', maxPrice: 6000, deposit: 9000,
    }, LOCK_SECRET).statusCode).toBe(400)
    expect(gateLockedRequest({
      action: 'signLock', maxPrice: 6000, deposit: 3000,
    }, '').statusCode).toBe(500)
  })

  it('accepts a 3 or 6 month payoff cap and rejects any other term', () => {
    for (const extended of ['3', '6']) {
      const gate = gateLockedRequest({
        action: 'signLock', maxPrice: 6000, deposit: 3000, extended,
      }, LOCK_SECRET)
      expect(gate.statusCode).toBe(200)
      expect(gate.body.url).toContain(`extended=${extended}`)
    }
    expect(gateLockedRequest({
      action: 'signLock', maxPrice: 6000, deposit: 3000, extended: '4',
    }, LOCK_SECRET).statusCode).toBe(400)
  })

  it('lets the patient choose the deposit while the total stays locked', async () => {
    const gate = gateLockedRequest({
      action: 'signLock', maxPrice: 6000, depositOpen: true,
    }, LOCK_SECRET)
    expect(gate.statusCode).toBe(200)
    expect(gate.body.url).toContain('maxPrice=6000')
    expect(gate.body.url).toContain('lock=1')
    expect(gate.body.url).not.toContain('deposit=')
    expect(clientLockMessage({ maxPrice: 6000, depositOpen: true, exp: null })).toBe('v2|6000||')
    expect(clientLockMessage({ maxPrice: 6000, depositOpen: true, exp: null })).toBe(apiLockMessage({ maxPrice: 6000, depositOpen: true, exp: null }))

    const query = parseLockQuery(gate.body.url.slice(gate.body.url.indexOf('?')))
    expect(query.depositOpen).toBe(true)
    expect(verifyLockSignature({ ...query, depositOpen: true }, LOCK_SECRET).ok).toBe(true)
    expect(await signatureMatches(query, LOCK_SECRET)).toBe(true)
    expect(describeLockState(query, true)).toMatchObject({
      mode: 'locked',
      total: 6000,
      deposit: null,
      priceEditable: false,
      depositEditable: true,
      showPayInFull: true,
    })

    const lock = { maxPrice: 6000, depositOpen: true, sig: query.sig }
    expect(gateLockedRequest({
      totalPrice: 6000,
      deposit: 1500,
      paymentOption: 'plan',
      months: 6,
      monthlyPayment: 750,
      lock,
    }, LOCK_SECRET)).toMatchObject({ type: 'continue', locked: true })
    expect(gateLockedRequest({
      totalPrice: 6000,
      deposit: 6000,
      paymentOption: 'full',
      lock,
    }, LOCK_SECRET).type).toBe('continue')
    expect(gateLockedRequest({
      totalPrice: 6000,
      deposit: 7000,
      paymentOption: 'plan',
      months: 1,
      monthlyPayment: 1,
      lock,
    }, LOCK_SECRET).reason).toBe('deposit')
    expect(gateLockedRequest({
      totalPrice: 5000,
      deposit: 1500,
      paymentOption: 'plan',
      months: 6,
      monthlyPayment: 750,
      lock,
    }, LOCK_SECRET).reason).toBe('total')

    const addedDeposit = `${gate.body.url}&deposit=1000`
    expect(verifyLockSignature(parseLockQuery(addedDeposit.slice(addedDeposit.indexOf('?'))), LOCK_SECRET).ok).toBe(false)
  })

  it('answers verifyLock without treating it as a submission', () => {
    const sig = signLock({ maxPrice: 6000, deposit: 3000, exp: null }, LOCK_SECRET)
    expect(gateLockedRequest({
      action: 'verifyLock', maxPrice: 6000, deposit: 3000, sig,
    }, LOCK_SECRET)).toEqual({ type: 'verify', statusCode: 200, body: { valid: true } })
    expect(gateLockedRequest({
      action: 'verifyLock', maxPrice: 1000, deposit: 3000, sig,
    }, LOCK_SECRET)).toEqual({ type: 'verify', statusCode: 200, body: { valid: false } })
  })
})

describe('buildIntervalInstallments', () => {
  it('spaces equal payments the given number of months apart', () => {
    const rows = buildIntervalInstallments({
      remainder: 7500, count: 3, intervalMonths: 2, start: new Date(2026, 10, 2),
    });
    expect(rows.map((r) => r.dueDate)).toEqual(['2026-11-02', '2027-01-02', '2027-03-02']);
    expect(rows.map((r) => r.amount)).toEqual([2500, 2500, 2500]);
  });

  it('sums to the remainder when it does not divide evenly', () => {
    const rows = buildIntervalInstallments({
      remainder: 7000, count: 3, intervalMonths: 3, start: new Date(2026, 10, 2),
    });
    expect(sumInstallmentAmounts(rows)).toBe(7000);
  });
})

