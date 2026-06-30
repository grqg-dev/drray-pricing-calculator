const AWS = require('aws-sdk');
const https = require('https');
const { v4: uuidv4 } = require('uuid');
const Stripe = require('stripe');

const dynamodb = new AWS.DynamoDB.DocumentClient();

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
  'Access-Control-Allow-Methods': 'POST,OPTIONS'
};

const INSTALLMENT_DAYS_UNTIL_DUE = 15;

exports.handler = async (event) => {
  console.log('Received event:', JSON.stringify(event, null, 2));

  // Get environment variables
  const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
  const DYNAMODB_TABLE = process.env.DYNAMODB_TABLE || 'customer-price-submissions';
  const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
  const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
  const STRIPE_DEPOSIT_PRODUCT_ID = process.env.STRIPE_DEPOSIT_PRODUCT_ID;
  const STRIPE_MONTHLY_PRODUCT_ID = process.env.STRIPE_MONTHLY_PRODUCT_ID;

  // Determine origin and set CORS header
  const origin = event.headers?.origin || event.headers?.Origin;
  let corsOrigin = '*';
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    corsOrigin = origin;
  }

  const responseHeaders = {
    ...CORS_HEADERS,
    'Access-Control-Allow-Origin': corsOrigin
  };

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: ''
    };
  }

  // Validate POST method
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: responseHeaders,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    // Parse request body (handle base64-encoded bodies from API Gateway)
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    const payload = JSON.parse(rawBody);
    console.log('Parsed payload:', payload);

    // Validate required fields
    if (!payload.name || !payload.email || typeof payload.totalPrice !== 'number') {
      return {
        statusCode: 400,
        headers: responseHeaders,
        body: JSON.stringify({ error: 'Missing required fields: name, email, totalPrice' })
      };
    }

    // Generate submission ID
    const submissionId = uuidv4();
    console.log('Generated submissionId:', submissionId);

    // Prepare DynamoDB item (store exact payload fields)
    const dynamoItem = {
      submissionId,
      timestamp: payload.timestamp || new Date().toISOString(),
      name: payload.name,
      email: payload.email,
      totalPrice: payload.totalPrice,
      paymentOption: payload.paymentOption,
      deposit: payload.deposit,
      monthlyPayment: payload.monthlyPayment,
      months: payload.months,
      payoffDate: payload.payoffDate || null,
      dueDate: payload.dueDate || null,
      isSlidingScale: payload.isSlidingScale || false,
      originalPrice: payload.originalPrice || null,
      isExtended: payload.isExtended || false,
      depositPercent: payload.depositPercent || null,
      customDeposit: payload.customDeposit || null,
      ...(payload.paymentOption === 'installment' && payload.installments && { installments: payload.installments })
    };

    // Write to DynamoDB
    console.log('Writing to DynamoDB:', dynamoItem);
    await dynamodb.put({
      TableName: DYNAMODB_TABLE,
      Item: dynamoItem
    }).promise();
    console.log('Successfully wrote to DynamoDB');

    // Call make.com webhook (optional when MAKE_WEBHOOK_URL not set)
    if (MAKE_WEBHOOK_URL) {
      console.log('Calling make.com webhook:', MAKE_WEBHOOK_URL);
      await callWebhook(MAKE_WEBHOOK_URL, payload);
      console.log('Successfully called make.com webhook');
    } else {
      console.log('MAKE_WEBHOOK_URL not set — skipping webhook');
    }

    // Create Stripe invoice for the deposit
    let invoiceUrl = null;
    let stripeInvoiceId = null;

    if (STRIPE_SECRET_KEY && STRIPE_DEPOSIT_PRODUCT_ID) {
      try {
        const stripeResult = await createStripeInvoice({
          stripeKey: STRIPE_SECRET_KEY,
          productId: STRIPE_DEPOSIT_PRODUCT_ID,
          name: payload.name,
          email: payload.email,
          deposit: payload.deposit,
          totalPrice: payload.totalPrice,
          paymentOption: payload.paymentOption,
          months: payload.months,
          submissionId
        });
        invoiceUrl = stripeResult.invoiceUrl;
        stripeInvoiceId = stripeResult.invoiceId;
        console.log('[STRIPE] Deposit invoice created:', stripeInvoiceId, invoiceUrl);

        // Create subscription schedule for monthly payments (plan only)
        let subscriptionScheduleId = null;
        let subscriptionId = null;

        if (payload.paymentOption === 'plan' && payload.months > 0 && payload.monthlyPayment > 0) {
          const monthlyAmountCents = Math.round(payload.monthlyPayment * 100);
          console.log('[SUBSCRIPTION] Starting subscription schedule creation', {
            customerId: stripeResult.customerId, monthlyAmountCents, months: payload.months
          });
          const schedule = await createSubscriptionSchedule(Stripe(STRIPE_SECRET_KEY), {
            customerId: stripeResult.customerId,
            productId: STRIPE_MONTHLY_PRODUCT_ID,
            monthlyAmountCents,
            months: payload.months,
            submissionId,
          });
          subscriptionScheduleId = schedule.id;
          subscriptionId = schedule.subscription;
          console.log('[SUBSCRIPTION] Schedule created successfully', {
            scheduleId: schedule.id, subscriptionId: schedule.subscription, status: schedule.status
          });
        }

        // Create scheduled future invoices for installment option
        let stripeFutureInvoiceIds = null;
        if (payload.paymentOption === 'installment' && Array.isArray(payload.installments) && payload.installments.length > 0) {
          try {
            stripeFutureInvoiceIds = await createScheduledInvoices(Stripe(STRIPE_SECRET_KEY), {
              customerId: stripeResult.customerId,
              productId: STRIPE_DEPOSIT_PRODUCT_ID,
              installments: payload.installments,
              submissionId,
            });
            console.log('[INSTALLMENT] Scheduled invoices created:', stripeFutureInvoiceIds);
          } catch (instErr) {
            console.error('[INSTALLMENT] Scheduled invoice creation failed:', instErr);
          }
        }

        // Update DynamoDB record with Stripe info
        const updateExpr = stripeFutureInvoiceIds
          ? 'SET stripeInvoiceId = :sid, stripeInvoiceUrl = :url, subscriptionScheduleId = :ssid, subscriptionId = :subid, stripeFutureInvoiceIds = :fids'
          : 'SET stripeInvoiceId = :sid, stripeInvoiceUrl = :url, subscriptionScheduleId = :ssid, subscriptionId = :subid';
        const updateValues = {
          ':sid': stripeInvoiceId,
          ':url': invoiceUrl,
          ':ssid': subscriptionScheduleId,
          ':subid': subscriptionId
        };
        if (stripeFutureInvoiceIds) {
          updateValues[':fids'] = stripeFutureInvoiceIds;
        }
        await dynamodb.update({
          TableName: DYNAMODB_TABLE,
          Key: { submissionId },
          UpdateExpression: updateExpr,
          ExpressionAttributeValues: updateValues
        }).promise();
      } catch (stripeError) {
        // Log but don't fail the whole request — DynamoDB + webhook already succeeded
        console.error('Stripe invoice creation failed:', stripeError);
      }
    } else {
      console.log('Stripe not configured — skipping invoice creation');
    }

    // Return success
    return {
      statusCode: 200,
      headers: responseHeaders,
      body: JSON.stringify({
        success: true,
        message: 'Submission recorded successfully',
        submissionId,
        ...(invoiceUrl && { invoiceUrl })
      })
    };

  } catch (error) {
    console.error('Error processing submission:', error);
    return {
      statusCode: 500,
      headers: responseHeaders,
      body: JSON.stringify({
        error: 'Failed to process submission',
        message: error.message
      })
    };
  }
};

/**
 * Create a Stripe invoice for the deposit amount
 */
async function createStripeInvoice({ stripeKey, productId, name, email, deposit, totalPrice, paymentOption, months, submissionId }) {
  const stripe = Stripe(stripeKey);

  // Determine the invoice amount (in cents)
  // For "full" payment, invoice the full amount; for "plan" or "installment", invoice the deposit
  const invoiceAmountDollars = paymentOption === 'full' ? totalPrice : deposit;
  const invoiceAmountCents = Math.round(invoiceAmountDollars * 100);

  // Build description
  const description = paymentOption === 'full'
    ? 'Maternity Care — Payment in Full'
    : 'Maternity Care — Initial Deposit';

  // Find or create customer by email
  const existingCustomers = await stripe.customers.list({ email, limit: 1 });
  let customer;
  if (existingCustomers.data.length > 0) {
    customer = existingCustomers.data[0];
    console.log('Found existing Stripe customer:', customer.id);
    // Update name if it changed
    if (customer.name !== name) {
      customer = await stripe.customers.update(customer.id, { name });
    }
  } else {
    customer = await stripe.customers.create({ name, email });
    console.log('Created new Stripe customer:', customer.id);
  }

  // Create invoice item (attached to the customer, will be picked up by the next invoice)
  await stripe.invoiceItems.create({
    customer: customer.id,
    price_data: {
      product: productId,
      unit_amount: invoiceAmountCents,
      currency: 'usd',
    },
    description,
    metadata: {
      submissionId,
      paymentOption,
      totalPrice: String(totalPrice),
      ...(paymentOption === 'plan' && { months: String(months) })
    }
  });

  // Create the invoice
  const invoice = await stripe.invoices.create({
    customer: customer.id,
    collection_method: 'send_invoice',
    days_until_due: 7,
    auto_advance: true,
    pending_invoice_items_behavior: 'include',
    metadata: {
      submissionId,
      paymentOption,
      source: 'pricing-calculator'
    }
  });

  // Finalize the invoice (moves from draft → open)
  const finalizedInvoice = await stripe.invoices.finalizeInvoice(invoice.id);

  // Send the invoice email
  await stripe.invoices.sendInvoice(invoice.id);
  console.log('Invoice sent to', email);

  return {
    invoiceId: finalizedInvoice.id,
    invoiceUrl: finalizedInvoice.hosted_invoice_url,
    customerId: customer.id
  };
}

/**
 * Create a Stripe subscription schedule for monthly payments.
 * Auto-sends invoices each month and auto-cancels after N iterations.
 */
async function createSubscriptionSchedule(stripe, { customerId, productId, monthlyAmountCents, months, submissionId }) {
  // Search for an existing active price with the same amount under this product
  console.log('[SUBSCRIPTION] Searching for existing price:', { productId, monthlyAmountCents });
  const existingPrices = await stripe.prices.list({
    product: productId,
    currency: 'usd',
    type: 'recurring',
    active: true,
    limit: 100,
  });
  let price = existingPrices.data.find(p => p.unit_amount === monthlyAmountCents && p.recurring?.interval === 'month');

  if (price) {
    console.log('[SUBSCRIPTION] Reusing existing price:', { priceId: price.id, amount: `${(monthlyAmountCents / 100).toFixed(2)}/mo` });
  } else {
    console.log('[SUBSCRIPTION] No existing price found, creating new one:', { monthlyAmountCents });
    price = await stripe.prices.create({
      currency: 'usd',
      unit_amount: monthlyAmountCents,
      recurring: { interval: 'month' },
      product: productId,
    });
    console.log('[SUBSCRIPTION] New price created:', { priceId: price.id, amount: `${(monthlyAmountCents / 100).toFixed(2)}/mo` });
  }

  // Start monthly invoices 30 days after deposit submission
  const startDate = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);

  // Create subscription schedule — auto-sends invoices, auto-cancels after N months
  console.log('[SUBSCRIPTION] Creating subscription schedule:', {
    customerId, priceId: price.id, months, iterations: months, endBehavior: 'cancel',
    collectionMethod: 'send_invoice', daysUntilDue: 7, startDate: new Date(startDate * 1000).toISOString()
  });
  const schedule = await stripe.subscriptionSchedules.create({
    customer: customerId,
    start_date: startDate,
    end_behavior: 'cancel',
    phases: [{
      items: [{ price: price.id, quantity: 1 }],
      collection_method: 'send_invoice',
      invoice_settings: { days_until_due: 7 },
      iterations: months,
      proration_behavior: 'none',
      metadata: {
        submissionId,
        monthly_amount: (monthlyAmountCents / 100).toFixed(2),
        total_months: String(months),
        source: 'drray-pricing-calculator',
      },
    }],
  });
  console.log('[SUBSCRIPTION] Schedule created:', JSON.stringify({
    scheduleId: schedule.id,
    subscriptionId: schedule.subscription,
    status: schedule.status,
    endBehavior: schedule.end_behavior,
    phases: schedule.phases?.map(p => ({
      startDate: new Date(p.start_date * 1000).toISOString(),
      endDate: new Date(p.end_date * 1000).toISOString(),
      collectionMethod: p.collection_method,
      iterations: p.iterations,
    }))
  }, null, 2));

  return schedule;
}

/**
 * Create draft Stripe invoices with scheduled finalization for custom installment plans.
 * Each invoice finalizes 15 days before due date so payment is due on the selected date.
 */
async function createScheduledInvoices(stripe, { customerId, productId, installments, submissionId }) {
  const invoiceIds = [];
  for (let i = 0; i < installments.length; i++) {
    const { amount, dueDate } = installments[i];
    const amountCents = Math.round(amount * 100);
    // User's selected date = payment due date. Finalize 15 days earlier so they have time to pay.
    const dueDateObj = new Date(dueDate + 'T00:00:00Z');
    dueDateObj.setDate(dueDateObj.getDate() - INSTALLMENT_DAYS_UNTIL_DUE);
    const finalizesAt = Math.floor(dueDateObj.getTime() / 1000);

    await stripe.invoiceItems.create({
      customer: customerId,
      price_data: {
        product: productId,
        unit_amount: amountCents,
        currency: 'usd',
      },
      description: `Maternity Care — Future Invoice ${i + 1}`,
      metadata: {
        submissionId,
        paymentOption: 'installment',
        installmentIndex: String(i + 1),
        dueDate,
      },
    });

    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: INSTALLMENT_DAYS_UNTIL_DUE,
      auto_advance: true,
      automatically_finalizes_at: finalizesAt,
      pending_invoice_items_behavior: 'include',
      metadata: {
        submissionId,
        paymentOption: 'installment',
        installmentIndex: String(i + 1),
        dueDate,
        source: 'pricing-calculator',
      },
    });

    invoiceIds.push(invoice.id);
    console.log('[INSTALLMENT] Draft invoice created:', invoice.id, 'finalizes at', new Date(finalizesAt * 1000).toISOString());
  }
  return invoiceIds;
}

/**
 * Call webhook via HTTPS POST
 */
function callWebhook(url, payload) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const postData = JSON.stringify(payload);

    const options = {
      hostname: urlObj.hostname,
      port: 443,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log('Webhook response:', data);
          resolve(data);
        } else {
          console.error('Webhook error response:', res.statusCode, data);
          reject(new Error(`Webhook returned status ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', (error) => {
      console.error('Webhook request error:', error);
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}
