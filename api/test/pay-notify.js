const { before, after, beforeEach, describe, it } = require('node:test');
const assert = require('node:assert/strict');
const https = require('https');
const Module = require('module');
const { EventEmitter } = require('events');

const PATIENT = 'Zztest Patient';
const EMAIL = 'zztest.patient@example.test';
const NOTIFY_HOST = 'notify.example.test';
const MAKE_HOST = 'make.example.test';
const NOTIFY_URL = `https://${NOTIFY_HOST}/hooks/payment`;
const MAKE_URL = `https://${MAKE_HOST}/webhook/pricing`;
const TOKEN = 'notify-test-token';

const MANAGED_ENV = [
  'MAKE_WEBHOOK_URL',
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
    res.statusCode = typeof behavior === 'number' ? behavior : 200;
    process.nextTick(() => {
      callback(res);
      res.emit('data', '');
      res.emit('end');
    });
  };
  return req;
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

const {
  NOTIFY_TIMEOUT_MS,
  isPumbleViaMakeEnabled,
  authorizationHeader,
  isStripeTestMode,
  buildPaymentNotification,
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
  assert.equal(text.includes(NOTIFY_HOST), false);
  assert.equal(text.includes(MAKE_HOST), false);
  assert.equal(text.includes(TOKEN), false);
  assert.equal(text.includes('sk_test_zztest'), false);
  assert.equal(text.includes('sk_live_zztest'), false);
  assert.equal(text.includes('rk_test_zztest'), false);
  const writing = logs.filter((line) => line.startsWith('Writing to DynamoDB:'));
  assert.deepEqual(writing, [`Writing to DynamoDB: ${submissionId}`]);
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
  for (const key of MANAGED_ENV) delete process.env[key];
});

beforeEach(() => {
  requests.length = 0;
  sequence.length = 0;
  logs.length = 0;
  errors.length = 0;
  stripeFails = false;
  for (const key of Object.keys(behaviors)) delete behaviors[key];
  for (const key of MANAGED_ENV) delete process.env[key];
});

describe('payment notification helpers', () => {
  it('builds plan, installment, and full notifications', () => {
    const plan = buildPaymentNotification({
      payload: submission({ isSlidingScale: true }),
      submissionId: 'subm_zztest',
      stripeKey: 'sk_test_zztest',
      stripe: { customerId: 'cus_zztest', invoiceId: 'in_deposit_zztest' },
      now: new Date('2026-10-14T22:54:25.452Z'),
    });
    assert.equal(plan.body.event, 'plan_selected');
    assert.equal(plan.body.method, 'stripe_subscription_schedule');
    assert.equal(plan.body.amount, 4250);
    assert.equal(plan.body.testMode, true);
    assert.equal(plan.body.patientName, PATIENT);
    assert.equal(plan.body.timestamp, '2026-10-14T22:54:25.452Z');
    assert.equal(plan.body.plan.installments, undefined);
    assert.equal(plan.body.email, undefined);
    assert.equal(plan.headers['X-Patient-Name'], 'Zztest%20Patient');
    assert.equal(plan.headers['X-Amount'], '4250');

    const installments = [
      { amount: 2125, dueDate: '2026-08-01' },
      { amount: 2125, dueDate: '2026-10-01' },
    ];
    const installment = buildPaymentNotification({
      payload: submission({
        paymentOption: 'installment',
        deposit: 4250,
        monthlyPayment: 0,
        months: 2,
        installments,
      }),
      submissionId: 'subm_zztest',
      stripeKey: 'rk_test_zztest',
    });
    assert.equal(installment.body.event, 'plan_selected');
    assert.equal(installment.body.method, 'stripe_scheduled_invoices');
    assert.equal(installment.body.amount, 4250);
    assert.equal(installment.body.testMode, true);
    assert.deepEqual(installment.body.plan.installments, installments);

    const full = buildPaymentNotification({
      payload: submission({
        paymentOption: 'full',
        totalPrice: 8500,
        deposit: 1000,
        monthlyPayment: 0,
        months: 0,
        payoffDate: null,
      }),
      submissionId: 'subm_zztest',
      stripeKey: 'sk_live_zztest',
    });
    assert.equal(full.body.event, 'payment_submitted');
    assert.equal(full.body.method, 'stripe_invoice');
    assert.equal(full.body.amount, 8500);
    assert.equal(full.body.testMode, false);
    assert.equal(full.headers['X-Amount'], '8500');
    assert.equal(full.headers['X-Event-Type'], 'payment_submitted');
  });

  it('does not double a Bearer prefix', () => {
    assert.equal(authorizationHeader(null), null);
    assert.equal(authorizationHeader(''), null);
    assert.equal(authorizationHeader('   '), null);
    assert.equal(authorizationHeader(TOKEN), `Bearer ${TOKEN}`);
    assert.equal(authorizationHeader(`Bearer ${TOKEN}`), `Bearer ${TOKEN}`);
    assert.equal(authorizationHeader(`bearer ${TOKEN}`), `bearer ${TOKEN}`);
    assert.equal(authorizationHeader(`  Bearer ${TOKEN}  `), `Bearer ${TOKEN}`);
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

  it('treats Stripe test keys as test mode', () => {
    assert.equal(NOTIFY_TIMEOUT_MS, 5000);
    assert.equal(isStripeTestMode('sk_test_zztest'), true);
    assert.equal(isStripeTestMode('rk_test_zztest'), true);
    assert.equal(isStripeTestMode('sk_live_zztest'), false);
    assert.equal(isStripeTestMode('rk_live_zztest'), false);
    assert.equal(isStripeTestMode(''), false);
    assert.equal(isStripeTestMode(undefined), false);
  });
});

describe('price submission handler notification', () => {
  it('skips the payment webhook when the URL is unset and still calls Make', async () => {
    const body = submission();
    const { response, json } = await submit(body, { MAKE_WEBHOOK_URL: MAKE_URL });

    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(requestsTo(NOTIFY_HOST).length, 0);
    assert.equal(requestsTo(MAKE_HOST).length, 1);
    assert.deepEqual(JSON.parse(requestsTo(MAKE_HOST)[0].body), body);
    assert.equal(requestsTo(MAKE_HOST)[0].options.headers.Authorization, undefined);
    assert.equal(requestsTo(MAKE_HOST)[0].timeoutMs, null);
    assert.ok(logs.some((line) => line.startsWith('PAY_NOTIFY_WEBHOOK_URL not set — skipping payment notification:')));
    assert.equal(
      logs.find((line) => line.startsWith('Calling make.com webhook:')),
      `Calling make.com webhook: ${json.submissionId}`,
    );
    assertLogsSafe(json.submissionId);
  });

  it('posts body and headers for a plan, an installment plan, and pay-in-full', async () => {
    const cases = [
      {
        label: 'plan',
        stripeKey: 'sk_test_zztest',
        body: submission({ isSlidingScale: true }),
        event: 'plan_selected',
        method: 'stripe_subscription_schedule',
        amount: 4250,
        testMode: true,
        subscriptionId: 'sub_zztest',
        scheduleId: 'sub_sched_zztest',
        futureInvoiceIds: null,
        sequence: [
          'dynamo-put',
          'stripe-invoice',
          'stripe-schedule',
          'dynamo-update',
          `https:${NOTIFY_HOST}`,
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
        event: 'plan_selected',
        method: 'stripe_scheduled_invoices',
        amount: 4000,
        testMode: true,
        subscriptionId: '',
        scheduleId: null,
        futureInvoiceIds: ['in_future_1', 'in_future_2'],
        sequence: [
          'dynamo-put',
          'stripe-invoice',
          'stripe-invoice',
          'stripe-invoice',
          'dynamo-update',
          `https:${NOTIFY_HOST}`,
        ],
      },
      {
        label: 'full',
        stripeKey: 'sk_live_zztest',
        body: submission({
          paymentOption: 'full',
          totalPrice: 8500,
          deposit: 1000,
          monthlyPayment: 0,
          months: 0,
          payoffDate: null,
        }),
        event: 'payment_submitted',
        method: 'stripe_invoice',
        amount: 8500,
        testMode: false,
        subscriptionId: '',
        scheduleId: null,
        futureInvoiceIds: null,
        sequence: [
          'dynamo-put',
          'stripe-invoice',
          'dynamo-update',
          `https:${NOTIFY_HOST}`,
        ],
      },
    ];

    for (const item of cases) {
      requests.length = 0;
      sequence.length = 0;
      logs.length = 0;
      errors.length = 0;
      for (const key of MANAGED_ENV) delete process.env[key];

      const { response, json } = await submit(item.body, {
        ...stripeEnv(item.stripeKey),
        PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
        PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
      });

      assert.equal(response.statusCode, 200, item.label);
      assert.equal(json.success, true, item.label);
      assert.equal(json.invoiceUrl, 'https://invoice.example.test/in_deposit_zztest', item.label);
      assert.deepEqual(sequence, item.sequence, item.label);
      assert.equal(requestsTo(MAKE_HOST).length, 0, item.label);

      const notify = requestsTo(NOTIFY_HOST);
      assert.equal(notify.length, 1, item.label);
      assert.equal(notify[0].options.path, '/hooks/payment', item.label);
      assert.equal(notify[0].timeoutMs, 5000, item.label);

      const sent = JSON.parse(notify[0].body);
      assert.match(sent.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, item.label);
      assert.ok(Math.abs(Date.now() - Date.parse(sent.timestamp)) < 10000, item.label);
      const timestamp = sent.timestamp;
      delete sent.timestamp;

      const expectedPlan = {
        totalPrice: item.body.totalPrice,
        deposit: item.body.deposit,
        monthlyPayment: item.body.monthlyPayment,
        months: item.body.months,
        isSlidingScale: item.body.isSlidingScale,
        payoffDate: item.body.payoffDate,
      };
      if (item.body.installments) expectedPlan.installments = item.body.installments;

      assert.deepEqual(sent, {
        event: item.event,
        patientName: PATIENT,
        paymentOption: item.body.paymentOption,
        plan: expectedPlan,
        amount: item.amount,
        method: item.method,
        stripe: {
          customerId: 'cus_zztest',
          invoiceId: 'in_deposit_zztest',
          invoiceUrl: 'https://invoice.example.test/in_deposit_zztest',
          subscriptionScheduleId: item.scheduleId,
          subscriptionId: item.subscriptionId || null,
          futureInvoiceIds: item.futureInvoiceIds,
        },
        submissionId: json.submissionId,
        testMode: item.testMode,
      }, item.label);
      assert.equal(sent.email, undefined, item.label);
      assert.equal(timestamp.endsWith('Z'), true, item.label);

      const headers = notify[0].options.headers;
      assert.equal(headers['Content-Type'], 'application/json', item.label);
      assert.equal(headers.Authorization, `Bearer ${TOKEN}`, item.label);
      assert.equal(headers.Authorization.includes('Bearer Bearer'), false, item.label);
      assert.equal(headers['X-Event-Type'], item.event, item.label);
      assert.equal(headers['X-Patient-Name'], 'Zztest%20Patient', item.label);
      assert.equal(headers['X-Submission-Id'], json.submissionId, item.label);
      assert.equal(headers['X-Stripe-Customer-Id'], 'cus_zztest', item.label);
      assert.equal(headers['X-Stripe-Subscription-Id'], item.subscriptionId, item.label);
      assert.equal(headers['X-Stripe-Invoice-Id'], 'in_deposit_zztest', item.label);
      assert.equal(headers['X-Amount'], String(item.amount), item.label);
      assert.equal(headers['X-Payment-Option'], item.body.paymentOption, item.label);
      assert.ok(logs.includes(`Payment notification status: 200`), item.label);
      assertLogsSafe(json.submissionId);
    }
  });

  it('does not prefix Bearer when the token already has it', async () => {
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: `Bearer ${TOKEN}`,
    });
    assert.equal(response.statusCode, 200);
    const headers = requestsTo(NOTIFY_HOST)[0].options.headers;
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(headers.Authorization.includes('Bearer Bearer'), false);
    assertLogsSafe(json.submissionId);
  });

  it('returns 200 when the payment webhook responds with an error status', async () => {
    behaviors[NOTIFY_HOST] = 502;
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.ok(logs.includes('Payment notification status: 502'));
    assertLogsSafe(json.submissionId);
  });

  it('returns 200 when the payment webhook errors', async () => {
    behaviors[NOTIFY_HOST] = 'error';
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.ok(errors.some((line) => line === `Payment notification failed: ${json.submissionId}`));
    assertLogsSafe(json.submissionId);
  });

  it('returns 200 when the payment webhook times out', async () => {
    behaviors[NOTIFY_HOST] = 'timeout';
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(requestsTo(NOTIFY_HOST)[0].timeoutMs, 5000);
    assert.ok(errors.some((line) => line === `Payment notification timed out: ${json.submissionId}`));
    assertLogsSafe(json.submissionId);
  });

  it('keeps the Make payload when the flag is true', async () => {
    const body = submission();
    const { response, json } = await submit(body, {
      MAKE_WEBHOOK_URL: MAKE_URL,
      PUMBLE_VIA_MAKE_ENABLED: 'true',
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(requestsTo(MAKE_HOST).length, 1);
    const make = requestsTo(MAKE_HOST)[0];
    assert.deepEqual(JSON.parse(make.body), body);
    assert.equal(make.options.headers['X-Event-Type'], undefined);
    assert.equal(make.options.headers.Authorization, undefined);
    assert.equal(make.timeoutMs, null);
    assert.equal(make.options.path, '/webhook/pricing');
    assert.equal(requestsTo(NOTIFY_HOST).length, 1);
    assert.ok(sequence.indexOf(`https:${MAKE_HOST}`) < sequence.indexOf('dynamo-update')
      || sequence.indexOf('dynamo-update') === -1);
    assert.ok(sequence.indexOf(`https:${MAKE_HOST}`) < sequence.indexOf(`https:${NOTIFY_HOST}`));
    assertLogsSafe(json.submissionId);
  });

  it('skips Make when the flag is false and still notifies', async () => {
    for (const flag of ['false', '0']) {
      requests.length = 0;
      sequence.length = 0;
      logs.length = 0;
      errors.length = 0;
      for (const key of MANAGED_ENV) delete process.env[key];

      const { response, json } = await submit(submission(), {
        ...stripeEnv(),
        MAKE_WEBHOOK_URL: MAKE_URL,
        PUMBLE_VIA_MAKE_ENABLED: flag,
        PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
        PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
      });
      assert.equal(response.statusCode, 200, flag);
      assert.equal(requestsTo(MAKE_HOST).length, 0, flag);
      assert.equal(requestsTo(NOTIFY_HOST).length, 1, flag);
      assert.ok(logs.some((line) => line.startsWith('PUMBLE_VIA_MAKE_ENABLED is false — skipping make.com webhook:')), flag);
      assertLogsSafe(json.submissionId);
    }
  });

  it('still fails the submission when Make returns an error', async () => {
    behaviors[MAKE_HOST] = 500;
    const { response } = await submit(submission(), {
      MAKE_WEBHOOK_URL: MAKE_URL,
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });
    assert.equal(response.statusCode, 500);
    assert.equal(requestsTo(NOTIFY_HOST).length, 0);
    assert.equal(requestsTo(MAKE_HOST).length, 1);
  });

  it('notifies with empty Stripe ids when Stripe throws', async () => {
    stripeFails = true;
    const { response, json } = await submit(submission(), {
      ...stripeEnv(),
      PAY_NOTIFY_WEBHOOK_URL: NOTIFY_URL,
      PAY_NOTIFY_WEBHOOK_TOKEN: TOKEN,
    });
    assert.equal(response.statusCode, 200);
    assert.equal(json.success, true);
    assert.equal(json.invoiceUrl, undefined);
    assert.equal(sequence.includes('dynamo-update'), false);
    const sent = JSON.parse(requestsTo(NOTIFY_HOST)[0].body);
    assert.deepEqual(sent.stripe, {
      customerId: null,
      invoiceId: null,
      invoiceUrl: null,
      subscriptionScheduleId: null,
      subscriptionId: null,
      futureInvoiceIds: null,
    });
    assert.equal(sent.testMode, true);
    assert.equal(requestsTo(NOTIFY_HOST)[0].options.headers['X-Stripe-Customer-Id'], '');
    assert.equal(requestsTo(NOTIFY_HOST)[0].options.headers['X-Stripe-Subscription-Id'], '');
    assert.equal(requestsTo(NOTIFY_HOST)[0].options.headers['X-Stripe-Invoice-Id'], '');
    assertLogsSafe(json.submissionId);
  });
});
