'use strict';

// JRDO-94. Posts payment_plan_submitted through the vendored Front Desk helper.
// Name, email, and other PHI stay out of the event and the logs.
// A failed send must not reject: sendFrontDeskEvent never throws, and the
// catch below is a backstop so the patient's submission still returns.

const { sendFrontDeskEvent } = require('./front-desk-event');

const EVENT = 'payment_plan_submitted';
const SOURCE = 'price-submission-handler';

function isPumbleViaMakeEnabled(env = process.env) {
  const raw = env.PUMBLE_VIA_MAKE_ENABLED;
  if (raw == null) return true;
  const value = String(raw).trim().toLowerCase();
  if (value === '') return true;
  return value !== 'false' && value !== '0' && value !== 'no' && value !== 'off';
}

function isStripeTestMode(stripeKey) {
  return typeof stripeKey === 'string'
    && (stripeKey.startsWith('sk_test_') || stripeKey.startsWith('rk_test_'));
}

function startsWithZztest(value) {
  return typeof value === 'string' && value.trim().toLowerCase().startsWith('zztest');
}

// A ZZTEST record is a fixture. The routine then prefixes its note [TEST]
// and skips follow-ups. Checked here so the flag can be set without
// putting the name or email on the event.
function isZztestRecord(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return startsWithZztest(payload.name)
    || startsWithZztest(payload.email)
    || startsWithZztest(payload.opportunityId);
}

function paymentMethod(paymentOption) {
  if (paymentOption === 'installment') return 'stripe_scheduled_invoices';
  if (paymentOption === 'plan') return 'stripe_subscription_schedule';
  return 'stripe_invoice';
}

function paymentAmount(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const amount = payload.paymentOption === 'full' ? payload.totalPrice : payload.deposit;
  return typeof amount === 'number' ? amount : null;
}

function opportunityIdFrom(payload) {
  if (!payload || typeof payload.opportunityId !== 'string') return '';
  return payload.opportunityId.trim();
}

function stripeInfo(stripe = {}) {
  return {
    customerId: stripe.customerId || null,
    invoiceId: stripe.invoiceId || null,
    invoiceUrl: stripe.invoiceUrl || null,
    subscriptionScheduleId: stripe.subscriptionScheduleId || null,
    subscriptionId: stripe.subscriptionId || null,
    futureInvoiceIds: stripe.futureInvoiceIds || null,
  };
}

function buildFrontDeskPaymentEvent({ payload, submissionId, stripe, stripeKey }) {
  const opportunityId = opportunityIdFrom(payload);
  const data = {
    submissionId,
    ...(opportunityId ? { opportunityId } : {}),
    paymentOption: payload && payload.paymentOption,
    amount: paymentAmount(payload),
    method: paymentMethod(payload && payload.paymentOption),
    stripe: stripeInfo(stripe),
  };

  const id = submissionId == null ? '' : String(submissionId).trim();
  return {
    event: EVENT,
    eventId: id ? `${EVENT}:${id}` : '',
    source: SOURCE,
    test: isStripeTestMode(stripeKey) || isZztestRecord(payload),
    data,
  };
}

function notifyOptions(input) {
  const options = {};
  if (input.fetchImpl) options.fetchImpl = input.fetchImpl;
  if (input.env) options.env = input.env;
  if (input.logger) options.logger = input.logger;
  if (Number.isFinite(input.timeoutMs)) options.timeoutMs = input.timeoutMs;
  if (input.now instanceof Date) options.now = input.now;
  return options;
}

async function sendPaymentNotification(input = {}) {
  const submissionId = input.submissionId;
  try {
    return await sendFrontDeskEvent(buildFrontDeskPaymentEvent(input), notifyOptions(input));
  } catch {
    console.error('Payment notification failed:', submissionId);
    return {
      ok: false,
      status: 'error',
      eventId: submissionId ? `${EVENT}:${submissionId}` : undefined,
    };
  }
}

module.exports = {
  EVENT,
  SOURCE,
  isPumbleViaMakeEnabled,
  isStripeTestMode,
  isZztestRecord,
  buildFrontDeskPaymentEvent,
  sendPaymentNotification,
};
