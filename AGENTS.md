# Pricing Calculator - Agent Instructions

## Project Overview

The DrRay Pricing Calculator is a React-based web application that allows patients to view customized payment plans for concierge OBGYN care services. It supports both fixed pricing and sliding scale modes based on URL parameters.

## Architecture

### Tech Stack
- **Frontend**: React 18 with Hooks
- **Build Tool**: Vite 5.4
- **Styling**: Tailwind CSS + custom CSS
- **State Management**: React useState (simple, minimal state)
- **Deployment**: AWS Amplify

### Key Files
- `src/App.jsx` - All components and logic (~735 lines)
- `src/index.css` - All styling (~1,134 lines)
- `src/main.jsx` - Vite entry point
- `vite.config.js` - Vite configuration
- `tailwind.config.js` - Tailwind configuration

## Code Structure (src/App.jsx)

The file is organized into four clearly labeled sections:

### 1. Constants (top of file)
Module-level configuration values:
```javascript
DEFAULT_FIXED_PRICE = 8500   // Default fixed price (overridable via maxPrice URL param)
MIN_DEPOSIT = 250            // Minimum deposit amount
MIN_MONTHLY_PAYMENT = 250    // Minimum monthly payment
DEFAULT_SLIDING_SCALE_MAX = 8500
SLIDING_SCALE_STEP = 250     // Price slider increments
DEFAULT_MIN = 4000           // Default sliding scale minimum
DEPOSIT_PRESETS = [0.10, 0.25, 0.50]
SUBMISSION_API_URL            // AWS Lambda webhook endpoint
```

### 2. Utility Functions (module-level, pure functions)
- `formatDate(date)` — locale-aware date formatting
- `formatCurrency(amount)` — USD formatting with no cents
- `isValidEmail(email)` — email regex validation
- `parseDueDate(dueDate)` — parses YYYY-MM-DD string to Date (avoids timezone issues)
- `getOneMonthBefore(date)` — returns date minus one month
- `getPayoffDate(months)` — calculates end date (today + 30 days + N months)
- `getFirstInvoiceDate()` — 30 days from now
- `parseUrlParams()` — reads all URL parameters into a config object

### 3. Sub-components
- **`PriceSection`** — shared price display/slider used by both "Pay in Full" and "Payment Plan" views. Accepts props: `isSlidingScale`, `selectedPrice`, `setSelectedPrice`, `slidingScaleMin`, `slidingScaleMax`, `fixedPrice`
- **`DoneView`** — success screen shown after submission. Displays timeline (for plans) or total (for full payment), pay button, and ACH reminder

### 4. Main App Component
Contains all state, derived values, handlers, and the main render logic.

**State variables:**
```
selectedPrice, months, depositPercent, customDeposit,
isSubmitting, submitSuccess, submitError,
showContactModal, showNameModal, showAchModal,
patientName, patientEmail, paymentOption, invoiceUrl
```

**Warning flags (named booleans):**
```
depositBelowMin, depositBelowPercent, depositExceedsTotal,
pastDueDate, belowMinPayment, hasWarning
```

**Key handlers:**
- `handlePresetClick(percent)` — deposit preset button
- `handleSubmit()` — opens name modal (plan flow)
- `closeNameModal()` — closes modal and resets fields
- `handleEmailKeyDown(e)` — Enter key submits form
- `submitWithName()` — validates name/email, opens ACH modal
- `confirmAndSubmit()` — POSTs to webhook, handles response

**Render flow:**
1. If `submitSuccess` → render `<DoneView />`
2. If `paymentOption === null` → render option selection
3. If `paymentOption === 'full'` → render `<PriceSection />` + inline name/email form + submit
4. If `paymentOption === 'plan'` → render `<PriceSection />` + timeline + deposit + summary + warnings + submit
5. Modals render at bottom (Contact, Name Entry, ACH confirmation)

## URL Parameters (Query String)

### Complete Parameter Reference
- **`slidingScale`** (boolean, optional)
  - Value: `true` to enable sliding scale pricing
  - Default: Fixed price mode ($8,500)
  - Effects: Displays price slider instead of fixed price

- **`originalPrice`** (integer, optional)
  - Value: Previous price paid by patient (in dollars)
  - Default: $4,000 (if slidingScale not enabled)
  - Effects: Sets the minimum value for the sliding scale slider
  - Range: Must be between $4,000 and $8,500

- **`dueDate`** (date string, optional)
  - Format: `YYYY-MM-DD` (ISO 8601)
  - Example: `2026-05-15`
  - Effects:
    - Displays due date in header
    - Triggers warning if payoff date exceeds due date
    - Updates timing section with required payment deadline (1 month before)

- **`extended`** (boolean, optional)
  - Value: `true` to extend payment terms to 12 months
  - Default: 9-month maximum
  - Effects: Extends slider range to 12 months

- **`maxPrice`** (integer, optional)
  - Value: Maximum price in dollars to override the default $8,500
  - Default: $8,500
  - Effects:
    - Overrides both fixed price (when not in sliding scale mode)
    - Overrides sliding scale maximum (when in sliding scale mode)
  - Example: `maxPrice=10000` sets both fixed and sliding scale max to $10,000

- **`preview`** (string, optional)
  - Value: `done` to show success screen
  - Effects: Renders the DoneView with sample data (for previewing)

### Example URLs
```
# Basic fixed price
https://app.example.com/

# Sliding scale with custom minimum
https://app.example.com/?slidingScale=true&originalPrice=5000

# With due date warning
https://app.example.com/?dueDate=2026-06-30

# Full featured
https://app.example.com/?slidingScale=true&originalPrice=6500&dueDate=2026-08-15&extended=true

# Override default price to $10,000
https://app.example.com/?maxPrice=10000

# Custom price with sliding scale
https://app.example.com/?slidingScale=true&originalPrice=5000&maxPrice=12000
```

## UI Sections

### Header
- Title: "Payment Calculator"
- Subtitle: "Choose a payment plan that works for you"
- Optional: Due date display (if dueDate param provided)

### Price Section (PriceSection component)
- Fixed mode: Shows total with formatted currency
- Sliding scale mode: Interactive slider from originalPrice to max

### Timeline Section (plan only)
- Slider for payment months (1-9 or 1-12)
- Displays selected month count

### Summary Cards (plan only)
- Deposit Today: deposit amount
- N× Monthly: monthly payment amount

### Warnings (plan only)
- Yellow background, conditional display
- Possible warnings: past due date, below min payment, deposit too low/high

### Info Section (Footer)
- Payment Methods: ACH preferred
- How It Works: explains invoice schedule
- Flexibility: contact link
- Switch payment mode link

## Styling Details

### Color Scheme (CSS variables in :root)
- **Cream**: #FBF8F4 (background)
- **Blush**: #E8D5D0 (light accents)
- **Terracotta**: #B8847A (primary, interactive)
- **Sage**: #8A9D80 (secondary)
- **Charcoal**: #3D3833 (text)
- **Warm Gray**: #8C857D (muted text)

### Typography
- **Headers**: Fraunces serif font
- **Body**: Plus Jakarta Sans sans-serif
- **Responsive**: Max-width 400px (mobile-first)

## Development Guidelines

### When Making Changes
1. Constants and utility functions are at module scope (top of file) — easy to find
2. The `PriceSection` component is shared — edit it once, both views update
3. All state lives in the App component, derived values are calculated from state
4. URL parameters are read-only on page load via `parseUrlParams()`
5. Warning flags are named booleans — add new ones and include in `hasWarning`
6. Maintain responsive layout (<= 400px max-width)

### Adding a New URL Parameter
1. Add to `parseUrlParams()` function
2. Destructure in the App component
3. Use in calculations or conditional rendering
4. Document in this file and README.md

### Changing Pricing Structure
Edit constants at the top of `src/App.jsx`:
```javascript
const DEFAULT_FIXED_PRICE = 8500;
const MIN_DEPOSIT = 250;
const DEFAULT_SLIDING_SCALE_MAX = 8500;
```
Or override dynamically via the `maxPrice` URL parameter.

### Adding New Warnings
1. Add a named boolean flag in the "Warning flags" section of App
2. Include it in the `hasWarning` expression
3. Add a `<div className="warning">` in the warnings JSX block

### Modifying Styling
Edit `src/index.css`:
- Color variables in `:root` (lines 9-20)
- Component styles organized by section below

## Development Server
```bash
npm run dev
# Starts on http://localhost:5174
```

## Production Build
```bash
npm run build
# Creates optimized dist/ folder
```

## Deployment
- AWS Amplify auto-deploys on pushes to `main` branch
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
