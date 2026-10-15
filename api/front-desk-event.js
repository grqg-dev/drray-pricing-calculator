'use strict';

// Vendored from grqg-dev/drray shared/front-desk-event/index.js
// at 444f2ff76fdc92abfc19c0166f7c650bea4cdbca (JRDO-99).
// Contract: docs/front-desk-events.md in that repo.
// URL and token come from the Lambda environment. Never hard-code them.

const URL_ENV = 'FRONT_DESK_WEBHOOK_URL';
const TOKEN_ENV = 'FRONT_DESK_WEBHOOK_TOKEN';
const TIMEOUT_MS = 3000;
const ENVELOPE_VERSION = 1;
const MAX_ATTEMPTS = 2;

const succeededEventIds = new Set();
const inflight = new Map();

function resetFrontDeskEventForTests() {
  succeededEventIds.clear();
  inflight.clear();
}

function logLine(logger, event, eventId, status) {
  const line = `[front-desk-event] event=${event || ''} eventId=${eventId || ''} status=${status}`;
  try {
    if (typeof logger === 'function') logger(line);
    else console.log(line);
  } catch {
    // A broken logger must not surface to the caller.
  }
}

function authorizationHeader(key) {
  const value = String(key).trim();
  if (/^Bearer\s+/i.test(value)) return value;
  return `Bearer ${value}`;
}

function readConfigValue(env, name) {
  const raw = env && env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

function loadWebhookConfig(options) {
  const env = options.env || process.env;
  const url = readConfigValue(env, URL_ENV);
  const key = readConfigValue(env, TOKEN_ENV);
  if (!url || !key) return null;
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (parsedUrl.protocol !== 'https:') return null;
  return { url, key };
}

function buildEnvelope(input, now) {
  const occurredAt = typeof input.occurredAt === 'string' && input.occurredAt.trim()
    ? input.occurredAt.trim()
    : now.toISOString();
  const source = typeof input.source === 'string' && input.source.trim()
    ? input.source.trim()
    : 'lambda';
  const data = input.data && typeof input.data === 'object' && !Array.isArray(input.data)
    ? input.data
    : {};
  return {
    version: ENVELOPE_VERSION,
    event: input.event,
    eventId: input.eventId,
    occurredAt,
    source,
    test: input.test === true,
    data,
  };
}

function shouldRetry(status) {
  return status === 'timeout' || status === 'error' || status === 429
    || (typeof status === 'number' && status >= 500);
}

async function postOnce(url, key, body, { fetchImpl, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const pending = Promise.resolve().then(() => fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authorizationHeader(key),
    },
    body: JSON.stringify(body),
    redirect: 'manual',
    signal: controller.signal,
  }));
  pending.catch(() => {});

  let res;
  try {
    res = await Promise.race([
      pending,
      new Promise((_, reject) => {
        const raceTimer = setTimeout(() => {
          const err = new Error('timeout');
          err.code = 'TIMEOUT';
          reject(err);
        }, timeoutMs);
        pending.then(() => clearTimeout(raceTimer), () => clearTimeout(raceTimer));
      }),
    ]);
  } catch (err) {
    const timedOut = controller.signal.aborted
      || (err && (err.code === 'TIMEOUT' || err.name === 'AbortError'));
    return { ok: false, status: timedOut ? 'timeout' : 'error' };
  } finally {
    clearTimeout(timer);
  }

  if (res && typeof res.text === 'function') {
    try {
      await res.text();
    } catch {
      // Discard the body. Never log it.
    }
  }

  const status = res && typeof res.status === 'number' ? res.status : 'error';
  const ok = status >= 200 && status < 300;
  return { ok, status };
}

async function postWithRetry(url, key, body, options) {
  let last = { ok: false, status: 'error', attempts: 0 };
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    last = await postOnce(url, key, body, options);
    last.attempts = attempt;
    if (last.ok || !shouldRetry(last.status)) return last;
  }
  return last;
}

async function deliver(input, event, eventId, options) {
  const logger = options.logger;
  const config = await loadWebhookConfig(options);
  if (!config) {
    logLine(logger, event, eventId, 'skipped');
    return {
      ok: false,
      skipped: true,
      status: 'skipped',
      reason: 'missing_config',
      eventId,
    };
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    logLine(logger, event, eventId, 'error');
    return { ok: false, status: 'error', reason: 'no_fetch', eventId };
  }

  const envelope = buildEnvelope(
    { ...input, event, eventId },
    options.now instanceof Date ? options.now : new Date(),
  );
  const result = await postWithRetry(config.url, config.key, envelope, {
    fetchImpl,
    timeoutMs: Number.isFinite(options.timeoutMs) ? options.timeoutMs : TIMEOUT_MS,
  });
  logLine(logger, event, eventId, result.status);
  return {
    ok: result.ok,
    status: result.status,
    attempts: result.attempts,
    eventId,
  };
}

async function sendFrontDeskEvent(input = {}, options = {}) {
  try {
    const event = input && typeof input.event === 'string' ? input.event.trim() : '';
    const eventId = input && typeof input.eventId === 'string' ? input.eventId.trim() : '';
    if (!event || !eventId) {
      logLine(options.logger, event, eventId, 'skipped');
      return {
        ok: false,
        skipped: true,
        status: 'skipped',
        reason: 'invalid_event',
        eventId: eventId || undefined,
      };
    }

    if (succeededEventIds.has(eventId)) {
      logLine(options.logger, event, eventId, 'deduped');
      return { ok: true, deduped: true, status: 'deduped', eventId };
    }

    const existing = inflight.get(eventId);
    if (existing) return existing;

    const work = deliver(input, event, eventId, options)
      .then((result) => {
        if (result.ok) succeededEventIds.add(eventId);
        return result;
      })
      .finally(() => {
        inflight.delete(eventId);
      });
    inflight.set(eventId, work);
    return await work;
  } catch {
    const event = input && input.event;
    const eventId = input && input.eventId;
    logLine(options.logger, event, eventId, 'error');
    return { ok: false, status: 'error', eventId };
  }
}

module.exports = {
  sendFrontDeskEvent,
  URL_ENV,
  TOKEN_ENV,
  TIMEOUT_MS,
  ENVELOPE_VERSION,
  resetFrontDeskEventForTests,
};
