import { useState } from 'react'

function App() {
  const FIXED_PRICE = 8500;
  const MIN_DEPOSIT = 250;
  const MIN_MONTHLY_PAYMENT = 250;
  const SLIDING_SCALE_MAX = 8500;
  const SLIDING_SCALE_STEP = 250;
  const DEFAULT_MIN = 4000;
  const DEPOSIT_PRESETS = [0.10, 0.25, 0.50];

  // Get URL params
  const params = new URLSearchParams(window.location.search);
  const isSlidingScale = params.get('slidingScale') === 'true';
  const originalPrice = params.get('originalPrice') ? parseInt(params.get('originalPrice')) : null;
  const dueDate = params.get('dueDate') || null;
  const isExtended = params.get('extended') === 'true';

  // Minimum is the original price if provided, otherwise default to $4,000
  const slidingScaleMin = originalPrice || DEFAULT_MIN;

  const getInitialSlidingPrice = () => slidingScaleMin;

  const [selectedPrice, setSelectedPrice] = useState(isSlidingScale ? getInitialSlidingPrice() : FIXED_PRICE);
  const [months, setMonths] = useState(6);
  const [depositPercent, setDepositPercent] = useState(0.10);
  const [customDeposit, setCustomDeposit] = useState(null);

  // Calculate payoff date
  const getPayoffDate = () => {
    const today = new Date();
    const payoff = new Date(today);
    payoff.setMonth(payoff.getMonth() + months);
    return payoff;
  };

  const payoffDate = getPayoffDate();
  const totalPrice = isSlidingScale ? selectedPrice : FIXED_PRICE;
  
  // Calculate deposit based on preset or custom
  const calculatedDeposit = customDeposit !== null 
    ? Math.max(MIN_DEPOSIT, Math.min(customDeposit, totalPrice))
    : Math.max(MIN_DEPOSIT, Math.round(totalPrice * depositPercent));
  const deposit = calculatedDeposit;
  const remainder = totalPrice - deposit;
  const monthlyPayment = remainder / months;

  // Handle preset button click
  const handlePresetClick = (percent) => {
    setDepositPercent(percent);
    setCustomDeposit(null);
  };

  const formatDate = (date) => {
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
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

  const depositBelowMin = customDeposit !== null && customDeposit < MIN_DEPOSIT;
  const depositExceedsTotal = customDeposit !== null && customDeposit > totalPrice;
  const hasWarning = (dueDate && payoffDate > new Date(dueDate + 'T00:00:00')) || monthlyPayment < MIN_MONTHLY_PAYMENT || depositBelowMin || depositExceedsTotal;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <h1>Payment Calculator</h1>
        {dueDate && (
          <div className="due-date">
            Due Date: {formatDate(new Date(dueDate + 'T00:00:00'))}
          </div>
        )}
      </header>

      {/* Price Section */}
      <section className="section price-section">
        {isSlidingScale ? (
          <>
            <div className="price-value">{formatCurrency(selectedPrice)}</div>
            <div className="slider-wrapper">
              <input
                type="range"
                min={slidingScaleMin}
                max={SLIDING_SCALE_MAX}
                step={SLIDING_SCALE_STEP}
                value={selectedPrice}
                onChange={(e) => setSelectedPrice(parseInt(e.target.value))}
                className="slider"
                style={{ '--progress': `${((selectedPrice - slidingScaleMin) / (SLIDING_SCALE_MAX - slidingScaleMin)) * 100}%` }}
              />
              <div className="slider-labels">
                <span>{formatCurrency(slidingScaleMin)}</span>
                <span>{formatCurrency(SLIDING_SCALE_MAX)}</span>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="label">Total</div>
            <div className="price-value">{formatCurrency(FIXED_PRICE)}</div>
          </>
        )}
      </section>

      {/* Timeline Section */}
      <section className="section timeline-section">
        <div className="timeline-header">
          <span className="label">Pay over</span>
          <span className="months-value">{months} {months === 1 ? 'month' : 'months'}</span>
        </div>
        <div className="slider-wrapper">
          <input
            type="range"
            min="1"
            max={isExtended ? 12 : 9}
            value={months}
            onChange={(e) => setMonths(parseInt(e.target.value))}
            className="slider"
            style={{ '--progress': `${((months - 1) / (isExtended ? 11 : 8)) * 100}%` }}
          />
          <div className="quick-buttons">
            {(isExtended ? [3, 6, 9, 12] : [3, 6, 9]).map(m => (
              <button
                key={m}
                className={`quick-btn ${months === m ? 'active' : ''}`}
                onClick={() => setMonths(m)}
              >
                {m}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Deposit Section */}
      <div className="deposit-section">
        <span className="label">Deposit</span>
        <div className="deposit-buttons">
          {DEPOSIT_PRESETS.map(percent => (
            <button
              key={percent}
              className={`quick-btn ${depositPercent === percent && customDeposit === null ? 'active' : ''}`}
              onClick={() => handlePresetClick(percent)}
            >
              {Math.round(percent * 100)}%
            </button>
          ))}
          <input
            type="number"
            inputMode="numeric"
            className={`deposit-input ${customDeposit !== null ? 'active' : ''}`}
            placeholder="Custom"
            min="0"
            value={customDeposit !== null ? customDeposit : ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value === '' || value === null) {
                setCustomDeposit(null);
                setDepositPercent(0.10);
              } else {
                const num = parseInt(value);
                if (!isNaN(num)) {
                  setCustomDeposit(num);
                  setDepositPercent(null);
                }
              }
            }}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <span className="card-label">Today</span>
          <span className="card-amount">{formatCurrency(deposit)}</span>
        </div>
        <div className="summary-card">
          <span className="card-label">{months}× Monthly</span>
          <span className="card-amount">{formatCurrency(monthlyPayment)}</span>
        </div>
      </div>

      {/* Warnings */}
      {hasWarning && (
        <div className="warnings">
          {dueDate && payoffDate > new Date(dueDate + 'T00:00:00') && (
            <div className="warning">
              Payment extends past your due date
            </div>
          )}
          {monthlyPayment < MIN_MONTHLY_PAYMENT && (
            <div className="warning">
              Minimum payment is {formatCurrency(MIN_MONTHLY_PAYMENT)}/mo — try fewer months
            </div>
          )}
          {depositBelowMin && (
            <div className="warning">
              Minimum deposit is {formatCurrency(MIN_DEPOSIT)}
            </div>
          )}
          {depositExceedsTotal && (
            <div className="warning">
              Deposit cannot exceed total price
            </div>
          )}
        </div>
      )}

      {/* Info Section */}
      <footer className="info-section">
        <div className="info-item">
          <strong>Payment Methods</strong>
          <p>We accept ACH, debit, and credit cards, and there are never any processing fees. Please pay with ACH if possible — this helps us control fees on our end and offer no processing fees to everyone.</p>
        </div>
        <div className="info-item">
          <strong>Timing</strong>
          <p>We ask that your balance be paid off one month before your due date{dueDate ? ` (by ${formatDate(new Date(new Date(dueDate + 'T00:00:00').setMonth(new Date(dueDate + 'T00:00:00').getMonth() - 1)))})` : ''}.</p>
        </div>
        <div className="info-item">
          <strong>Need more flexibility?</strong>
          <p>Life happens. Just reach out — we're happy to work with you.</p>
        </div>
      </footer>

      {/* Submit Button */}
      <button className="submit-btn">
        Continue
      </button>
    </div>
  );
}

export default App
