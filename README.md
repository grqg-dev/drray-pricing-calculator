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
- **Payment Terms:** 1-12 months (configurable)
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
| `extended` | boolean | Allow up to 12 months (instead of max 9) |

**Examples:**
- New patient: `?` (default fixed pricing)
- Returning patient: `?slidingScale=true&originalPrice=4500`
- With deadline: `?dueDate=2026-07-15`
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

