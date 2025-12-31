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
- `src/App.jsx` - Main React component (192 lines)
- `src/index.css` - All styling (318 lines)
- `src/main.jsx` - Vite entry point
- `vite.config.js` - Vite configuration
- `tailwind.config.js` - Tailwind configuration
- `amplify.yml` - AWS Amplify deployment config

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
  - Effects: Adds 12-month quick button, extends slider range

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
```

## Component Structure

### App Component State
```javascript
selectedPrice    // Current price (sliding scale) or fixed $8,500
months          // Selected payment term (1-9 or 1-12 months)
```

### Key Calculations
- **Deposit**: 10% of total price (minimum $250)
- **Monthly Payment**: (Total - Deposit) / Months
- **Payoff Date**: Today + selected months
- **Warnings**:
  - Triggered if payoff date > due date
  - Triggered if monthly payment < $250

## UI Sections

### Header
- Title: "Your Care, Your Terms"
- Subtitle: "Choose a payment schedule that works for you"
- Optional: Due date display (if dueDate param provided)

### Price Section
- Fixed mode: Shows "$8,500"
- Sliding scale mode:
  - Title: "Your Price"
  - Strikethrough original price ($8,500)
  - Current price (slider-controlled)
  - Slider range: originalPrice to $8,500 (in $250 increments)

### Timeline Section
- Slider for payment months (1-9 or 1-12)
- Quick buttons: [3, 6, 9] or [3, 6, 9, 12]
- Displays selected month count

### Summary Cards
- Today: Deposit amount (10% + min $250)
- X× Monthly: Monthly payment amount
- Total (highlighted): Total price, payoff date

### Warnings
- Yellow background (#FEF6E6)
- Displays only when conditions are met
- Two possible warnings:
  1. "Payment extends past your due date"
  2. "Minimum payment is $250/mo — try fewer months"

### Info Section (Footer)
- Payment Methods: ACH, debit, card via Stripe
- Timing: Explains 1-month pre-due deadline
- Need flexibility: CTA for contacting support

## Styling Details

### Color Scheme
- **Cream**: #FBF8F4 (background)
- **Blush**: #E8D5D0 (light accents)
- **Terracotta**: #B8847A (primary, interactive)
- **Sage**: #8A9D80 (secondary)
- **Charcoal**: #3D3833 (text)
- **Warm Gray**: #8C857D (muted text)

### Typography
- **Headers**: Fraunces serif font (9-144px range)
- **Body**: Plus Jakarta Sans sans-serif
- **Responsive**: Max-width 400px (mobile-first)

### Layout
- Mobile-first responsive design
- Flex container with column layout
- Scrollable content area
- Fixed height prevents overflow on iPhone 14

## Development Guidelines

### When Making Changes
1. Keep state minimal (only `selectedPrice` and `months`)
2. All calculations should be derived from state
3. URL parameters are read-only on page load
4. Maintain responsive layout (<= 400px max-width)
5. Preserve accessibility (semantic HTML, ARIA labels for sliders)

### Testing
- Test all URL parameter combinations
- Verify calculations at edge cases:
  - Minimum price ($4,000 + $250 deposit)
  - Maximum price ($8,500 + $850 deposit)
  - Various month counts (1, 3, 6, 9, 12)
  - With and without due dates
- Check warning triggers work correctly
- Verify date calculations (payoff + due date logic)

### Performance Considerations
- Component is lightweight (~200 lines)
- No external API calls
- All calculations are synchronous
- CSS transitions enabled for sliders

## Deployment

### Development Server
```bash
npm run dev
# Starts on http://localhost:5174
```

### Production Build
```bash
npm run build
# Creates optimized dist/ folder
```

### AWS Amplify Deployment
- Configured via `amplify.yml`
- Auto-deploys on pushes to `main` branch
- App ID: `duwmmpm67brmh`
- Domain: `duwmmpm67brmh.amplifyapp.com`

### Environment Variables
None currently configured. All values are hardcoded constants in App.jsx:
- `FIXED_PRICE`: $8,500
- `MIN_DEPOSIT`: $250
- `MIN_MONTHLY_PAYMENT`: $250
- `DEPOSIT_PERCENTAGE`: 10%
- `DEFAULT_MIN`: $4,000
- `SLIDING_SCALE_MAX`: $8,500
- `SLIDING_SCALE_STEP`: $250 (increments)

## Common Tasks

### Adding a New URL Parameter
1. Extract in App component: `const paramName = params.get('paramName')`
2. Use in calculations or conditional rendering
3. Document in agents.md and README.md
4. Test with various values

### Changing Pricing Structure
Edit constants in App.jsx (lines 4-10):
```javascript
const FIXED_PRICE = 8500;           // Change fixed price here
const MIN_DEPOSIT = 250;            // Change minimum deposit
const DEPOSIT_PERCENTAGE = 0.10;    // Change deposit calculation
const SLIDING_SCALE_MAX = 8500;     // Change max sliding price
```

### Modifying Styling
Edit `src/index.css`:
- Color variables in `:root` (lines 9-20)
- Component styles below (organized by section)
- Mobile max-width: 400px (line 40)

### Adding New Warnings
In App.jsx `hasWarning` logic (line 58):
1. Create condition that triggers warning
2. Add `<div className="warning">` in warnings section
3. Update warning CSS if needed

## Troubleshooting

### Slider Not Updating
- Check that slider has `onChange` handler
- Verify `--progress` CSS variable is properly calculated
- Ensure state updates trigger re-render

### Calculations Incorrect
- Verify `DEPOSIT_PERCENTAGE` is 0.10 (not 10)
- Check `MIN_DEPOSIT` is applied correctly with `Math.max()`
- Ensure date math uses `setMonth()` correctly

### Styling Issues
- Check mobile max-width (should be 400px)
- Verify color variables are defined in `:root`
- Ensure flex containers have proper sizing

## Future Enhancements

Possible additions (when requested):
- Multiple plan tiers
- Discount codes
- Payment method selection
- Insurance integration
- Booking/checkout integration
- Analytics tracking
- Multi-currency support
