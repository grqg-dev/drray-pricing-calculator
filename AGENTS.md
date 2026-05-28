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

- **`slidingScale=true`** — Enable sliding scale pricing (default: fixed $8,500). Slider opens at the midpoint of the min/max range (snapped to $250 steps), not the minimum.
- **`originalPrice=5000`** — Set minimum sliding scale price (default: $4,000)
- **`dueDate=2026-06-30`** — Show due date, trigger warnings if plan extends past it
- **`extended=true`** — Allow up to 12 months (default: 9)
- **`maxPrice=10000`** — Override default $8,500 maximum
- **`preview=done`** — Show success screen with sample data

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
npm test          # Run tests once
npm run test:watch # Tests in watch mode
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
  timestamp, depositPercent, customDeposit
}
```
Posted to AWS Lambda endpoint. Response may include `invoiceUrl` (Stripe hosted invoice link).
