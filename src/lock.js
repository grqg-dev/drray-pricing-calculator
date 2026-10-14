import { qualifiesForCustomSchedule, SUBMISSION_API_URL } from './utils'

export const LOCK_PAGE_ERROR = "This payment link isn't valid. Ask the office for a new one.";

/**
 * Same string as api/lock-link.js canonicalLockMessage.
 * v1|<maxPrice>|<deposit>|<exp or empty>
 */
export function canonicalLockMessage({ maxPrice, deposit, exp }) {
  if (!Number.isInteger(maxPrice) || maxPrice <= 0) {
    throw new Error('invalid maxPrice');
  }
  if (!Number.isInteger(deposit) || deposit <= 0 || deposit > maxPrice) {
    throw new Error('invalid deposit');
  }
  let expPart = '';
  if (exp != null && exp !== '') {
    if (!Number.isInteger(exp) || exp <= 0) throw new Error('invalid exp');
    expPart = String(exp);
  }
  return `v1|${maxPrice}|${deposit}|${expPart}`;
}

export function parseLockQuery(search) {
  const raw = search.charAt(0) === '?' ? search.slice(1) : search;
  const params = new URLSearchParams(raw);
  if (params.get('lock') !== '1') return { requested: false };

  const maxPrice = Number(params.get('maxPrice'));
  const deposit = Number(params.get('deposit'));
  const expRaw = params.get('exp');
  const expNumber = expRaw == null || expRaw === '' ? null : Number(expRaw);

  return {
    requested: true,
    maxPrice: Number.isInteger(maxPrice) ? maxPrice : null,
    deposit: Number.isInteger(deposit) ? deposit : null,
    exp: expNumber == null ? null : (Number.isInteger(expNumber) ? expNumber : null),
    sig: params.get('sig') || '',
  };
}

export function isLockExpired(exp, now = Date.now()) {
  if (exp == null) return false;
  if (!Number.isInteger(exp) || exp <= 0) return true;
  return now >= exp * 1000;
}

/**
 * Locked-page decisions. `signatureValid` is the result of checking the HMAC
 * (local secret in dev, or the Lambda verifyLock action in production).
 */
export function describeLockState(query, signatureValid) {
  if (!query?.requested) {
    return {
      mode: 'open',
      priceEditable: true,
      depositEditable: true,
      showPayInFull: true,
      showScheduleCards: false,
    };
  }

  const amountsOk = Number.isInteger(query.maxPrice)
    && Number.isInteger(query.deposit)
    && query.deposit > 0
    && query.deposit <= query.maxPrice;

  if (!signatureValid || !amountsOk) {
    return {
      mode: 'invalid',
      priceEditable: false,
      depositEditable: false,
      showPayInFull: false,
      showScheduleCards: false,
    };
  }

  const payInFullOnly = query.deposit === query.maxPrice;
  return {
    mode: 'locked',
    total: query.maxPrice,
    deposit: query.deposit,
    priceEditable: false,
    depositEditable: false,
    showPayInFull: payInFullOnly,
    showScheduleCards: !payInFullOnly && qualifiesForCustomSchedule(query.deposit, query.maxPrice),
  };
}

function toBase64Url(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signatureMatches(fields, secret) {
  const message = canonicalLockMessage(fields);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const actual = toBase64Url(mac);
  const expected = String(fields.sig || '');
  if (actual.length === 0 || actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

export async function verifyLockRemote(fields, url = SUBMISSION_API_URL) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'verifyLock',
      maxPrice: fields.maxPrice,
      deposit: fields.deposit,
      ...(fields.exp ? { exp: fields.exp } : {}),
      sig: fields.sig,
    }),
  });
  if (!response.ok) return false;
  const data = await response.json();
  return data.valid === true;
}
