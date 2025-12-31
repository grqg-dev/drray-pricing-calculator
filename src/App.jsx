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
  const dueDate = params.get('dueDate') || null;
  const isExtended = params.get('extended') === 'true';

  // Minimum is the original price if provided, otherwise default to $4,000
  const slidingScaleMin = originalPrice || DEFAULT_MIN;

  const getInitialSlidingPrice = () => slidingScaleMin;

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

  const hasWarning = (dueDate && payoffDate > new Date(dueDate + 'T00:00:00')) || monthlyPayment < MIN_MONTHLY_PAYMENT;

  return (
    <div className="app">
      {/* Header */}
      <header className="header">
        <div>
          <h1>Your Care, Your Terms</h1>
          <p className="header-subtitle">Choose a payment schedule that works for you</p>
        </div>
        {dueDate && (
          <div className="due-date">
            Due {formatDate(new Date(dueDate + 'T00:00:00'))}
          </div>
        )}
      </header>

      {/* Price Section */}
      <section className="section price-section">
        {isSlidingScale ? (
          <>
            <div className="price-header">
              <span className="label">Your Price</span>
              <span className="original-price">{formatCurrency(FIXED_PRICE)}</span>
            </div>
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
        <div className="summary-card total-card">
          <span className="card-label">Total</span>
          <span className="card-amount">{formatCurrency(totalPrice)}</span>
          <span className="card-subtext">Done {formatDate(payoffDate)}</span>
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
          <strong>Need flexibility?</strong>
          <p>Life happens. Just reach out — we're happy to work with you.</p>
        </div>
      </footer>
    </div>
  );
}

export default App
