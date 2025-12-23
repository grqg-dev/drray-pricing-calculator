import { useState } from 'react'

function App() {
  const FIXED_PRICE = 8500;
  const MIN_DEPOSIT = 250;
  const MIN_MONTHLY_PAYMENT = 250;
  const DEPOSIT_PERCENTAGE = 0.10;
  const SLIDING_SCALE_MAX = 8500;
  const SLIDING_SCALE_STEP = 250;
  const DEFAULT_MIN = 4000;

  // Get URL params
  const params = new URLSearchParams(window.location.search);
  const isSlidingScale = params.get('slidingScale') === 'true';
  const originalPrice = params.get('originalPrice') ? parseInt(params.get('originalPrice')) : null;
  const dueDate = params.get('dueDate') || '2026-07-30'; // Test default

  // Minimum is the original price if provided, otherwise default to $4,000
  const slidingScaleMin = originalPrice || DEFAULT_MIN;

  // Calculate initial sliding scale price (start at minimum)
  const getInitialSlidingPrice = () => {
    return slidingScaleMin;
  };

  const [selectedPrice, setSelectedPrice] = useState(isSlidingScale ? getInitialSlidingPrice() : FIXED_PRICE);
  const [months, setMonths] = useState(6);

  // Calculate payoff date
  const getPayoffDate = () => {
    const today = new Date();
    const payoff = new Date(today);
    payoff.setMonth(payoff.getMonth() + months);
    return payoff;
  };

  const payoffDate = getPayoffDate();
  const totalPrice = isSlidingScale ? selectedPrice : FIXED_PRICE;
  const deposit = Math.max(MIN_DEPOSIT, Math.round(totalPrice * DEPOSIT_PERCENTAGE));
  const remainder = totalPrice - deposit;
  const monthlyPayment = remainder / months;
  const savings = isSlidingScale ? FIXED_PRICE - selectedPrice : 0;


  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(amount);
  };

  return (
    <div className="h-full p-4 md:p-6 lg:p-8 overflow-auto">
      <div className="max-w-6xl mx-auto h-full flex flex-col">
        {/* Header */}
        <div className="text-center mb-4 md:mb-6">
          <h1 className="font-display text-3xl md:text-4xl font-light text-charcoal mb-1">
            Payment Plan Calculator
          </h1>
          <p className="text-sm text-gray">
            Design a payment schedule that works for you
          </p>
        </div>

        {/* Main Content - 2 Column Layout */}
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 lg:gap-8">

          {/* Left Column - Inputs */}
          <div className="space-y-4 md:space-y-6">

            {/* Total Price & Due Date */}
            <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-light">
              {isSlidingScale ? (
                <div>
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-gray mb-1">
                        Full Price
                      </div>
                      <div className="font-display text-2xl font-light text-gray line-through">
                        {formatCurrency(FIXED_PRICE)}
                      </div>
                    </div>
                    {dueDate && (
                      <div className="text-right">
                        <div className="text-xs uppercase tracking-wider text-gray mb-1">
                          Due Date
                        </div>
                        <div className="font-display text-2xl md:text-3xl font-light text-charcoal">
                          {formatDate(new Date(dueDate + 'T00:00:00'))}
                        </div>
                      </div>
                    )}
                  </div>
                  {originalPrice && (
                    <div className="mb-4 pb-4 border-b border-gray-light">
                      <div className="text-xs uppercase tracking-wider text-gray mb-1">
                        Your Last Price
                      </div>
                      <div className="font-display text-xl font-light text-charcoal">
                        {formatCurrency(originalPrice)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray mb-1">
                      Choose Your Price
                    </div>
                    <div className="mb-4">
                      <span className="font-display text-4xl md:text-5xl font-light text-charcoal">
                        {formatCurrency(selectedPrice)}
                      </span>
                    </div>
                    {/* Price Slider */}
                    <div className="slider-container">
                      <div className="slider-track-wrapper">
                        <input
                          type="range"
                          min={slidingScaleMin}
                          max={SLIDING_SCALE_MAX}
                          step={SLIDING_SCALE_STEP}
                          value={selectedPrice}
                          onChange={(e) => setSelectedPrice(parseInt(e.target.value))}
                          className="slider-input"
                        />
                        <div className="slider-track">
                          <div
                            className="slider-fill"
                            style={{ width: `${((selectedPrice - slidingScaleMin) / (SLIDING_SCALE_MAX - slidingScaleMin)) * 100}%` }}
                          />
                          <div
                            className="slider-thumb"
                            style={{ left: `${((selectedPrice - slidingScaleMin) / (SLIDING_SCALE_MAX - slidingScaleMin)) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="slider-ticks">
                        {(() => {
                          // Generate tick marks: min, intermediate values, and max
                          const ticks = [slidingScaleMin];
                          const range = SLIDING_SCALE_MAX - slidingScaleMin;
                          
                          // Add intermediate ticks (roughly every $1000-1500)
                          if (range > 2000) {
                            const mid1 = Math.round((slidingScaleMin + SLIDING_SCALE_MAX) / 2 / SLIDING_SCALE_STEP) * SLIDING_SCALE_STEP;
                            if (mid1 > slidingScaleMin && mid1 < SLIDING_SCALE_MAX) {
                              ticks.push(mid1);
                            }
                          }
                          
                          // Always include max
                          ticks.push(SLIDING_SCALE_MAX);
                          
                          return ticks.sort((a, b) => a - b);
                        })().map((tick) => (
                          <div
                            key={tick}
                            className={`slider-tick ${selectedPrice >= tick ? 'active' : ''}`}
                            style={{ left: `${((tick - slidingScaleMin) / (SLIDING_SCALE_MAX - slidingScaleMin)) * 100}%` }}
                          >
                            <span>{formatCurrency(tick)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={`flex ${dueDate ? 'justify-between' : 'justify-start'} items-start`}>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-gray mb-1">
                      Total Price
                    </div>
                    <div className="font-display text-4xl md:text-5xl font-light text-charcoal">
                      {formatCurrency(FIXED_PRICE)}
                    </div>
                  </div>
                  {dueDate && (
                    <div className="text-right">
                      <div className="text-xs uppercase tracking-wider text-gray mb-1">
                        Due Date
                      </div>
                      <div className="font-display text-2xl md:text-3xl font-light text-charcoal">
                        {formatDate(new Date(dueDate + 'T00:00:00'))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Payment Term Slider */}
            <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-light">
              <div className="flex justify-between items-baseline mb-2">
                <label className="text-xs uppercase tracking-wider text-gray">
                  Payment Term
                </label>
                <span className="font-display text-3xl text-charcoal font-medium">
                  {months} {months === 1 ? 'Month' : 'Months'}
                </span>
              </div>

              <div className="slider-container">
                <div className="slider-track-wrapper">
                  <input
                    type="range"
                    min="1"
                    max="12"
                    value={months}
                    onChange={(e) => setMonths(parseInt(e.target.value))}
                    className="slider-input"
                  />
                  <div className="slider-track">
                    <div
                      className="slider-fill"
                      style={{ width: `${((months - 1) / 11) * 100}%` }}
                    />
                    <div
                      className="slider-thumb"
                      style={{ left: `${((months - 1) / 11) * 100}%` }}
                    />
                  </div>
                </div>
                <div className="slider-ticks">
                  {[1, 3, 6, 9, 12].map((tick) => (
                    <div
                      key={tick}
                      className={`slider-tick ${months >= tick ? 'active' : ''}`}
                      style={{ left: `${((tick - 1) / 11) * 100}%` }}
                    >
                      <span>{tick}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Warning Messages */}
              {(dueDate && payoffDate > new Date(dueDate + 'T00:00:00')) || monthlyPayment < MIN_MONTHLY_PAYMENT ? (
                <div className="mt-4 pt-4 border-t border-gray-light animate-fade-in space-y-2">
                  {dueDate && payoffDate > new Date(dueDate + 'T00:00:00') && (
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-taupe flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-gray leading-relaxed">
                        Note: This plan extends payment beyond your delivery date.
                      </p>
                    </div>
                  )}
                  {monthlyPayment < MIN_MONTHLY_PAYMENT && (
                    <div className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-taupe flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-xs text-gray leading-relaxed">
                        Note: Monthly payments below {formatCurrency(MIN_MONTHLY_PAYMENT)} may not be available. Please shorten your payment term.
                      </p>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

          </div>

          {/* Right Column - Payment Summary */}
          <div className="bg-white rounded-xl p-4 md:p-6 border border-gray-light h-fit lg:sticky lg:top-0">
            <h2 className="font-display text-2xl font-medium text-charcoal mb-4 md:mb-6">
              Payment Summary
            </h2>

            <div className="space-y-4">
              {/* Deposit */}
              <div className="pb-4 border-b border-gray-light">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm text-gray">Deposit</span>
                  <span className="font-display text-2xl font-medium text-charcoal">
                    {formatCurrency(deposit)}
                  </span>
                </div>
                <div className="text-xs text-gray">Due today</div>
              </div>

              {/* Monthly Payment */}
              <div className="pb-4 border-b border-gray-light">
                <div className="flex justify-between items-baseline mb-1">
                  <span className="text-sm text-gray">Monthly Payment</span>
                  <span className="font-display text-2xl font-medium text-charcoal">
                    {formatCurrency(monthlyPayment)}
                  </span>
                </div>
                <div className="text-xs text-gray">
                  {months} {months === 1 ? 'payment' : 'payments'} starting next month
                </div>
              </div>

              {/* Payoff Date */}
              <div className="pt-2">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-gray">Final Payment</span>
                  <span className="text-sm font-medium text-charcoal">
                    {formatDate(payoffDate)}
                  </span>
                </div>
              </div>
            </div>

            {/* Schedule Breakdown */}
            <div className="mt-6 pt-6 border-t border-gray-light">
              <h3 className="text-sm uppercase tracking-wider text-gray mb-3">
                Schedule
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray">Today</span>
                  <span className="text-charcoal">{formatCurrency(deposit)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray">
                    {months}× monthly
                  </span>
                  <span className="text-charcoal">{formatCurrency(monthlyPayment)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-light font-medium">
                  <span className="text-charcoal">Total</span>
                  <span className="text-charcoal">{formatCurrency(totalPrice)}</span>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

export default App

