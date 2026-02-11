/**
 * Stripe Subscription Invoice Automation
 *
 * Flow:
 *   1. Create (or find) a Stripe customer by email
 *   2. Create a one-time deposit invoice, finalize it, and send to customer
 *   3. Create a subscription schedule for monthly payments using
 *      collection_method: "send_invoice" at the phase level — Stripe
 *      emails the invoice to the customer each billing cycle instead
 *      of auto-charging. Schedule auto-cancels via end_behavior: "cancel".
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_xxx node create-subscription-invoice.js
 *
 * Or import and call processPaymentPlan() from your Lambda handler.
 */

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ---------------------------------------------------------------------------
// Configuration — swap these for your real Stripe product/price IDs
// ---------------------------------------------------------------------------

// Product ID for the one-time deposit invoice line item
const DEPOSIT_PRODUCT_ID = process.env.STRIPE_DEPOSIT_PRODUCT_ID || 'prod_DEPOSIT_PLACEHOLDER';

// Price ID for the recurring monthly subscription
// This should be a recurring price (interval: month) created in your Stripe dashboard
const MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID || 'price_MONTHLY_PLACEHOLDER';

// Number of days the customer has to pay each invoice once it's sent
const DAYS_UNTIL_DUE = 30;

// ---------------------------------------------------------------------------
// Step 1: Find or create a Stripe customer
// ---------------------------------------------------------------------------

async function findOrCreateCustomer({ name, email }) {
  // Search for existing customer by email
  const existing = await stripe.customers.list({
    email,
    limit: 1,
  });

  if (existing.data.length > 0) {
    const customer = existing.data[0];
    console.log(`Found existing customer: ${customer.id} (${customer.email})`);

    // Update name if it changed
    if (customer.name !== name) {
      await stripe.customers.update(customer.id, { name });
    }

    return customer;
  }

  // Create new customer
  const customer = await stripe.customers.create({
    name,
    email,
  });

  console.log(`Created new customer: ${customer.id} (${customer.email})`);
  return customer;
}

// ---------------------------------------------------------------------------
// Step 2: Create, finalize, and send the deposit invoice
// ---------------------------------------------------------------------------

async function createDepositInvoice({ customerId, depositAmount, description }) {
  // Create a draft invoice
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: 'send_invoice',
    days_until_due: DAYS_UNTIL_DUE,
    auto_advance: true, // automatically finalize and send
  });

  console.log(`Created draft invoice: ${invoice.id}`);

  // Add the deposit as a line item
  await stripe.invoiceItems.create({
    customer: customerId,
    invoice: invoice.id,
    amount: depositAmount, // amount in cents
    currency: 'usd',
    description: description || 'Deposit payment',
  });

  // Finalize the invoice (locks it, assigns invoice number)
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);
  console.log(`Finalized invoice: ${finalizedInvoice.id} (${finalizedInvoice.number})`);

  // Send the invoice email to the customer
  const sentInvoice = await stripe.invoices.sendInvoice(finalizedInvoice.id);
  console.log(`Sent invoice to customer: ${sentInvoice.hosted_invoice_url}`);

  return sentInvoice;
}

// ---------------------------------------------------------------------------
// Step 3: Create subscription schedule (matches Stripe UI structure)
// ---------------------------------------------------------------------------

async function createMonthlySubscription({ customerId, monthlyAmountCents, months, description }) {
  const now = Math.floor(Date.now() / 1000);

  // Calculate end date: months worth of billing cycles from now
  const endDate = now + (months * 30 * 24 * 60 * 60);

  // If you have a fixed Price ID in Stripe, use it directly.
  // Otherwise, create an ad-hoc price for this customer's monthly amount.
  let priceId = MONTHLY_PRICE_ID;

  if (priceId === 'price_MONTHLY_PLACEHOLDER') {
    // No fixed price configured — create an inline price for this subscription.
    // This lets each patient have a different monthly amount.
    const price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: monthlyAmountCents,
      recurring: {
        interval: 'month',
      },
      product_data: {
        name: description || 'Monthly payment',
      },
    });

    priceId = price.id;
    console.log(`Created ad-hoc price: ${priceId} ($${(monthlyAmountCents / 100).toFixed(2)}/mo)`);
  }

  // Create a subscription schedule — this wraps the subscription with
  // phase-level config and auto-cancels when the schedule completes.
  // Matches the structure Stripe UI generates.
  const schedule = await stripe.subscriptionSchedules.create({
    customer: customerId,

    // Automatically cancel the subscription when the schedule ends
    end_behavior: 'cancel',

    phases: [
      {
        items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],

        // Send invoice via email instead of auto-charging
        collection_method: 'send_invoice',
        invoice_settings: {
          days_until_due: DAYS_UNTIL_DUE,
        },

        currency: 'usd',

        // Don't prorate — the deposit covers the initial period
        proration_behavior: 'none',

        // Phase runs for the full plan duration
        end_date: endDate,

        metadata: {
          monthly_amount: (monthlyAmountCents / 100).toFixed(2),
          total_months: String(months),
          source: 'drray-pricing-calculator',
        },
      },
    ],
  });

  console.log(`Created subscription schedule: ${schedule.id}`);
  console.log(`  Subscription: ${schedule.subscription}`);
  console.log(`  Status: ${schedule.status}`);
  console.log(`  Phase ends: ${new Date(endDate * 1000).toLocaleDateString()}`);
  console.log(`  End behavior: ${schedule.end_behavior}`);
  console.log(`  Days until due: ${DAYS_UNTIL_DUE}`);

  return schedule;
}

// ---------------------------------------------------------------------------
// Main orchestrator — call this from your Lambda or directly
// ---------------------------------------------------------------------------

/**
 * @param {Object} payload - The payload from the frontend
 * @param {string} payload.name - Patient name
 * @param {string} payload.email - Patient email
 * @param {number} payload.totalPrice - Total price in dollars
 * @param {number} payload.deposit - Deposit amount in dollars
 * @param {number} payload.monthlyPayment - Monthly payment in dollars
 * @param {number} payload.months - Number of monthly payments
 * @param {string} payload.paymentOption - 'full' or 'plan'
 */
export async function processPaymentPlan(payload) {
  const {
    name,
    email,
    totalPrice,
    deposit,
    monthlyPayment,
    months,
    paymentOption,
  } = payload;

  console.log('--- Starting Stripe automation ---');
  console.log(`Patient: ${name} (${email})`);
  console.log(`Total: $${totalPrice} | Deposit: $${deposit} | Monthly: $${monthlyPayment} x ${months}`);

  // Step 1: Customer
  const customer = await findOrCreateCustomer({ name, email });

  // Step 2: Deposit invoice
  const depositAmountCents = Math.round(deposit * 100);

  const depositDescription = paymentOption === 'full'
    ? `Full payment — Concierge OBGYN care`
    : `Deposit — Concierge OBGYN care ($${totalPrice} total)`;

  const invoice = await createDepositInvoice({
    customerId: customer.id,
    depositAmount: depositAmountCents,
    description: depositDescription,
  });

  const result = {
    customerId: customer.id,
    invoiceId: invoice.id,
    invoiceUrl: invoice.hosted_invoice_url,
    invoiceNumber: invoice.number,
  };

  // Step 3: Monthly subscription (only for payment plans)
  if (paymentOption === 'plan' && months > 0 && monthlyPayment > 0) {
    const monthlyAmountCents = Math.round(monthlyPayment * 100);
    const monthlyDescription = `Monthly payment — Concierge OBGYN care ($${monthlyPayment}/mo)`;

    const schedule = await createMonthlySubscription({
      customerId: customer.id,
      monthlyAmountCents,
      months,
      description: monthlyDescription,
    });

    result.subscriptionScheduleId = schedule.id;
    result.subscriptionId = schedule.subscription;
    result.subscriptionStatus = schedule.status;
  }

  console.log('--- Stripe automation complete ---');
  return result;
}

// ---------------------------------------------------------------------------
// CLI entry point — run directly for testing
// ---------------------------------------------------------------------------

const isDirectRun = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isDirectRun) {
  // Sample payload matching what the frontend sends
  const testPayload = {
    name: 'Jane Doe',
    email: 'jane@example.com',
    totalPrice: 8500,
    deposit: 850,
    monthlyPayment: 1275,
    months: 6,
    paymentOption: 'plan',
  };

  processPaymentPlan(testPayload)
    .then((result) => {
      console.log('\nResult:', JSON.stringify(result, null, 2));
    })
    .catch((err) => {
      console.error('Error:', err.message);
      process.exit(1);
    });
}
