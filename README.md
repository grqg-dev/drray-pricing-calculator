# DrRay Pricing Calculator

A React + Vite + Tailwind CSS pricing calculator for Concierge OBGYN Care payment plans.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Run development server:
```bash
npm run dev
```

3. Build for production:
```bash
npm run build
```

## AWS Amplify Deployment

The app is already configured for AWS Amplify deployment.

**App Details:**
- App ID: `duwmmpm67brmh`
- Default Domain: `duwmmpm67brmh.amplifyapp.com`

**To connect GitHub for auto-deployment:**

1. Go to [AWS Amplify Console](https://console.aws.amazon.com/amplify/)
2. Select the `drray-pricing-calculator` app
3. Click "Connect branch" or "Add environment"
4. Connect your GitHub account (OAuth)
5. Select repository: `grqg-dev/drray-pricing-calculator`
6. Select branch: `main`
7. Build settings are already configured in `amplify.yml`

The app will automatically deploy on every push to the `main` branch.

## Features

- Fixed price mode ($8,500)
- Sliding scale mode (for returning customers)
- Payment term calculator (1-12 months)
- Due date warnings
- Responsive design

## URL Parameters

- `dueDate` - Estimated due date (YYYY-MM-DD format)
- `slidingScale=true` - Enable sliding scale mode
- `originalPrice` - Previous price paid (for sliding scale)

Example:
```
?slidingScale=true&originalPrice=2000&dueDate=2026-07-30
```

