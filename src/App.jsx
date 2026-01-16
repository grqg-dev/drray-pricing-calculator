import { useState } from 'react'

function App() {
  const DEFAULT_FIXED_PRICE = 8500;
  const MIN_DEPOSIT = 250;
  const MIN_MONTHLY_PAYMENT = 250;
  const DEFAULT_SLIDING_SCALE_MAX = 8500;
  const SLIDING_SCALE_STEP = 250;
  const DEFAULT_MIN = 4000;
  const DEPOSIT_PRESETS = [0.10, 0.25, 0.50];
  const WEBHOOK_URL = 'https://hook.us2.make.com/5xso5d5tyu3ubbz45isvoohto6jx1mfo';

  // Get URL params
  const params = new URLSearchParams(window.location.search);
  const isSlidingScale = params.get('slidingScale') === 'true';
  const originalPrice = params.get('originalPrice') ? parseInt(params.get('originalPrice')) : null;
  const dueDate = params.get('dueDate') || null;
  const isExtended = params.get('extended') === 'true';
  const maxPrice = params.get('maxPrice') ? parseInt(params.get('maxPrice')) : null;
  
  // Override prices if maxPrice parameter is provided
  const FIXED_PRICE = maxPrice || DEFAULT_FIXED_PRICE;
  const SLIDING_SCALE_MAX = maxPrice || DEFAULT_SLIDING_SCALE_MAX;

  // Minimum is the original price if provided, otherwise default to $4,000
  const slidingScaleMin = originalPrice || DEFAULT_MIN;

  const getInitialSlidingPrice = () => slidingScaleMin;

  const [selectedPrice, setSelectedPrice] = useState(isSlidingScale ? getInitialSlidingPrice() : FIXED_PRICE);
  const [months, setMonths] = useState(6);
  const [depositPercent, setDepositPercent] = useState(0.10);
  const [customDeposit, setCustomDeposit] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [patientName, setPatientName] = useState('');

  // Calculate payoff date
  const getPayoffDate = () => {
    const today = new Date();
    const payoff = new Date(today);
    payoff.setMonth(payoff.getMonth() + months);
    return payoff;
  };

  const payoffDate = getPayoffDate();
  const totalPrice = isSlidingScale ? selectedPrice : FIXED_PRICE;
  
  // Minimum deposit: 10% of total (unless in sliding scale mode), but never less than $250
  const minDepositPercent = isSlidingScale ? 0 : 0.10;
  const minDepositAmount = Math.max(MIN_DEPOSIT, Math.round(totalPrice * minDepositPercent));
  
  // Calculate deposit based on preset or custom
  const calculatedDeposit = customDeposit !== null 
    ? Math.max(minDepositAmount, Math.min(customDeposit, totalPrice))
    : Math.max(minDepositAmount, Math.round(totalPrice * depositPercent));
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

  const depositBelowMin = customDeposit !== null && customDeposit < minDepositAmount;
  const depositBelowPercent = !isSlidingScale && deposit < Math.round(totalPrice * 0.10);
  const depositExceedsTotal = customDeposit !== null && customDeposit > totalPrice;
  const hasWarning = (dueDate && payoffDate > new Date(dueDate + 'T00:00:00')) || monthlyPayment < MIN_MONTHLY_PAYMENT || depositBelowMin || depositBelowPercent || depositExceedsTotal;

  // Handle form submission - show name modal
  const handleSubmit = () => {
    if (isSubmitting || hasWarning) return;
    setShowNameModal(true);
  };

  // Submit with name to webhook
  const submitWithName = async () => {
    const trimmedName = patientName.trim();
    if (!trimmedName) {
      setSubmitError('Please enter your name');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const payload = {
      name: trimmedName,
      totalPrice,
      deposit,
      monthlyPayment,
      months,
      payoffDate: payoffDate.toISOString(),
      dueDate: dueDate || null,
      isSlidingScale,
      originalPrice: originalPrice || null,
      isExtended,
      timestamp: new Date().toISOString(),
      depositPercent: customDeposit === null ? depositPercent : null,
      customDeposit: customDeposit !== null ? customDeposit : null
    };

    try {
      const response = await fetch(WEBHOOK_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      setShowNameModal(false);
      setSubmitSuccess(true);
    } catch (error) {
      console.error('Submission error:', error);
      setSubmitError(error.message || 'Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // If submission was successful, show Done view
  if (submitSuccess) {
    return (
      <div className="app done-view">
        <div className="done-container">
          <div className="done-header">
            <div className="checkmark">✓</div>
            <h1>You're all set!</h1>
            <p className="done-subtitle">We've saved your payment plan. We'll be in touch to confirm.</p>
            <p className="done-note">Made a mistake? Just let us know and we'll update it.</p>
          </div>

          <div className="done-summary">
            <div className="done-card">
              <span className="done-label">Total</span>
              <span className="done-value">{formatCurrency(totalPrice)}</span>
            </div>
            
            <div className="done-card">
              <span className="done-label">Deposit Today</span>
              <span className="done-value">{formatCurrency(deposit)}</span>
            </div>
            
            <div className="done-card">
              <span className="done-label">{months}× Monthly</span>
              <span className="done-value">{formatCurrency(monthlyPayment)}</span>
            </div>
            
            <div className="done-card">
              <span className="done-label">Payoff Date</span>
              <span className="done-value">{formatDate(payoffDate)}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`app ${isSlidingScale ? 'sliding-scale-mode' : ''}`}>
      {/* Header */}
      <header className="header">
        <div>
          <h1>Payment Calculator</h1>
          <p className="header-subtitle">Choose a payment plan that works for you</p>
        </div>
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
            min={minDepositAmount}
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
          <span className="card-label">Deposit Today</span>
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
              This plan extends past your due date—adjust months to finish earlier.
            </div>
          )}
          {monthlyPayment < MIN_MONTHLY_PAYMENT && (
            <div className="warning">
              The minimum payment is {formatCurrency(MIN_MONTHLY_PAYMENT)}/mo. Try a shorter timeframe or higher deposit.
            </div>
          )}
          {depositBelowMin && (
            <div className="warning">
              Minimum deposit is {formatCurrency(minDepositAmount)}
            </div>
          )}
          {depositBelowPercent && !depositBelowMin && (
            <div className="warning">
              Minimum down payment is 10% ({formatCurrency(Math.round(totalPrice * 0.10))})
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
          <p>Pay by ACH, debit, or credit card—no processing fees. (ACH preferred; it's how we keep it fee-free for everyone.)</p>
        </div>
        <div className="info-item">
          <strong>Timing</strong>
          <p>We typically ask that your balance be paid off 1 month before your due date{dueDate ? ` (by ${formatDate(new Date(new Date(dueDate + 'T00:00:00').setMonth(new Date(dueDate + 'T00:00:00').getMonth() - 1)))})` : ''}.</p>
        </div>
        <div className="info-item">
          <strong>Need more flexibility?</strong>
          <p>Monthly payments are just our default — we can adjust the schedule or payoff date to fit your situation. <button className="contact-link" onClick={() => setShowContactModal(true)}>Contact us</button></p>
        </div>
      </footer>

      {/* Submit Button */}
      <button 
        className="submit-btn"
        onClick={handleSubmit}
        disabled={isSubmitting || hasWarning}
      >
        {isSubmitting ? 'Saving...' : 'Save'}
      </button>

      {/* Success Message */}
      {submitSuccess && (
        <div className="success-message">
          Payment plan submitted successfully!
        </div>
      )}

      {/* Error Message */}
      {submitError && (
        <div className="error-message">
          {submitError}
        </div>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowContactModal(false)}>×</button>
            <h2>Contact Us</h2>
            <div className="contact-info">
              <div className="contact-item">
                <strong>Phone</strong>
                <a href="tel:8053640996">805 364-0996</a>
              </div>
              <div className="contact-item">
                <strong>Email</strong>
                <a href="mailto:hello@drjuliaray.com">hello@drjuliaray.com</a>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Name Entry Modal */}
      {showNameModal && (
        <div className="modal-overlay" onClick={() => {
          if (!isSubmitting) {
            setShowNameModal(false);
            setPatientName('');
          }
        }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button 
              className="modal-close" 
              onClick={() => {
                if (!isSubmitting) {
                  setShowNameModal(false);
                  setPatientName('');
                }
              }}
              disabled={isSubmitting}
            >
              ×
            </button>
            <h2>Enter Your Name</h2>
            <div className="name-input-wrapper">
              <input
                type="text"
                className="name-input"
                placeholder="Your name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && patientName.trim() && !isSubmitting) {
                    submitWithName();
                  }
                }}
                disabled={isSubmitting}
                autoFocus
              />
            </div>
            <div className="modal-actions">
              <button
                className="modal-cancel-btn"
                onClick={() => {
                  if (!isSubmitting) {
                    setShowNameModal(false);
                    setPatientName('');
                  }
                }}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="modal-submit-btn"
                onClick={submitWithName}
                disabled={!patientName.trim() || isSubmitting}
              >
                {isSubmitting ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App
