const https = require('https');

const NOTIFY_TIMEOUT_MS = 5000;

function isPumbleViaMakeEnabled(env = process.env) {
  const raw = env.PUMBLE_VIA_MAKE_ENABLED;
  if (raw == null) return true;
  const value = String(raw).trim().toLowerCase();
  if (value === '') return true;
  return value !== 'false' && value !== '0' && value !== 'no' && value !== 'off';
}

// Matt's sender key is the bearer value. Leave a value that already
// starts with "Bearer " alone so the header is not "Bearer Bearer ...".
function authorizationHeader(token) {
  if (token == null) return null;
  const value = String(token).trim();
  if (!value) return null;
  if (/^Bearer\s+/i.test(value)) return value;
  return `Bearer ${value}`;
}

function paymentEvent(paymentOption) {
  return paymentOption === 'full' ? 'payment_submitted' : 'plan_selected';
}

function paymentMethod(paymentOption) {
  if (paymentOption === 'installment') return 'stripe_scheduled_invoices';
  if (paymentOption === 'plan') return 'stripe_subscription_schedule';
  return 'stripe_invoice';
}

function isStripeTestMode(stripeKey) {
  return typeof stripeKey === 'string'
    && (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_'));
}

function buildPaymentNotification({ payload, submissionId, stripe = {}, stripeKey, now = new Date() }) {
  const paymentOption = payload.paymentOption;
  const amount = paymentOption === 'full' ? payload.totalPrice : payload.deposit;
  const plan = {
    totalPrice: payload.totalPrice,
    deposit: payload.deposit ?? null,
    monthlyPayment: payload.monthlyPayment ?? null,
    months: payload.months ?? null,
    isSlidingScale: Boolean(payload.isSlidingScale),
    payoffDate: payload.payoffDate || null,
  };
  if (Array.isArray(payload.installments)) {
    plan.installments = payload.installments;
  }

  const stripeInfo = {
    customerId: stripe.customerId || null,
    invoiceId: stripe.invoiceId || null,
    invoiceUrl: stripe.invoiceUrl || null,
    subscriptionScheduleId: stripe.subscriptionScheduleId || null,
    subscriptionId: stripe.subscriptionId || null,
    futureInvoiceIds: stripe.futureInvoiceIds || null,
  };

  const body = {
    event: paymentEvent(paymentOption),
    patientName: payload.name,
    paymentOption,
    plan,
    amount,
    method: paymentMethod(paymentOption),
    stripe: stripeInfo,
    submissionId,
    testMode: isStripeTestMode(stripeKey),
    timestamp: (now instanceof Date ? now : new Date(now)).toISOString(),
  };

  const headers = {
    'X-Event-Type': body.event,
    'X-Patient-Name': encodeURIComponent(payload.name || ''),
    'X-Submission-Id': submissionId || '',
    'X-Stripe-Customer-Id': stripeInfo.customerId || '',
    'X-Stripe-Subscription-Id': stripeInfo.subscriptionId || '',
    'X-Stripe-Invoice-Id': stripeInfo.invoiceId || '',
    'X-Amount': amount == null ? '' : String(amount),
    'X-Payment-Option': paymentOption || '',
  };

  return { body, headers };
}

function withAuthorization(headers, token) {
  const authorization = authorizationHeader(token);
  if (!authorization) return { ...headers };
  return { ...headers, Authorization: authorization };
}

function postPaymentNotification(url, body, headers, timeoutMs, httpsImpl = https) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    let urlObj;
    try {
      urlObj = new URL(url);
    } catch (err) {
      done(reject, err);
      return;
    }

    const postData = JSON.stringify(body);
    const req = httpsImpl.request({
      hostname: urlObj.hostname,
      port: urlObj.port || 443,
      path: `${urlObj.pathname}${urlObj.search}`,
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    }, (res) => {
      res.on('data', () => {});
      res.on('end', () => done(resolve, res.statusCode));
    });

    req.setTimeout(timeoutMs, () => {
      const error = new Error('timeout');
      error.code = 'TIMEOUT';
      done(reject, error);
      req.destroy(error);
    });

    req.on('error', (error) => done(reject, error));
    req.write(postData);
    req.end();
  });
}

async function sendPaymentNotification({ payload, submissionId, stripe, stripeKey, httpsImpl }) {
  const url = process.env.PAY_NOTIFY_WEBHOOK_URL;
  if (url == null || String(url).trim() === '') {
    console.log('PAY_NOTIFY_WEBHOOK_URL not set — skipping payment notification:', submissionId);
    return;
  }

  try {
    const { body, headers } = buildPaymentNotification({
      payload,
      submissionId,
      stripe,
      stripeKey,
    });
    const statusCode = await postPaymentNotification(
      String(url).trim(),
      body,
      withAuthorization(headers, process.env.PAY_NOTIFY_WEBHOOK_TOKEN),
      NOTIFY_TIMEOUT_MS,
      httpsImpl,
    );
    console.log('Payment notification status:', statusCode);
  } catch (err) {
    if (err && err.code === 'TIMEOUT') {
      console.error('Payment notification timed out:', submissionId);
      return;
    }
    console.error('Payment notification failed:', submissionId);
  }
}

module.exports = {
  NOTIFY_TIMEOUT_MS,
  isPumbleViaMakeEnabled,
  authorizationHeader,
  isStripeTestMode,
  buildPaymentNotification,
  sendPaymentNotification,
};
