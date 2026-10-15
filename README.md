# DrRay Pricing Calculator

A modern, mobile-first payment plan calculator for DrRay Concierge OBGYN Care. Patients can customize payment schedules with flexible pricing options and receive transparent cost breakdowns.

## About This App

**Business Purpose:**
- Enable patients to visualize and customize payment plans for concierge care services
- Support both fixed pricing ($8,500) and sliding scale models
- Provide transparent cost breakdown: deposit, monthly payment, total amount
- Calculate accurate payoff dates and flag conflicts with provider deadlines

**Key Use Cases:**
- Initial quote generation for new patients
- Custom pricing reviews for returning patients
- Payment plan customization before checkout
- Embedded in patient communication workflows

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend Framework** | React 18 with Hooks |
| **Build Tool** | Vite 5.4 (fast dev server & optimized builds) |
| **Styling** | Tailwind CSS + Custom CSS |
| **Deployment** | AWS Amplify (auto-deploy from GitHub) |
| **Version Control** | Git (GitHub) |

**Why This Stack:**
- React: Simple, component-based state management
- Vite: Fast HMR development, tiny production builds
- Tailwind: Consistent, maintainable utility-based styling
- Amplify: Zero-config hosting with auto-deployment

## Getting Started

### Development

```bash
# Install dependencies
npm install

# Start dev server (usually http://localhost:5174)
npm run dev
```

### Production Build

```bash
# Create optimized production build
npm run build

# Preview production build locally
npm run preview
```

### Deployment

The app auto-deploys to AWS Amplify on every push to `main`:
- **App ID:** `duwmmpm67brmh`
- **Live URL:** `duwmmpm67brmh.amplifyapp.com`
- **Config:** `amplify.yml` (build settings pre-configured)

## Features & Capabilities

### Pricing Models
- **Fixed Price:** Standard $8,500 rate
- **Sliding Scale:** Customizable range based on previous payment
  - Minimum: Previous price or $4,000 (whichever is higher)
  - Maximum: $8,500
  - Increments: $250

### Payment Planning
- **Payment Terms:** 1-9 months (up to 18 with `extended=true`)
- **Smart Calculations:**
  - Deposit: 10% (minimum $250)
  - Monthly payments spread evenly
  - Automatic payoff date calculation
- **Due Date Warnings:** Alerts when payment extends past deadline
- **Minimum Payment Protection:** Warns if monthly payment falls below $250

### Responsive Design
- Mobile-first (optimized for iPhone 14, 390×844px)
- Touch-friendly sliders and buttons
- Works on desktop (max-width 400px)
- Clean, accessible interface

## Configuration via URL Parameters

Customize pricing and terms by passing parameters in the URL:

```
https://drray-pricing.example.com/?slidingScale=true&originalPrice=5000&dueDate=2026-06-30&extended=true
```

| Parameter | Type | Purpose |
|-----------|------|---------|
| `slidingScale` | boolean | Enable sliding scale mode (instead of fixed $8,500) |
| `originalPrice` | number | Set sliding scale minimum (in dollars) |
| `dueDate` | date | Show due date & trigger warnings if payoff extends past it (YYYY-MM-DD) |
| `extended` | `true` \| `12` | `true` allows up to 18 months; `12` allows up to 12 months (default max is 9) |

**Examples:**
- New patient: `?` (default fixed pricing)
- Returning patient: `?slidingScale=true&originalPrice=4500`
- With deadline: `?dueDate=2026-07-15`
- 12-month plan: `?extended=12`
- Full custom: `?slidingScale=true&originalPrice=6000&dueDate=2026-08-30&extended=true`

## Architecture Overview

**Minimal, Focused Design:**
- Single App component (~200 lines)
- URL parameters read once on page load
- All UI updates from two state values: `selectedPrice` and `months`
- No external API calls
- Pure CSS styling (no CSS-in-JS overhead)

**Component Structure:**
```
App.jsx
├── Header (title, optional due date)
├── Price Section (fixed or sliding scale)
├── Timeline Section (month selector with quick buttons)
├── Summary Cards (deposit, monthly, total with date)
├── Warnings (conditional alerts)
└── Info Section (payment methods, timing, support)
```

## Payment notification

After Stripe ids are saved, `price-submission-handler` (`api/index.js`) sends Front Desk event `payment_plan_submitted`. The sender is the vendored helper `api/front-desk-event.js` (from `grqg-dev/drray` `shared/front-desk-event` at `444f2ff`). The envelope is the v1 contract in that repo's `docs/front-desk-events.md`.

The event id is `payment_plan_submitted:<submissionId>`. `data` carries `submissionId`, `paymentOption`, `amount`, `method`, and Stripe ids. `data.opportunityId` is included when the submission body has one. Name, email, and other PHI are not in the event or in the logs.

`test` is true when `STRIPE_SECRET_KEY` starts with `sk_test_` or `rk_test_`, or when the submission name, email, or opportunity id starts with `ZZTEST` (any case). A test event uses the same webhook. The routine prefixes its note `[TEST]` and skips follow-ups.

The helper POSTs JSON with a 3 second timeout and one retry (timeout, network error, 429, or 5xx). A 4xx is not retried. It never throws. A skip, a failed response, or a timeout does not change the submission response. The log line is `event`, `eventId`, and `status` only.

| Env var | Purpose |
|---------|---------|
| `FRONT_DESK_WEBHOOK_URL` | Front Desk webhook. Must be `https`. Unset, or a non-https URL, skips the call. |
| `FRONT_DESK_WEBHOOK_TOKEN` | Bearer token. A value that already starts with `Bearer ` is not prefixed again. |
| `PUMBLE_VIA_MAKE_ENABLED` | Default `true`. While true, `MAKE_WEBHOOK_URL` still receives the raw submission (Google Sheets). `false`, `0`, `no`, or `off` skips that call. |

Set the Front Desk URL and token on the Lambda only. Do not commit them, and do not put them in Secrets Manager. The function no longer reads `PAY_NOTIFY_WEBHOOK_URL` or `PAY_NOTIFY_WEBHOOK_TOKEN`.

Runtime must be Node.js 18 or newer. The helper uses `fetch`.

### Deploy

Do not deploy until Matt confirms. Merging to `main` runs `.github/workflows/deploy-api.yml`, which updates `price-submission-handler` in `us-east-1`.

1. Read the current variables. `update-function-configuration --environment` replaces the whole set, so keep every existing key.

```bash
aws lambda get-function-configuration \
  --function-name price-submission-handler \
  --profile engineering \
  --region us-east-1 \
  --query Environment \
  --output json > /tmp/price-submission-env.json
```

2. Add `FRONT_DESK_WEBHOOK_URL` and `FRONT_DESK_WEBHOOK_TOKEN` to `Variables`. Leave `PAY_NOTIFY_WEBHOOK_URL` and `PAY_NOTIFY_WEBHOOK_TOKEN` in place until the new code is confirmed, so the function that is live now keeps notifying. Leave `MAKE_WEBHOOK_URL`, `PUMBLE_VIA_MAKE_ENABLED`, `STRIPE_SECRET_KEY`, `STRIPE_DEPOSIT_PRODUCT_ID`, `STRIPE_MONTHLY_PRODUCT_ID`, `DYNAMODB_TABLE`, `PRICE_LOCK_SECRET`, and `ALLOWED_ORIGINS` as they are. Do not commit or print the file.

```bash
aws lambda update-function-configuration \
  --function-name price-submission-handler \
  --profile engineering \
  --region us-east-1 \
  --environment file:///tmp/price-submission-env.json

aws lambda wait function-updated \
  --function-name price-submission-handler \
  --profile engineering \
  --region us-east-1
```

3. Merge the PR. The workflow runs `npm ci` and `npm run deploy` in `api/`. The zip includes `index.js`, `lock-link.js`, `pay-notify.js`, `front-desk-event.js`, and `node_modules`.

4. Submit as a ZZTEST patient with a Stripe test key. Expect one POST with `event` `payment_plan_submitted`, `test` true, and no name or email. The same `eventId` is not posted twice.

5. Remove `PAY_NOTIFY_WEBHOOK_URL` and `PAY_NOTIFY_WEBHOOK_TOKEN` with the same get, edit, and update steps.

6. Leave `PUMBLE_VIA_MAKE_ENABLED` unset or `true`. After the ZZTEST event lands, Matt snapshots Make scenario **3819523** and deletes module **#4** (Pumble). The Google Sheets row stays. That edit is not in this repo.

### Rollback

Stop notifications without a code change: remove `FRONT_DESK_WEBHOOK_URL` and `FRONT_DESK_WEBHOOK_TOKEN` from the function (same get, edit, and update as above). The helper skips, and the submission still returns success. Leave `MAKE_WEBHOOK_URL` and `PUMBLE_VIA_MAKE_ENABLED` so the sheet row keeps running.

Restore the previous notifier: revert this change on `main` so the workflow deploys the old zip, then put `PAY_NOTIFY_WEBHOOK_URL` and `PAY_NOTIFY_WEBHOOK_TOKEN` back. The old code reads those names and does not read `FRONT_DESK_*`. Do not change Make scenario 3819523 as part of the rollback.

## Team Notes

- **Maintainer:** DrRay Care Team
- **Last Updated:** December 2025
- **Status:** Active & in use

For technical details, implementation guidelines, and development instructions, see [agents.md](./agents.md).

## Support

Need help with pricing logic, styling, or adding features? Check:
1. [agents.md](./agents.md) - Technical documentation
2. Source code comments in `src/App.jsx` and `src/index.css`
3. AWS Amplify console for deployment logs

Questions about business logic or patient-facing changes? Contact the DrRay team.

