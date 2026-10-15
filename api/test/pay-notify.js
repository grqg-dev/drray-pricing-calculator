const { before, after, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const https = require('https');
const Module = require('module');
const { EventEmitter } = require('events');

const PATIENT = 'Zztest Patient';
const EMAIL = 'zztest.patient@example.test';
const LIVE_NAME = 'Alex Morgan';
const LIVE_EMAIL = 'alex.morgan@example.test';
const FRONT_DESK_HOST = 'front-desk.example.test';
const MAKE_HOST = 'make.example.test';
const OLD_NOTIFY_HOST = 'notify.example.test';
const FRONT_DESK_URL = `https://${FRONT_DESK_HOST}/hooks/front-desk`;
const MAKE_URL = `https://${MAKE_HOST}/webhook/pricing`;
const OLD_NOTIFY_URL = `https://${OLD_NOTIFY_HOST}/hooks/payment`;
const TOKEN = 'front-desk-test-token';
const OPPORTUNITY_ID = 'recFAKE94';

const MANAGED_ENV = [
  'MAKE_WEBHOOK_URL',
  'FRONT_DESK_WEBHOOK_URL',
  'FRONT_DESK_WEBHOOK_TOKEN',
  'PAY_NOTIFY_WEBHOOK_URL',
  'PAY_NOTIFY_WEBHOOK_TOKEN',
  'PUMBLE_VIA_MAKE_ENABLED',
  'STRIPE_SECRET_KEY',
  'STRIPE_DEPOSIT_PRODUCT_ID',
  'STRIPE_MONTHLY_PRODUCT_ID',
  'DYNAMODB_TABLE',
  'PRICE_LOCK_SECRET',
  'ALLOWED_ORIGINS',
];

const requests = [];
const sequence = [];
const logs = [];
const errors = [];
const behaviors = {};
let stripeFails = false;

function formatArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

https.request = function fakeRequest(options, callback) {
  const req = new EventEmitter();
  const chunks = [];
  req.write = (chunk) => {
    chunks.push(Buffer.from(chunk));
    return true;
  };
  req.destroy = () => {
    req.destroyed = true;
  };
  req.setTimeout = (ms, cb) => {
    req._timeoutMs = ms;
    req._timeoutCb = cb;
    return req;
  };
  req.end = () => {
    const record = {
      options,
      body: Buffer.concat(chunks).toString('utf8'),
      timeoutMs: req._timeoutMs || null,
    };
    requests.push(record);
    sequence.push(`https:${options.hostname}`);
    const behavior = behaviors[options.hostname] || 'ok';
    if (behavior === 'error') {
      process.nextTick(() => req.emit('error', new Error('webhook down')));
      return;
    }
    if (behavior === 'timeout') {
      process.nextTick(() => {
        if (req._timeoutCb) req._timeoutCb();
      });
      return;
    }
    const res = new EventEmitter();
    res.statusCode = behavior === 'phi' ? 500 : (typeof behavior === 'number' ? behavior : 200);
    const responseBody = behavior === 'phi'
      ? JSON.stringify({ name: PATIENT, email: EMAIL })
      : '';
    process.nextTick(() => {
      callback(res);
      res.emit('data', responseBody);
      res.emit('end');
    });
  };
  return req;
};

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const parsed = new URL(url);
  const record = {
    url,
    options: {
      hostname: parsed.hostname,
      path: `${parsed.pathname}${parsed.search}`,
      headers: { ...(opts && opts.headers) },
    },
    body: opts && opts.body,
  };
  requests.push(record);
  sequence.push(`fetch:${parsed.hostname}`);
  const behavior = behaviors[parsed.hostname] || 'ok';
  if (behavior === 'error') {
    throw new Error(`webhook down ${url}`);
  }
  if (behavior === 'timeout') {
    return new Promise((_resolve, reject) => {
      const fail = () => {
        const err = new Error('aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (opts && opts.signal && opts.signal.aborted) return fail();
      if (opts && opts.signal) opts.signal.addEventListener('abort', fail, { once: true });
    });
  }
  const status = typeof behavior === 'number' ? behavior : 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => '',
  };
};

const originalLoad = Module._load;
Module._load = function load(request, parent, isMain) {
  if (request === 'aws-sdk') {
    return {
      DynamoDB: {
        DocumentClient: function DocumentClient() {
          this.put = () => ({
            promise: async () => {
              sequence.push('dynamo-put');
              return {};
            },
          });
          this.update = () => ({
            promise: async () => {
              sequence.push('dynamo-update');
              return {};
            },
          });
        },
      },
    };
  }
  if (request === 'stripe') {
    return function Stripe() {
      if (stripeFails) {
        return {
          customers: {
            list: async () => {
              throw new Error('stripe unavailable');
            },
          },
        };
      }
      return {
        customers: {
          list: async () => ({ data: [] }),
          create: async () => ({ id: 'cus_zztest', name: PATIENT, email: EMAIL }),
          update: async (id, data) => ({ id, ...data }),
        },
        invoiceItems: {
          create: async () => ({ id: 'ii_zztest' }),
        },
        invoices: {
          create: async (params) => {
            sequence.push('stripe-invoice');
            if (params.metadata && params.metadata.installmentIndex) {
              return { id: `in_future_${params.metadata.installmentIndex}` };
            }
            return { id: 'in_deposit_zztest' };
          },
          finalizeInvoice: async (id) => ({
            id,
            hosted_invoice_url: `https://invoice.example.test/${id}`,
          }),
          sendInvoice: async () => ({}),
        },
        prices: {
          list: async () => ({ data: [] }),
          create: async () => ({ id: 'price_zztest' }),
        },
        subscriptionSchedules: {
          create: async () => {
            sequence.push('stripe-schedule');
            return {
              id: 'sub_sched_zztest',
              subscription: 'sub_zztest',
              status: 'not_started',
              end_behavior: 'cancel',
              phases: [],
            };
          },
        },
      };
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const { resetFrontDeskEventForTests } = require('../front-desk-event');
const {
  EVENT,
  SOURCE,
  isPumbleViaMakeEnabled,
  isStripeTestMode,
  isZztestRecord,
  buildFrontDeskPaymentEvent,
  sendPaymentNotification,
} = require('../pay-notify');
const { handler } = require('../index');

const originalLog = console.log;
const originalError = console.error;

function stripeEnv(key = 'sk_test_zztest') {
  return {
    STRIPE_SECRET_KEY: key,
    STRIPE_DEPOSIT_PRODUCT_ID: 'prod_zztest_deposit',
    STRIPE_MONTHLY_PRODUCT_ID: 'prod_zztest_monthly',
  };
}

function frontDeskEnv(token = TOKEN) {
  return {
    FRONT_DESK_WEBHOOK_URL: FRONT_DESK_URL,
    FRONT_DESK_WEBHOOK_TOKEN: token,
  };
}

function submission(overrides = {}) {
  return {
    name: PATIENT,
    email: EMAIL,
    totalPrice: 8500,
    paymentOption: 'plan',
    deposit: 4250,
    monthlyPayment: 708,
    months: 6,
    payoffDate: '2026-08-04T00:00:00.000Z',
    isSlidingScale: false,
    timestamp: '2026-02-04T18:18:00.000Z',
    ...overrides,
  };
}

function requestsTo(host) {
  return requests.filter((req) => req.options.hostname === host);
}

function assertLogsSafe(submissionId) {
  const text = `${logs.join('\n')}\n${errors.join('\n')}`;
  for (const secret of [
    FRONT_DESK_HOST,
    MAKE_HOST,
    OLD_NOTIFY_HOST,
    TOKEN,
    'sk_test_zztest',
    'sk_live_example',
    'rk_test_zztest',
    PATIENT,
    EMAIL,
    LIVE_NAME,
    LIVE_EMAIL,
    'PAY_NOTIFY_WEBHOOK_URL',
    'PAY_NOTIFY_WEBHOOK_TOKEN',
  ]) {
    assert.equal(text.includes(secret), false, secret);
  }
  const writing = logs.filter((line) => line.startsWith('Writing to DynamoDB:'));
  assert.deepEqual(writing, [`Writing to DynamoDB: ${submissionId}`]);
}

function assertEnvelopeHasNoPhi(sent) {
  for (const key of ['name', 'email', 'patientName', 'phone']) {
    assert.equal(Object.hasOwn(sent, key), false, key);
    assert.equal(Object.hasOwn(sent.data || {}, key), false, key);
  }
  const raw = JSON.stringify(sent);
  assert.equal(raw.includes(PATIENT), false);
  assert.equal(raw.includes(EMAIL), false);
  assert.equal(raw.includes(LIVE_NAME), false);
  assert.equal(raw.includes(LIVE_EMAIL), false);
  assert.equal(raw.includes('sk_test_'), false);
  assert.equal(raw.includes('sk_live_'), false);
  assert.equal(raw.includes('rk_test_'), false);
}

async function submit(body, env = {}) {
  Object.assign(process.env, env);
  const response = await handler({
    httpMethod: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, json: JSON.parse(response.body) };
}

before(() => {
  console.log = (...args) => {
    logs.push(args.map(formatArg).join(' '));
  };
  console.error = (...args) => {
    errors.push(args.map(formatArg).join(' '));
  };
});

after(() => {
  console.log = originalLog;
  console.error = originalError;
  Module._load = originalLoad;
  globalThis.fetch = originalFetch;
  for (const key of MANAGED_ENV) delete process.env[key];
});

beforeEach(() => {
  requests.length = 0;
  sequence.length = 0;
  logs.length = 0;
  errors.length = 0;
  stripeFails = false;
  resetFrontDeskEventForTests();
  for (const key of Object.keys(behaviors)) delete behaviors[key];
  for (const key of MANAGED_ENV) delete process.env[key];
});

describe('payment notification event', () => {
  const stripe = {
    customerId: 'cus_zztest',
    invoiceId: 'in_deposit_zztest',
    invoiceUrl: 'https://invoice.example.test/in_deposit_zztest',
    subscriptionScheduleId: 'sub_sched_zztest',
    subscriptionId: 'sub_zztest',
    futureInvoiceIds: null,
  };

  it('builds a payment_plan_submitted envelope without a name or email', () => {
    const plan = buildFrontDeskPaymentEvent({
      payload: submission({ isSlidingScale: true, opportunityId: `  ${OPPORTUNITY_ID}  ` }),
      submissionId: 'subm_zztest',
      stripeKey: 'sk_test_zztest',
      stripe,
    });
    assert.equal(plan.event, EVENT);
    assert.equal(plan.eventId, 'payment_plan_submitted:subm_zztest');
    assert.equal(plan.source, SOURCE);
    assert.equal(plan.test, true);
    assert.equal(plan.data.opportunityId, OPPORTUNITY_ID);
    assert.equal(plan.data.paymentOption, 'plan');
    assert.equal(plan.data.amount, 4250);
    assert.equal(plan.data.method, 'stripe_subscription_schedule');
    assert.equal(plan.data.patientName, undefined);
    assert.equal(plan.data.email, undefined);
    assert.equal(plan.data.name, undefined);
    assertEnvelopeHasNoPhi({ data: plan.data, ...plan });

    const installments = [
      { amount: 2125, dueDate: '2026-08-01' },
      { amount: 2125, dueDate: '2026-10-01' },
    ];
    const installment = buildFrontDeskPaymentEvent({
      payload: submission({
        paymentOption: 'installment',
        deposit: 4250,
        installments,
      }),
      submissionId: 'subm_installment',
      stripeKey: 'rk_test_zztest',
      stripe: { ...stripe, futureInvoiceIds: ['in_future_1'] },
    });
    assert.equal(installment.event, 'payment_plan_submitted');
    assert.equal(installment.data.method, 'stripe_scheduled_invoices');
    assert.equal(installment.data.amount, 4250);
    assert.equal(installment.test, true);
    assert.equal(installment.data.opportunityId, undefined);
    assert.deepEqual(installment.data.stripe.futureInvoiceIds, ['in_future_1']);
    assert.equal(installment.data.installments, undefined);

    const full = buildFrontDeskPaymentEvent({
      payload: submission({
        name: LIVE_NAME,
        email: LIVE_EMAIL,
        paymentOption: 'full',
        totalPrice: 8500,
        deposit: 1000,
        monthlyPayment: 0,
        months: 0,
        payoffDate: null,
      }),
      submissionId: 'subm_full',
      stripeKey: 'sk_live_example',
    });
    assert.equal(full.data.method, 'stripe_invoice');
    assert.equal(full.data.amount, 8500);
    assert.equal(full.test, false);
    assert.equal(full.data.opportunityId, undefined);
    assertEnvelopeHasNoPhi({ data: full.data });
  });

  it('sets test when the Stripe key is a test key or the record is ZZTEST', () => {
    assert.equal(isStripeTestMode('sk_test_zztest'), true);
    assert.equal(isStripeTestMode('rk_test_zztest'), true);
    assert.equal(isStripeTestMode('sk_live_example'), false);
    assert.equal(isStripeTestMode('rk_live_example'), false);
    assert.equal(isStripeTestMode(''), false);
    assert.equal(isStripeTestMode(undefined), false);

    assert.equal(isZztestRecord(submission()), true);
    assert.equal(isZztestRecord({ name: '  ZZTEST Patient' }), true);
    assert.equal(isZztestRecord({ name: LIVE_NAME, email: EMAIL }), true);
    assert.equal(isZztestRecord({ name: LIVE_NAME, email: LIVE_EMAIL, opportunityId: 'ZZTEST-rec' }), true);
    assert.equal(isZztestRecord({ name: LIVE_NAME, email: LIVE_EMAIL, opportunityId: OPPORTUNITY_ID }), false);
    assert.equal(isZztestRecord(null), false);

    const liveKeyZztest = buildFrontDeskPaymentEvent({
      payload: submission(),
      submissionId: 'subm_zztest',
      stripeKey: 'sk_live_example',
    });
    assert.equal(liveKeyZztest.test, true);

    const testKeyLiveRecord = buildFrontDeskPaymentEvent({
      payload: submission({ name: LIVE_NAME, email: LIVE_EMAIL }),
      submissionId: 'subm_live',
      stripeKey: 'rk_test_zztest',
    });
    assert.equal(testKeyLiveRecord.test, true);

    const blankOpportunity = buildFrontDeskPaymentEvent({
      payload: submission({ name: LIVE_NAME, email: LIVE_EMAIL, opportunityId: '   ' }),
      submissionId: 'subm_live',
      stripeKey: 'sk_live_example',
    });
    assert.equal(blankOpportunity.data.opportunityId, undefined);
    assert.equal(blankOpportunity.test, false);
  });

  it('keeps the Make call on unless the flag is explicitly off', () => {
    assert.equal(isPumbleViaMakeEnabled({}), true);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: '' }), true);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: 'true' }), true);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: 'TRUE' }), true);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: 'false' }), false);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: ' FALSE ' }), false);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: '0' }), false);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: 'no' }), false);
    assert.equal(isPumbleViaMakeEnabled({ PUMBLE_VIA_MAKE_ENABLED: 'off' }), false);
  });

  it('does not reference the retired pay-notify webhook env vars', () => {
    const payNotify = fs.readFileSync(require.resolve('../pay-notify.js'), 'utf8');
    const handlerSource = fs.readFileSync(require.resolve('../index.js'), 'utf8');
    for (const text of [payNotify, handlerSource]) {
      assert.equal(text.includes('PAY_NOTIFY_WEBHOOK_URL'), false);
      assert.equal(text.includes('PAY_NOTIFY_WEBHOOK_TOKEN'), false);
    }
  });

  it('returns a failed result when the webhook times out and does not throw', async () => {
    const result = await sendPaymentNotification({
      payload: submission({ name: LIVE_NAME, email: LIVE_EMAIL }),
      submissionId: 'subm_timeout',
      stripeKey: 'sk_live_example',
      stripe: {},
      timeoutMs: 20,
      env: frontDeskEnv(),
      fetchImpl: (_url, opts) => new Promise((_resolve, reject) => {
        const fail = () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        };
        if (opts.signal.aborted) return fail();
        opts.signal.addEventListener('abort', fail, { once: true });
      }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'timeout');
    assert.equal(result.attempts, 2);
    assert.equal(result.eventId, 'payment_plan_submitted:subm_timeout');
    const logged = `${logs.join('\n')}\n${errors.join('\n')}`;
    assert.equal(logged.includes(TOKEN), false);
    assert.equal(logged.includes(FRONT_DESK_HOST), false);
    assert.equal(logged.includes(LIVE_NAME), false);
    assert.equal(logged.includes(LIVE_EMAIL), false);
    assert.match(logged, /status=timeout/);
  });
});

describe('price submission handler notification', () => {
  it('skips the Front Desk webhook when the URL is unset and still calls Make', async () => {
    const body = submission();
    const { response, json } = await submit(body, {
      MAKE_WEBHOOK_URL: MAKE_URL,
      PAY_NOTIFY_WEBHOOK_URL: OLD_NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });

    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 0);
    assert.equal(requestsTo(OLD_NOTIFY_HOST).length, 0);
    assert.equal(requestsTo(MAKE_HOST).length, 1);
    assert.deepEqual(JSON.parse(requestsTo(MAKE_HOST)[0].body), body);
    assert.equal(requestsTo(MAKE_HOST)[0].options.headers.Authorization, undefined);
    assert.ok(logs.some((line) => line.includes('status=skipped') && line.includes(`eventId=${EVENT}:${json.submissionId}`)));
    assert.equal(
      logs.find((line) => line.startsWith('Calling make.com webhook:')),
      `Calling make.com webhook: ${json.submissionId}`,
    );
    assertLogsSafe(json.submissionId);
  });

  it('posts the v1 envelope for a plan, an installment plan, and pay-in-full', async () => {
    const cases = [
      {
        label: 'plan',
        stripeKey: 'sk_test_zztest',
        body: submission({ isSlidingScale: true, opportunityId: OPPORTUNITY_ID }),
        method: 'stripe_subscription_schedule',
        amount: 4250,
        test: true,
        opportunityId: OPPORTUNITY_ID,
        subscriptionId: 'sub_zztest',
        scheduleId: 'sub_sched_zztest',
        futureInvoiceIds: null,
        sequence: [
          'dynamo-put',
          'stripe-invoice',
          'stripe-schedule',
          'dynamo-update',
          `fetch:${FRONT_DESK_HOST}`,
        ],
      },
      {
        label: 'installment',
        stripeKey: 'sk_test_zztest',
        body: submission({
          paymentOption: 'installment',
          deposit: 4000,
          totalPrice: 9000,
          monthlyPayment: 0,
          months: 2,
          isSlidingScale: false,
          payoffDate: '2026-10-01T00:00:00.000Z',
          installments: [
            { amount: 2500, dueDate: '2026-08-01' },
            { amount: 2500, dueDate: '2026-10-01' },
          ],
        }),
        method: 'stripe_scheduled_invoices',
        amount: 4000,
        test: true,
        opportunityId: undefined,
        subscriptionId: null,
        scheduleId: null,
        futureInvoiceIds: ['in_future_1', 'in_future_2'],
        sequence: [
          'dynamo-put',
          'stripe-invoice',
          'stripe-invoice',
          'stripe-invoice',
          'dynamo-update',
          `fetch:${FRONT_DESK_HOST}`,
        ],
      },
      {
        label: 'full',
        stripeKey: 'sk_live_example',
        body: submission({
          name: LIVE_NAME,
          email: LIVE_EMAIL,
          paymentOption: 'full',
          totalPrice: 8500,
          deposit: 1000,
          monthlyPayment: 0,
          months: 0,
          payoffDate: null,
        }),
        method: 'stripe_invoice',
        amount: 8500,
        test: false,
        opportunityId: undefined,
        subscriptionId: null,
        scheduleId: null,
        futureInvoiceIds: null,
        sequence: [
          'dynamo-put',
          'stripe-invoice',
          'dynamo-update',
          `fetch:${FRONT_DESK_HOST}`,
        ],
      },
    ];

    for (const item of cases) {
      requests.length = 0;
      sequence.length = 0;
      logs.length = 0;
      errors.length = 0;
      resetFrontDeskEventForTests();
      for (const key of MANAGED_ENV) delete process.env[key];

      const { response, json } = await submit(item.body, {
        ...stripeEnv(item.stripeKey),
        ...frontDeskEnv(),
      });

      assert.equal(response.statusCode, 200, item.label);
      assert.equal(json.success, true, item.label);
      assert.equal(json.invoiceUrl, 'https://invoice.example.test/in_deposit_zztest', item.label);
      assert.deepEqual(sequence, item.sequence, item.label);
      assert.equal(requestsTo(MAKE_HOST).length, 0, item.label);
      assert.equal(requestsTo(OLD_NOTIFY_HOST).length, 0, item.label);

      const notify = requestsTo(FRONT_DESK_HOST);
      assert.equal(notify.length, 1, item.label);
      assert.equal(notify[0].options.path, '/hooks/front-desk', item.label);

      const sent = JSON.parse(notify[0].body);
      assert.match(sent.occurredAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, item.label);
      assert.ok(Math.abs(Date.now() - Date.parse(sent.occurredAt)) < 10000, item.label);
      const occurredAt = sent.occurredAt;
      delete sent.occurredAt;

      const expected = {
        version: 1,
        event: 'payment_plan_submitted',
        eventId: `payment_plan_submitted:${json.submissionId}`,
        source: SOURCE,
        test: item.test,
        data: {
          submissionId: json.submissionId,
          paymentOption: item.body.paymentOption,
          amount: item.amount,
          method: item.method,
          stripe: {
            customerId: 'cus_zztest',
            invoiceId: 'in_deposit_zztest',
            invoiceUrl: 'https://invoice.example.test/in_deposit_zztest',
            subscriptionScheduleId: item.scheduleId,
            subscriptionId: item.subscriptionId,
            futureInvoiceIds: item.futureInvoiceIds,
          },
        },
      };
      if (item.opportunityId) expected.data.opportunityId = item.opportunityId;

      assert.deepEqual(sent, expected, item.label);
      assert.equal(occurredAt.endsWith('Z'), true, item.label);
      assertEnvelopeHasNoPhi(sent);

      const headers = notify[0].options.headers;
      assert.equal(headers['Content-Type'], 'application/json', item.label);
      assert.equal(headers.Authorization, `Bearer ${TOKEN}`, item.label);
      assert.equal(headers.Authorization.includes('Bearer Bearer'), false, item.label);
      assert.equal(headers['X-Patient-Name'], undefined, item.label);
      assert.equal(headers['X-Event-Type'], undefined, item.label);
      assert.ok(logs.some((line) => (
        line.includes('status=200')
        && line.includes(`eventId=payment_plan_submitted:${json.submissionId}`)
      )), item.label);
      assertLogsSafe(json.submissionId);
    }
  });

  it('marks a live-key ZZTEST submission as a test and omits opportunityId when absent', async () => {
    const { response, json } = await submit(submission(), {
      ...stripeEnv('sk_live_example'),
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 200);
    const sent = JSON.parse(requestsTo(FRONT_DESK_HOST)[0].body);
    assert.equal(sent.test, true);
    assert.equal(sent.eventId, `payment_plan_submitted:${json.submissionId}`);
    assert.equal(sent.data.opportunityId, undefined);
    assertEnvelopeHasNoPhi(sent);
    assertLogsSafe(json.submissionId);
  });

  it('does not prefix Bearer when the token already has it', async () => {
    const { response, json } = await submit(submission({ name: LIVE_NAME, email: LIVE_EMAIL }), {
      ...stripeEnv('sk_live_example'),
      ...frontDeskEnv(`Bearer ${TOKEN}`),
    });
    assert.equal(response.statusCode, 200);
    const headers = requestsTo(FRONT_DESK_HOST)[0].options.headers;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(headers.Authorization.includes('Bearer Bearer'), false);
    const sent = JSON.parse(requestsTo(FRONT_DESK_HOST)[0].body);
    assert.equal(sent.test, false);
    assertLogsSafe(json.submissionId);
  });

  it('returns 200 when the Front Desk webhook responds with an error status', async () => {
    behaviors[FRONT_DESK_HOST] = 502;
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 2);
    assert.ok(logs.some((line) => line.includes('status=502') && line.includes(json.submissionId)));
    assertLogsSafe(json.submissionId);
  });

  it('returns 200 when the Front Desk webhook rejects the event', async () => {
    behaviors[FRONT_DESK_HOST] = 400;
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 1);
    assert.ok(logs.some((line) => line.includes('status=400')));
    assertLogsSafe(json.submissionId);
  });

  it('returns 200 when the Front Desk webhook errors', async () => {
    behaviors[FRONT_DESK_HOST] = 'error';
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 2);
    assert.ok(logs.some((line) => line.includes('status=error') && line.includes(json.submissionId)));
    assert.equal(errors.some((line) => line.includes(FRONT_DESK_URL)), false);
    assertLogsSafe(json.submissionId);
  });

  it('keeps the Make payload when the flag is true', async () => {
    const body = submission();
    const { response, json } = await submit(body, {
      MAKE_WEBHOOK_URL: MAKE_URL,
      PUMBLE_VIA_MAKE_ENABLED: 'true',
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(sequence, [
      'dynamo-put',
      `https:${MAKE_HOST}`,
      `fetch:${FRONT_DESK_HOST}`,
    ]);
    const make = requestsTo(MAKE_HOST)[0];
    assert.deepEqual(JSON.parse(make.body), body);
    assert.equal(make.options.headers.Authorization, undefined);
    assert.equal(make.options.path, '/webhook/pricing');
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 1);
    assertLogsSafe(json.submissionId);
  });

  it('skips Make when the flag is false and still notifies', async () => {
    for (const flag of ['false', '0']) {
      requests.length = 0;
      sequence.length = 0;
      logs.length = 0;
      errors.length = 0;
      resetFrontDeskEventForTests();
      for (const key of MANAGED_ENV) delete process.env[key];

      const { response, json } = await submit(submission(), {
        ...stripeEnv(),
        MAKE_WEBHOOK_URL: MAKE_URL,
        PUMBLE_VIA_MAKE_ENABLED: flag,
        ...frontDeskEnv(),
      });
      assert.equal(response.statusCode, 200, flag);
      assert.equal(requestsTo(MAKE_HOST).length, 0, flag);
      assert.equal(requestsTo(FRONT_DESK_HOST).length, 1, flag);
      assert.ok(logs.some((line) => line.startsWith('PUMBLE_VIA_MAKE_ENABLED is false — skipping make.com webhook:')), flag);
      assertLogsSafe(json.submissionId);
    }
  });

  it('still fails the submission when Make returns an error', async () => {
    behaviors[MAKE_HOST] = 500;
    const { response, json } = await submit(submission(), {
      MAKE_WEBHOOK_URL: MAKE_URL,
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 500);
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 0);
    assert.equal(requestsTo(MAKE_HOST).length, 1);
    assert.equal(json.message, 'Webhook returned status 500');
  });

  it('does not return or log a Make error body that contains a name or email', async () => {
    behaviors[MAKE_HOST] = 'phi';
    const { response, json } = await submit(submission(), {
      MAKE_WEBHOOK_URL: MAKE_URL,
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 500);
    assert.equal(json.message.includes(PATIENT), false);
    assert.equal(json.message.includes(EMAIL), false);
    assert.equal(requestsTo(FRONT_DESK_HOST).length, 0);
    const text = `${logs.join('\n')}\n${errors.join('\n')}\n${response.body}`;
    assert.equal(text.includes(PATIENT), false);
    assert.equal(text.includes(EMAIL), false);
  });

  it('notifies with empty Stripe ids when Stripe throws', async () => {
    stripeFails = true;
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      ...frontDeskEnv(),
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(json.invoiceUrl, undefined);
    assert.equal(sequence.includes('dynamo-update'), false);
    const sent = JSON.parse(requestsTo(FRONT_DESK_HOST)[0].body);
    assert.deepEqual(sent.data.stripe, {
      customerId: null,
      invoiceId: null,
      invoiceUrl: null,
      subscriptionScheduleId: null,
      subscriptionId: null,
      futureInvoiceIds: null,
    });
    assert.equal(sent.test, true);
    assert.equal(sent.event, 'payment_plan_submitted');
    assertEnvelopeHasNoPhi(sent);
    assertLogsSafe(json.submissionId);
  });
});
