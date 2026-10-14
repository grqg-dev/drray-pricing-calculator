# Pricing Calculator - Agent Instructions

## Project Overview

The DrRay Pricing Calculator is a React-based web application that allows patients to view customized payment plans for concierge OBGYN care services. It supports both fixed pricing and sliding scale modes based on URL parameters.

## Architecture

### Tech Stack
- **Frontend**: React 18 with Hooks
- **Build Tool**: Vite 5.4
- **Styling**: Tailwind CSS + custom CSS
- **Testing**: Vitest
- **State Management**: React useState (simple, minimal state)
- **Deployment**: AWS Amplify

### Key Files
- `src/utils.js` - Constants, pure functions, and business logic (~95 lines)
- `src/utils.test.js` - Tests for all business logic (~230 lines, 36 tests)
- `src/App.jsx` - React components and UI (~660 lines)
- `src/index.css` - All styling (~1,134 lines)
- `src/main.jsx` - Vite entry point

## Code Structure

### src/utils.js — Business Logic (pure, testable)

**Constants:**
```javascript
DEFAULT_FIXED_PRICE = 8500   // Default fixed price (overridable via maxPrice URL param)
MIN_DEPOSIT = 250            // Minimum deposit amount
MIN_MONTHLY_PAYMENT = 250    // Minimum monthly payment
DEFAULT_SLIDING_SCALE_MAX = 8500
SLIDING_SCALE_STEP = 250     // Price slider increments
DEFAULT_MIN = 4000           // Default sliding scale minimum
DEPOSIT_PRESETS = [0.10, 0.25, 0.50]
SUBMISSION_API_URL           // AWS Lambda webhook endpoint
```

**Formatting:**
- `formatDate(date)` — locale-aware date formatting (e.g., "Jun 15, 2026")
- `formatCurrency(amount)` — USD with no cents (e.g., "$8,500")

**Validation:**
- `isValidEmail(email)` — regex validation

**Date helpers:**
- `parseDueDate(dueDate)` — parses "YYYY-MM-DD" to local midnight Date
- `getOneMonthBefore(date)` — returns new Date minus one month
- `getPayoffDate(months)` — today + 30 days + N months
- `getFirstInvoiceDate()` — today + 30 days

**URL parameters:**
- `parseUrlParams()` — reads all URL parameters into a config object

**Calculations:**
- `calculateMinDeposit(totalPrice, isSlidingScale)` — minimum deposit amount
- `calculateDeposit({ customDeposit, minDepositAmount, totalPrice, depositPercent })` — actual deposit with clamping
- `getWarnings({ ... })` — returns all warning flags as named booleans

### src/App.jsx — React Components (UI only)

**Sub-components:**
- `PriceSection` — shared price display/slider used by both "Pay in Full" and "Payment Plan" views
- `DoneView` — success screen after submission

**Main App component:**
- All state (14 `useState` hooks)
- Derived values via `calculateMinDeposit`, `calculateDeposit`, `getWarnings`
- Event handlers
- Render logic with 3 views: option selection, full payment, payment plan

**Render flow:**
1. If `submitSuccess` → render `<DoneView />`
2. If `paymentOption === null` → render option selection
3. If `paymentOption === 'full'` → `<PriceSection />` + inline form + submit
4. If `paymentOption === 'plan'` → `<PriceSection />` + timeline + deposit + summary + warnings + submit
5. Modals at bottom (Contact, Name Entry, ACH confirmation)

## Payment Schedules

- **Deposit under 50%:** equal monthly payments only ("Pay over N months" slider). Submits as `paymentOption: 'plan'` (Stripe subscription).
- **Deposit 50% or more** (`CUSTOM_SCHEDULE_MIN_DEPOSIT_FRACTION`): `SchedulePlanCards` offers Monthly, Every 2 months, Every 3 months (`PAYMENT_INTERVALS`), each priced up front, plus "Choose my own dates".
  - Monthly still submits as `'plan'` (subscription).
  - Every 2/3 months and custom dates submit as `paymentOption: 'installment'` with an `installments` array (one scheduled Stripe invoice per payment). Rows come from `buildIntervalInstallments`; the count is capped by `getMaxIntervalPayments` (plan term and $250 minimum).
  - "Choose my own dates" opens `CustomScheduleEditor` pre-filled with the equal schedule on screen.
- Amount fields use `AmountInput`, which shows `$2,500` while typing and reports whole dollars (`formatAmountInput` / `parseAmountInput`).

## Testing

### Running Tests
```bash
npm test          # Run all tests once
npm run test:watch # Run in watch mode (re-runs on file changes)
```

### Test Coverage
All pure business logic in `src/utils.js` is tested (36 tests):
- Formatting: `formatCurrency`, `formatDate`
- Validation: `isValidEmail` (valid and invalid cases)
- Date math: `parseDueDate`, `getOneMonthBefore`, `getPayoffDate`, `getFirstInvoiceDate`
- Deposit calculation: `calculateMinDeposit`, `calculateDeposit` (presets, custom, clamping)
- Warnings: `getWarnings` (each flag individually, edge cases, sliding scale vs fixed)

### Adding Tests for New Logic
1. Add your pure function to `src/utils.js`
2. Add tests in `src/utils.test.js`
3. Run `npm test` to verify

## URL Parameters (Query String)

- **`slidingScale=true`** — Enable sliding scale pricing (default fixed price is $10,000). Slider opens at the midpoint of the min/max range (snapped to $250 steps), not the minimum.
- **`originalPrice=5000`** — Set minimum sliding scale price (default: $4,000)
- **`dueDate=2026-06-30`** — Show due date, trigger warnings if plan extends past it
- **`extended=3`** — Cap the remainder at 3 months (default: 9)
- **`extended=6`** — Cap the remainder at 6 months (default: 9)
- **`extended=true`** — Allow up to 18 months (default: 9)
- **`extended=12`** — Allow up to 12 months (default: 9)
- **`maxPrice=10000`** — Override default fixed price ($10,000)
- **`preview=done`** — Show success screen with sample data
- **`deposit=3000`** — With `lock=1` and `sig`, the agreed deposit in whole dollars. Omit it to lock only the total.
- **`lock=1`** — Lock the total, and the deposit when `deposit` is present. Requires a valid `sig`
- **`exp`** — Optional unix expiry, included in the signature
- **`sig`** — HMAC-SHA256 of `v1|maxPrice|deposit|exp` when the deposit is locked, or `v2|maxPrice||exp` when the patient chooses it, base64url

`dueDate` and `extended` can be added to a locked link and are not signed. Links without `lock=1` behave as before: `deposit`, `exp`, and `sig` are ignored.

### Locked patient links

Staff mint a link from [the payment link page](https://payment-calculator.drjuliaray.com/staff/payment-link.html) (also linked on the services dashboard). Enter the total and deposit, then copy the link and send it to the patient yourself. Check "Let the patient choose the deposit" to lock only the total; the patient then picks 10%, 25%, 50%, or a custom amount. The page does not text or email anyone. The patient opens it, picks how to pay the rest, and the deposit invoice goes to the email they enter.

The same link can be minted from the shell. The secret never goes in the page bundle:

```bash
PRICE_LOCK_SECRET=... node scripts/generate-locked-price-link.js --total 6000 --deposit 3000
PRICE_LOCK_SECRET=... node scripts/generate-locked-price-link.js --total 6000 --deposit 3000 --due-date 2026-08-01 --extended 12 --days 30
```

When the deposit is locked, the page shows the total and deposit read-only, hides "Pay in full" unless the deposit is the whole total, and shows the schedule cards when the deposit is at least 50%. When the deposit is open, the total stays read-only and the deposit controls match the open calculator. A bad signature shows an error instead of the open calculator.

The Lambda checks `lock` before DynamoDB, Make, or Stripe. `action: "verifyLock"` only reports `{ valid: true|false }`. A submission whose total doesn't match the signature returns 400 and creates nothing. A locked deposit must match too. An open deposit must be a whole-dollar amount from $1 through the total, and the remainder must still add up. Unsigned submissions are unchanged.

Set `PRICE_LOCK_SECRET` on `price-submission-handler` before using locked links in production. Leave `VITE_PRICE_LOCK_SECRET` unset on Amplify so the secret stays on the Lambda. Deploy the Lambda before the page that calls `verifyLock`. Do not deploy either to production without Matt's confirmation.

### Example URLs
```
# Basic fixed price
https://app.example.com/

# Sliding scale with custom minimum
https://app.example.com/?slidingScale=true&originalPrice=5000

# Full featured
https://app.example.com/?slidingScale=true&originalPrice=6500&dueDate=2026-08-15&extended=true
```

## Development Guidelines

### When Making Changes
1. Put business logic in `src/utils.js`, UI in `src/App.jsx`
2. Write tests for any new calculation or validation logic
3. Run `npm test` and `npm run build` before committing
4. The `PriceSection` component is shared — edit it once, both views update
5. Warning flags are named booleans in `getWarnings()` — add new ones there
6. URL parameters are parsed in `parseUrlParams()` — add new ones there

### Adding a New URL Parameter
1. Add to `parseUrlParams()` in `src/utils.js`
2. Destructure in the App component
3. Use in calculations or conditional rendering
4. Document in this file

### Changing Pricing Structure
Edit constants at the top of `src/utils.js`:
```javascript
export const DEFAULT_FIXED_PRICE = 8500;
export const MIN_DEPOSIT = 250;
export const DEFAULT_SLIDING_SCALE_MAX = 8500;
```
Or override dynamically via the `maxPrice` URL parameter.

### Adding New Warnings
1. Add the condition to `getWarnings()` in `src/utils.js`
2. Include it in the `hasWarning` expression
3. Add a test case in `src/utils.test.js`
4. Add a `<div className="warning">` in the warnings JSX block in `src/App.jsx`

### Modifying Styling
Edit `src/index.css`:
- Color variables in `:root` (lines 9-20)
- Component styles organized by section below

## Commands
```bash
npm run dev       # Dev server (http://localhost:5174)
npm run build     # Production build → dist/
npm test          # Frontend tests, then the Lambda notification tests
npm run test:watch # Frontend tests in watch mode
```

## Deployment
- AWS Amplify auto-deploys on pushes to `main`
- App ID: `duwmmpm67brmh`
- Domain: `duwmmpm67brmh.amplifyapp.com`

## Submission Payload
```javascript
{
  name, email, totalPrice, paymentOption,
  deposit, monthlyPayment, months, payoffDate,
  dueDate, isSlidingScale, originalPrice, isExtended,
  timestamp, depositPercent, customDeposit,
  lock: { maxPrice, deposit, exp, sig }  // only for locked links
}
```
Posted to AWS Lambda endpoint. Response may include `invoiceUrl` (Stripe hosted invoice link).

## Payment notification (JRDO-94)

After the Stripe block (and the DynamoDB Stripe-id update), `price-submission-handler` POSTs a payment notification for the Grok Bot routine "Payment plan / payment notification". The call has a 5 second timeout. A failure, non-2xx response, or timeout is logged and does not change the submission response. The response body is not logged.

Leave these unset until rollout. A missing URL skips the call with one log line:

- `PAY_NOTIFY_WEBHOOK_URL` — routine webhook URL
- `PAY_NOTIFY_WEBHOOK_TOKEN` — sender key, sent as `Authorization: Bearer <token>`. A value that already starts with `Bearer ` is not prefixed again.
- `PUMBLE_VIA_MAKE_ENABLED` — default `true` (also `1` / `yes`; set `false`, `0`, `no`, or `off` to skip). While true, `MAKE_WEBHOOK_URL` is still called with the raw submission so the Google Sheets row keeps running.

Backing secret (do not commit values): `office-pricing/pay-notify-webhook` with keys `url` and `token`. Create it with `--profile engineering`. Deploy maps those keys onto the two webhook env vars above. `PUMBLE_VIA_MAKE_ENABLED` stays on after Pumble is removed, because Make still writes the sheet.

`testMode` is true when `STRIPE_SECRET_KEY` starts with `sk_test_` or `rk_test_`.

```javascript
{
  event: 'plan_selected' | 'payment_submitted', // plan and installment → plan_selected; full → payment_submitted
  patientName,
  paymentOption, // plan | installment | full
  plan: { totalPrice, deposit, monthlyPayment, months, installments?, isSlidingScale, payoffDate },
  amount, // deposit, or totalPrice when paymentOption is full
  method, // plan → stripe_subscription_schedule; installment → stripe_scheduled_invoices; full → stripe_invoice
  stripe: { customerId, invoiceId, invoiceUrl, subscriptionScheduleId, subscriptionId, futureInvoiceIds },
  submissionId,
  testMode,
  timestamp // ISO UTC
}
```

The same values are repeated on headers, because a routine webhook may drop the body: `X-Event-Type`, `X-Patient-Name` (URI-encoded), `X-Submission-Id`, `X-Stripe-Customer-Id`, `X-Stripe-Subscription-Id`, `X-Stripe-Invoice-Id`, `X-Amount`, `X-Payment-Option`.

**Assumption for Matt / Finance:** `payment_submitted` is pay-in-full. Plan and installment submissions use `plan_selected`. There is no second ping when a payment later succeeds.

### Rollout (after Matt approves — do not deploy from this change)

1. Create `office-pricing/pay-notify-webhook` (`url`, `token`) with `--profile engineering`. Set `PAY_NOTIFY_WEBHOOK_URL` and `PAY_NOTIFY_WEBHOOK_TOKEN` on `price-submission-handler` from those keys. Leave `PUMBLE_VIA_MAKE_ENABLED` unset or `true`. Deploy the Lambda only after Matt confirms.
2. Submit as a fake patient with Stripe test mode and no real customer. Confirm the routine receives the event.
3. Make scenario **3819523** "Pricing Submission": snapshot the blueprint, then delete module **#4** (Pumble subscenario SCN_2036108, message `Pricing Submitted for {name}`) and link module #3 (Google Sheets) to module #2 (webhook respond). That Make edit is separate from this repo. The Lambda keeps calling Make so the sheet row continues.
