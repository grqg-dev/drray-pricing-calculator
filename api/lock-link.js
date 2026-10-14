const crypto = require('crypto');

const PUBLIC_LOCK_ERROR = 'This payment link is not valid';

/**
 * Signed field string. dueDate and extended are intentionally omitted.
 * Locked deposit: v1|<maxPrice>|<deposit>|<exp or empty>
 * Patient picks the deposit: v2|<maxPrice>||<exp or empty>
 */
function canonicalLockMessage({ maxPrice, deposit, exp, depositOpen = false }) {
  if (!Number.isInteger(maxPrice) || maxPrice <= 0) {
    throw new Error('invalid maxPrice');
  }
  let expPart = '';
  if (exp != null && exp !== '') {
    if (!Number.isInteger(exp) || exp <= 0) throw new Error('invalid exp');
    expPart = String(exp);
  }
  if (depositOpen) return `v2|${maxPrice}||${expPart}`;
  if (!Number.isInteger(deposit) || deposit <= 0 || deposit > maxPrice) {
    throw new Error('invalid deposit');
  }
  return `v1|${maxPrice}|${deposit}|${expPart}`;
}

function signLock(fields, secret) {
  if (!secret) throw new Error('PRICE_LOCK_SECRET is required');
  return crypto.createHmac('sha256', secret).update(canonicalLockMessage(fields)).digest('base64url');
}

function signaturesMatch(expected, actual) {
  const a = Buffer.from(String(expected));
  const b = Buffer.from(String(actual || ''));
  if (a.length === 0 || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function lockAmounts(fields) {
  const depositOpen = fields.depositOpen === true;
  return {
    maxPrice: fields.maxPrice,
    deposit: depositOpen ? null : fields.deposit,
    depositOpen,
    exp: fields.exp ?? null,
  };
}

function verifyLockSignature(fields, secret, now = Date.now()) {
  if (!secret || !fields) return { ok: false, reason: 'config', error: PUBLIC_LOCK_ERROR };
  const amounts = lockAmounts(fields);
  let expected;
  try {
    expected = signLock(amounts, secret);
  } catch {
    return { ok: false, reason: 'params', error: PUBLIC_LOCK_ERROR };
  }
  if (!signaturesMatch(expected, fields.sig)) {
    return { ok: false, reason: 'signature', error: PUBLIC_LOCK_ERROR };
  }
  if (fields.exp != null && fields.exp !== '') {
    if (!Number.isInteger(fields.exp) || now >= fields.exp * 1000) {
      return { ok: false, reason: 'expired', error: PUBLIC_LOCK_ERROR };
    }
  }
  return { ok: true, ...amounts };
}

function reject(reason) {
  return { ok: false, status: 400, reason, error: PUBLIC_LOCK_ERROR };
}

function remainderMatchesPlan(remainder, months, monthlyPayment) {
  if (!Number.isInteger(months) || months < 1) return false;
  if (typeof monthlyPayment !== 'number' || !Number.isFinite(monthlyPayment) || monthlyPayment <= 0) return false;
  const billedCents = Math.round(monthlyPayment * 100) * months;
  const expectedCents = remainder * 100;
  return Math.abs(billedCents - expectedCents) <= months;
}

/**
 * Unsigned submissions pass through. A present lock must match totalPrice and deposit
 * before the caller writes DynamoDB, calls Make, or creates Stripe objects.
 */
function validateLockedSubmission(payload, secret, now = Date.now()) {
  if (!payload || !payload.lock) return { ok: true, locked: false };
  const verified = verifyLockSignature(payload.lock, secret, now);
  if (!verified.ok) return reject(verified.reason);

  if (payload.totalPrice !== verified.maxPrice) return reject('total');

  const deposit = verified.depositOpen ? payload.deposit : verified.deposit;
  if (verified.depositOpen) {
    if (!Number.isInteger(deposit) || deposit <= 0 || deposit > verified.maxPrice) {
      return reject('deposit');
    }
  }

  if (payload.paymentOption === 'full') {
    if (deposit !== verified.maxPrice || payload.deposit !== verified.maxPrice) {
      return reject('pay-in-full');
    }
    return { ok: true, locked: true, maxPrice: verified.maxPrice, deposit };
  }

  if (payload.deposit !== deposit) return reject('deposit');

  const remainder = verified.maxPrice - deposit;
  if (payload.paymentOption === 'installment') {
    if (!Array.isArray(payload.installments) || payload.installments.length === 0) {
      return reject('schedule');
    }
    const sum = payload.installments.reduce((total, row) => total + Number(row.amount), 0);
    if (sum !== remainder) return reject('remainder');
  } else if (payload.paymentOption === 'plan') {
    if (!remainderMatchesPlan(remainder, payload.months, payload.monthlyPayment)) {
      return reject('remainder');
    }
  } else {
    return reject('option');
  }

  return { ok: true, locked: true, maxPrice: verified.maxPrice, deposit };
}

const CALCULATOR_APP_URL = 'https://payment-calculator.drjuliaray.com';
const ALLOWED_EXTENDED = new Set(['3', '6', '12', 'true']);

function signLockedLink(payload, secret, now = Date.now()) {
  if (!secret) return { ok: false, status: 500, error: 'Link signing is not configured' };
  const maxPrice = Number(payload && payload.maxPrice);
  const depositOpen = Boolean(payload && payload.depositOpen);
  const deposit = depositOpen ? null : Number(payload && payload.deposit);
  let exp = null;
  if (payload && payload.days != null && payload.days !== '' && Number(payload.days) !== 0) {
    const days = Number(payload.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return { ok: false, status: 400, error: 'Choose an expiry of 1 to 365 days, or none' };
    }
    exp = Math.floor(now / 1000) + days * 24 * 60 * 60;
  }
  const dueDate = payload && payload.dueDate ? String(payload.dueDate) : undefined;
  const extended = payload && payload.extended ? String(payload.extended) : undefined;
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return { ok: false, status: 400, error: 'Due date must be YYYY-MM-DD' };
  }
  if (extended && !ALLOWED_EXTENDED.has(extended)) {
    return { ok: false, status: 400, error: 'Payment term is not valid' };
  }
  try {
    const url = buildLockedUrl({
      appUrl: CALCULATOR_APP_URL,
      maxPrice,
      deposit,
      depositOpen,
      exp,
      dueDate,
      extended,
      secret,
    });
    return { ok: true, url };
  } catch {
    return {
      ok: false,
      status: 400,
      error: depositOpen
        ? 'Enter a total greater than 0'
        : 'Enter a total and a deposit that does not exceed it',
    };
  }
}

function gateLockedRequest(payload, secret, now = Date.now()) {
  if (payload && payload.action === 'signLock') {
    const signed = signLockedLink(payload, secret, now);
    if (!signed.ok) return { type: 'reject', statusCode: signed.status, body: { error: signed.error } };
    return { type: 'verify', statusCode: 200, body: { url: signed.url } };
  }
  if (payload && payload.action === 'verifyLock') {
    const result = verifyLockSignature(payload, secret, now);
    return { type: 'verify', statusCode: 200, body: { valid: result.ok === true } };
  }
  const check = validateLockedSubmission(payload, secret, now);
  if (!check.ok) {
    return {
      type: 'reject',
      statusCode: check.status,
      reason: check.reason,
      body: { error: check.error },
    };
  }
  return { type: 'continue', locked: check.locked === true };
}

function buildLockedUrl({ appUrl, maxPrice, deposit, depositOpen = false, exp = null, dueDate, extended, secret }) {
  const sig = signLock({ maxPrice, deposit, depositOpen, exp }, secret);
  const params = new URLSearchParams();
  params.set('maxPrice', String(maxPrice));
  if (!depositOpen) params.set('deposit', String(deposit));
  params.set('lock', '1');
  if (exp) params.set('exp', String(exp));
  if (dueDate) params.set('dueDate', dueDate);
  if (extended) params.set('extended', String(extended));
  params.set('sig', sig);
  const base = String(appUrl || '').replace(/\/$/, '');
  return `${base}/?${params.toString()}`;
}

module.exports = {
  PUBLIC_LOCK_ERROR,
  canonicalLockMessage,
  signLock,
  verifyLockSignature,
  validateLockedSubmission,
  gateLockedRequest,
  signLockedLink,
  buildLockedUrl,
  CALCULATOR_APP_URL,
  ALLOWED_EXTENDED,
};
