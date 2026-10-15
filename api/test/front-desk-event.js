'use strict';

// Vendored from grqg-dev/drray shared/front-desk-event/index.test.js
// at 444f2ff76fdc92abfc19c0166f7c650bea4cdbca. Require path points at
// api/front-desk-event.js so the Lambda copy stays covered.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  sendFrontDeskEvent,
  URL_ENV,
  TOKEN_ENV,
  resetFrontDeskEventForTests,
} = require('../front-desk-event');

const FAKE_URL = 'https://front-desk.example.test/hooks/fake';
const FAKE_KEY = 'fake-bearer-key';
const FAKE_OPP = 'recFAKE91ZZTEST';

function webhookEnv(url = FAKE_URL, token = FAKE_KEY) {
  return {
    [URL_ENV]: url,
    [TOKEN_ENV]: token,
  };
}

function okFetch(status = 202) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts, body: JSON.parse(opts.body) });
    return { ok: status >= 200 && status < 300, status, text: async () => '' };
  };
  return { fetchImpl, calls };
}

describe('sendFrontDeskEvent', () => {
  let logs;
  let originalLog;

  beforeEach(() => {
    resetFrontDeskEventForTests();
    logs = [];
    originalLog = console.log;
    console.log = (line) => logs.push(String(line));
  });

  afterEach(() => {
    console.log = originalLog;
    resetFrontDeskEventForTests();
  });

  it('posts the v1 envelope and does not invent a patient name', async () => {
    const http = okFetch();
    const occurredAt = '2026-10-15T12:00:00.000Z';

    const result = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: `contract_signed:${FAKE_OPP}`,
      source: 'make-432734',
      occurredAt,
      data: {
        opportunityId: FAKE_OPP,
        contractId: 'ZZTEST-CONTRACT',
        signedAt: occurredAt,
      },
    }, { env: webhookEnv(), fetchImpl: http.fetchImpl });

    assert.equal(result.ok, true);
    assert.equal(result.status, 202);
    assert.equal(result.attempts, 1);
    assert.equal(http.calls.length, 1);
    assert.equal(http.calls[0].url, FAKE_URL);
    assert.equal(http.calls[0].opts.method, 'POST');
    assert.equal(http.calls[0].opts.headers.Authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(http.calls[0].opts.headers['Content-Type'], 'application/json');
    assert.deepEqual(http.calls[0].body, {
      version: 1,
      event: 'contract_signed',
      eventId: `contract_signed:${FAKE_OPP}`,
      occurredAt,
      source: 'make-432734',
      test: false,
      data: {
        opportunityId: FAKE_OPP,
        contractId: 'ZZTEST-CONTRACT',
        signedAt: occurredAt,
      },
    });
    assert.equal(http.calls[0].body.data.patientName, undefined);
    assert.equal(http.calls[0].body.data.email, undefined);
    assert.equal(logs.length, 1);
    assert.match(logs[0], /event=contract_signed/);
    assert.match(logs[0], new RegExp(`eventId=contract_signed:${FAKE_OPP}`));
    assert.match(logs[0], /status=202/);
  });

  it('sends test:true when asked and still omits names from the log', async () => {
    const http = okFetch(200);
    await sendFrontDeskEvent({
      event: 'payment_plan_submitted',
      eventId: 'payment_plan_submitted:subFAKE94',
      source: 'price-submission-handler',
      test: true,
      occurredAt: '2026-10-15T12:00:00.000Z',
      data: {
        submissionId: 'subFAKE94',
        patientName: 'Zztest Patient',
      },
    }, {
      env: webhookEnv(),
      fetchImpl: http.fetchImpl,
    });

    assert.equal(http.calls[0].body.test, true);
    assert.equal(http.calls[0].body.data.patientName, 'Zztest Patient');
    const logged = logs.join('\n');
    assert.equal(logged.includes('Zztest Patient'), false);
    assert.equal(logged.includes(FAKE_KEY), false);
    assert.equal(logged.includes(FAKE_URL), false);
    assert.equal(logged.includes('front-desk.example.test'), false);
    assert.match(logged, /status=200/);
  });

  it('does not double the Bearer prefix', async () => {
    const http = okFetch();
    await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKEBEARER',
      data: { opportunityId: 'recFAKEBEARER' },
    }, {
      env: webhookEnv(FAKE_URL, `Bearer ${FAKE_KEY}`),
      fetchImpl: http.fetchImpl,
    });
    assert.equal(http.calls[0].opts.headers.Authorization, `Bearer ${FAKE_KEY}`);
  });

  it('skips and logs when the webhook env is missing', async () => {
    const http = okFetch();
    const result = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: `contract_signed:${FAKE_OPP}`,
      data: { opportunityId: FAKE_OPP },
    }, { env: {}, fetchImpl: http.fetchImpl });

    assert.equal(result.ok, false);
    assert.equal(result.skipped, true);
    assert.equal(result.status, 'skipped');
    assert.equal(result.reason, 'missing_config');
    assert.equal(http.calls.length, 0);
    assert.match(logs[0], /status=skipped/);
    assert.equal(logs[0].includes(FAKE_KEY), false);
  });

  it('skips when the url or token is missing, or the url is not https', async () => {
    const http = okFetch();
    const cases = [
      {},
      { [URL_ENV]: FAKE_URL },
      { [TOKEN_ENV]: FAKE_KEY },
      { [URL_ENV]: 'http://front-desk.example.test/hooks/fake', [TOKEN_ENV]: FAKE_KEY },
      { [URL_ENV]: '   ', [TOKEN_ENV]: FAKE_KEY },
    ];
    for (const env of cases) {
      resetFrontDeskEventForTests();
      logs.length = 0;
      const result = await sendFrontDeskEvent({
        event: 'mfm_choice_submitted',
        eventId: 'mfm_choice_submitted:recFAKE79',
        data: { opportunityId: 'recFAKE79' },
      }, { env, fetchImpl: http.fetchImpl });
      assert.equal(result.skipped, true, JSON.stringify(env));
    }
    assert.equal(http.calls.length, 0);
  });

  it('dedupes a second send of the same eventId', async () => {
    const http = okFetch();
    const options = { env: webhookEnv(), fetchImpl: http.fetchImpl };
    const first = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKEDEDUP',
      data: { opportunityId: 'recFAKEDEDUP' },
    }, options);
    const second = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKEDEDUP',
      test: true,
      data: { opportunityId: 'recFAKEDEDUP' },
    }, options);
    const other = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKEOTHER',
      data: { opportunityId: 'recFAKEOTHER' },
    }, options);

    assert.equal(first.ok, true);
    assert.equal(second.deduped, true);
    assert.equal(second.status, 'deduped');
    assert.equal(other.ok, true);
    assert.equal(http.calls.length, 2);
    assert.match(logs.join('\n'), /status=deduped/);
  });

  it('retries a timeout once and does not throw', async () => {
    let calls = 0;
    const fetchImpl = (_url, opts) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        const fail = () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (opts.signal.aborted) return fail();
        opts.signal.addEventListener('abort', fail, { once: true });
      });
    };

    const result = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKETIMEOUT',
      data: { opportunityId: 'recFAKETIMEOUT' },
    }, {
      env: webhookEnv(),
      fetchImpl,
      timeoutMs: 30,
    });

    assert.equal(result.ok, false);
    assert.equal(result.status, 'timeout');
    assert.equal(result.attempts, 2);
    assert.equal(calls, 2);
    assert.match(logs[0], /status=timeout/);
  });

  it('retries one 503 and keeps a 400 as a single attempt', async () => {
    const statuses = [503, 204];
    let calls = 0;
    const fetchImpl = async () => {
      const status = statuses[calls] ?? 204;
      calls += 1;
      return { ok: status >= 200 && status < 300, status, text: async () => '' };
    };
    const retry = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKERETRY',
      data: { opportunityId: 'recFAKERETRY' },
    }, {
      env: webhookEnv(),
      fetchImpl,
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.status, 204);
    assert.equal(retry.attempts, 2);
    assert.equal(calls, 2);

    resetFrontDeskEventForTests();
    let badCalls = 0;
    const bad = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKE400',
      data: { opportunityId: 'recFAKE400' },
    }, {
      env: webhookEnv(),
      fetchImpl: async () => {
        badCalls += 1;
        return { ok: false, status: 400, text: async () => '{"error":"no"}' };
      },
    });
    assert.equal(bad.ok, false);
    assert.equal(bad.status, 400);
    assert.equal(bad.attempts, 1);
    assert.equal(badCalls, 1);

    const again = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKE400',
      data: { opportunityId: 'recFAKE400' },
    }, {
      env: webhookEnv(),
      fetchImpl: async () => {
        badCalls += 1;
        return { ok: true, status: 204, text: async () => '' };
      },
    });
    assert.equal(again.ok, true);
    assert.equal(again.deduped, undefined);
    assert.equal(badCalls, 2);
  });

  it('returns skipped for a missing event and never throws if fetch throws', async () => {
    const missing = await sendFrontDeskEvent({ data: { patientName: 'Zztest Patient' } });
    assert.equal(missing.skipped, true);
    assert.equal(missing.reason, 'invalid_event');

    const boom = await sendFrontDeskEvent({
      event: 'contract_signed',
      eventId: 'contract_signed:recFAKEBOOM',
      data: { opportunityId: 'recFAKEBOOM' },
    }, {
      env: webhookEnv(),
      fetchImpl: async () => {
        throw new Error(`network down ${FAKE_URL} ${FAKE_KEY}`);
      },
    });
    assert.equal(boom.ok, false);
    assert.equal(boom.status, 'error');
    assert.equal(boom.attempts, 2);
    const logged = logs.join('\n');
    assert.equal(logged.includes(FAKE_KEY), false);
    assert.equal(logged.includes(FAKE_URL), false);
    assert.equal(logged.includes('Zztest Patient'), false);
  });
});
