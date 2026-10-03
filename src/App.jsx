import { useEffect, useState } from 'react'
import {
  DEFAULT_FIXED_PRICE, MIN_MONTHLY_PAYMENT, DEFAULT_SLIDING_SCALE_MAX,
  SLIDING_SCALE_STEP, DEFAULT_MIN, DEPOSIT_PRESETS, SUBMISSION_API_URL,
  formatDate, formatCurrency, isValidEmail, parseDueDate, getOneMonthBefore,
  getPayoffDate, getFirstInvoiceDate, parseUrlParams, getMaxMonths,
  calculateDefaultSlidingPrice, calculateMinDeposit, calculateDeposit, getWarnings,
  qualifiesForCustomSchedule, suggestCustomInstallments, validateCustomSchedule,
  toDateInputValue, getTodayLocal,
} from './utils'

// ── Sub-components ─────────────────────────────────────────

// Shared price display/slider used by both "Pay in Full" and "Payment Plan" views
function PriceSection({ isSlidingScale, selectedPrice, setSelectedPrice, slidingScaleMin, slidingScaleMax, fixedPrice }) {
  if (isSlidingScale) {
    const progress = ((selectedPrice - slidingScaleMin) / (slidingScaleMax - slidingScaleMin)) * 100;
    return (
      <section className="section price-section">
        <div className="price-value">{formatCurrency(selectedPrice)}</div>
        <div className="slider-wrapper">
          <input
            type="range"
            min={slidingScaleMin}
            max={slidingScaleMax}
            step={SLIDING_SCALE_STEP}
            value={selectedPrice}
            onChange={(e) => setSelectedPrice(parseInt(e.target.value, 10))}
            className="slider"
            aria-label="Select price"
            style={{ '--progress': `${progress}%` }}
          />
          <div className="slider-labels">
            <span>{formatCurrency(slidingScaleMin)}</span>
            <span>{formatCurrency(slidingScaleMax)}</span>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="section price-section">
      <div className="label">Total</div>
      <div className="price-value">{formatCurrency(fixedPrice)}</div>
    </section>
  );
}

function CustomScheduleEditor({
  installments,
  setInstallments,
  remainder,
  dueDate,
  scheduleValidation,
  onEvenSplit,
}) {
  const minDate = toDateInputValue(getTodayLocal());

  const updateRow = (id, field, value) => {
    setInstallments((rows) => rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
  };

  const addRow = () => {
    const lastDate = installments.length > 0
      ? parseDueDate(installments[installments.length - 1].dueDate || minDate)
      : getFirstInvoiceDate();
    const nextDate = new Date(lastDate);
    nextDate.setMonth(nextDate.getMonth() + 1);
    setInstallments([
      ...installments,
      {
        id: `installment-${Date.now()}`,
        amount: '',
        dueDate: toDateInputValue(nextDate),
      },
    ]);
  };

  const removeRow = (id) => {
    setInstallments((rows) => rows.filter((row) => row.id !== id));
  };

  return (
    <section className="section custom-schedule-section">
      <div className="custom-schedule-header">
        <span className="label">Your payment schedule</span>
        <button type="button" className="schedule-helper-btn" onClick={onEvenSplit}>
          Even split
        </button>
      </div>
      <p className="custom-schedule-hint">
        Add each future payment with an amount and due date. We&apos;ll send one invoice per payment on that date.
      </p>
      <div className="custom-schedule-rows">
        {installments.map((row, index) => (
          <div className="custom-schedule-row" key={row.id}>
            <span className="custom-schedule-row-label">Payment {index + 1}</span>
            <input
              type="number"
              inputMode="numeric"
              className="custom-schedule-amount"
              placeholder="Amount"
              min={MIN_MONTHLY_PAYMENT}
              value={row.amount === '' ? '' : row.amount}
              onChange={(e) => {
                const value = e.target.value;
                updateRow(row.id, 'amount', value === '' ? '' : parseInt(value, 10));
              }}
              aria-label={`Payment ${index + 1} amount`}
            />
            <input
              type="date"
              className="custom-schedule-date"
              min={minDate}
              value={row.dueDate}
              onChange={(e) => updateRow(row.id, 'dueDate', e.target.value)}
              aria-label={`Payment ${index + 1} due date`}
            />
            <button
              type="button"
              className="custom-schedule-remove"
              onClick={() => removeRow(row.id)}
              disabled={installments.length <= 1}
              aria-label={`Remove payment ${index + 1}`}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="schedule-add-btn" onClick={addRow}>
        + Add payment
      </button>
      <div className={`custom-schedule-balance${scheduleValidation.remainderMismatch ? ' custom-schedule-balance-error' : ''}`}>
        Allocated: {formatCurrency(scheduleValidation.allocated)} of {formatCurrency(remainder)} remaining
      </div>
    </section>
  );
}

// Success screen shown after submission
function DoneView({
  paymentOption,
  patientEmail,
  invoiceUrl,
  deposit,
  monthlyPayment,
  months,
  totalPrice,
  isSlidingScale,
  installments,
}) {
  const firstInvoiceDate = getFirstInvoiceDate();
  const sortedInstallments = installments
    ? [...installments].sort((a, b) => parseDueDate(a.dueDate) - parseDueDate(b.dueDate))
    : [];

  return (
    <div className="app done-view">
      <div className="done-container">
        <div className="done-header">
          <div className="done-header-title">
            <div className="checkmark">✓</div>
            <h1>You're All Set!</h1>
          </div>
          <p className={`done-subtitle${isSlidingScale ? ' done-subtitle-returning' : ''}`}>
            {isSlidingScale ? (
              <>We've emailed your invoice to <strong>{patientEmail}</strong>. Payment is due in 7 days. You can pay now if you'd like.</>
            ) : paymentOption === 'plan' || paymentOption === 'installment' ? (
              <>Your deposit invoice has been sent to <strong>{patientEmail}</strong>.</>
            ) : (
              <>We've sent an invoice to <strong>{patientEmail}</strong>.</>
            )}
          </p>
        </div>

        {invoiceUrl && (
          <a
            href={invoiceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="done-pay-now-btn"
          >
            {paymentOption === 'plan' || paymentOption === 'installment' ? 'Pay My Deposit' : 'Pay Now'}
          </a>
        )}

        {paymentOption === 'installment' && sortedInstallments.length > 0 && (
          <div className="done-timeline">
            <div className="done-timeline-item done-timeline-now">
              <div className="done-timeline-dot"></div>
              <div className="done-timeline-content">
                <span className="done-timeline-label">Now</span>
                <span className="done-timeline-detail">Deposit invoice for {formatCurrency(deposit)}</span>
              </div>
            </div>
            {sortedInstallments.map((row, index) => (
              <div
                key={`${row.dueDate}-${index}`}
                className={`done-timeline-item${index === sortedInstallments.length - 1 ? ' done-timeline-last' : ''}`}
              >
                <div className="done-timeline-dot"></div>
                <div className="done-timeline-content">
                  <span className="done-timeline-label">{formatDate(parseDueDate(row.dueDate))}</span>
                  <span className="done-timeline-detail">Invoice for {formatCurrency(row.amount)}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {paymentOption === 'plan' && (
          <div className="done-timeline">
            <div className="done-timeline-item done-timeline-now">
              <div className="done-timeline-dot"></div>
              <div className="done-timeline-content">
                <span className="done-timeline-label">Now</span>
                <span className="done-timeline-detail">Deposit invoice for {formatCurrency(deposit)}</span>
              </div>
            </div>
            <div className="done-timeline-item">
              <div className="done-timeline-dot"></div>
              <div className="done-timeline-content">
                <span className="done-timeline-label">{formatDate(firstInvoiceDate)}</span>
                <span className="done-timeline-detail">First monthly invoice — {formatCurrency(monthlyPayment)}</span>
              </div>
            </div>
            <div className="done-timeline-item">
              <div className="done-timeline-dot"></div>
              <div className="done-timeline-content">
                <span className="done-timeline-label">Then monthly</span>
                <span className="done-timeline-detail">{months - 1} more invoice{months - 1 !== 1 ? 's' : ''} of {formatCurrency(monthlyPayment)}, sent automatically</span>
              </div>
            </div>
            <div className="done-timeline-item done-timeline-last">
              <div className="done-timeline-dot"></div>
              <div className="done-timeline-content">
                <span className="done-timeline-label">{formatDate(getPayoffDate(months))}</span>
                <span className="done-timeline-detail">All paid off</span>
              </div>
            </div>
          </div>
        )}

        {paymentOption === 'full' && (
          <div className="done-summary">
            <div className="done-card">
              <span className="done-label">Total</span>
              <span className="done-value">{formatCurrency(totalPrice)}</span>
            </div>
          </div>
        )}

        <div className="done-info-section">
          <div className="done-info-item">
            <span className="done-info-icon">🏦</span>
            <div>
              <strong>Please Pay by Bank Account</strong>
              <p>When you open your invoice, look for the "Bank Account / ACH" option. Paying this way helps us keep the service fee-free for everyone.</p>
            </div>
          </div>

          <div className="done-info-item done-info-muted">
            <span className="done-info-icon">✉️</span>
            <div>
              <p>Made a mistake? Just let us know and we'll update it.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────────

function App() {
  // URL configuration (read-only, parsed once per render)
  const { isSlidingScale, originalPrice, dueDate, extendedParam, maxPrice, previewDone } = parseUrlParams();

  // Derived pricing constants
  const FIXED_PRICE = maxPrice || DEFAULT_FIXED_PRICE;
  const SLIDING_SCALE_MAX = maxPrice || DEFAULT_SLIDING_SCALE_MAX;
  const slidingScaleMin = originalPrice || DEFAULT_MIN;
  const maxMonths = getMaxMonths(extendedParam);
  const isExtended = maxMonths > 9;
  const defaultSlidingPrice = calculateDefaultSlidingPrice(slidingScaleMin, SLIDING_SCALE_MAX);

  // State
  const [selectedPrice, setSelectedPrice] = useState(isSlidingScale ? defaultSlidingPrice : FIXED_PRICE);
  const [months, setMonths] = useState(6);
  const [depositPercent, setDepositPercent] = useState(0.10);
  const [customDeposit, setCustomDeposit] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(previewDone);
  const [submitError, setSubmitError] = useState(null);
  const [showContactModal, setShowContactModal] = useState(false);
  const [showNameModal, setShowNameModal] = useState(false);
  const [showAchModal, setShowAchModal] = useState(false);
  const [showIntroModal, setShowIntroModal] = useState(!previewDone);
  const [showWelcomeModal, setShowWelcomeModal] = useState(isSlidingScale && !previewDone);
  const [patientName, setPatientName] = useState(previewDone ? 'Jane Doe' : '');
  const [patientEmail, setPatientEmail] = useState(previewDone ? 'jane@example.com' : '');
  const [paymentOption, setPaymentOption] = useState(previewDone ? 'plan' : (isSlidingScale ? 'plan' : null));
  const [invoiceUrl, setInvoiceUrl] = useState(previewDone ? '#' : null);
  const [scheduleMode, setScheduleMode] = useState('monthly');
  const [customInstallments, setCustomInstallments] = useState([]);

  // Derived values
  const totalPrice = isSlidingScale ? selectedPrice : FIXED_PRICE;
  const payoffDate = getPayoffDate(months);
  const minDepositAmount = calculateMinDeposit(totalPrice, isSlidingScale);
  const deposit = calculateDeposit({ customDeposit, minDepositAmount, totalPrice, depositPercent });
  const remainder = totalPrice - deposit;
  const monthlyPayment = remainder / months;
  const canUseCustomSchedule = qualifiesForCustomSchedule(deposit, totalPrice);
  const useCustomSchedule = scheduleMode === 'custom' && canUseCustomSchedule;

  const scheduleValidation = validateCustomSchedule({
    installments: customInstallments,
    remainder,
    dueDate,
  });

  // Warning flags
  const monthlyWarnings = getWarnings({
    customDeposit, minDepositAmount, deposit, totalPrice, isSlidingScale, monthlyPayment, dueDate, payoffDate,
  });
  const { depositBelowMin, depositBelowPercent, depositExceedsTotal } = monthlyWarnings;
  const pastDueDate = useCustomSchedule ? scheduleValidation.pastDueDate : monthlyWarnings.pastDueDate;
  const belowMinPayment = useCustomSchedule ? scheduleValidation.belowMinPayment : monthlyWarnings.belowMinPayment;
  const hasWarning = depositBelowMin || depositBelowPercent || depositExceedsTotal
    || (useCustomSchedule ? scheduleValidation.hasWarning : monthlyWarnings.hasWarning);

  useEffect(() => {
    if (!canUseCustomSchedule && scheduleMode === 'custom') {
      setScheduleMode('monthly');
    }
  }, [canUseCustomSchedule, scheduleMode]);

  useEffect(() => {
    if (useCustomSchedule && customInstallments.length === 0) {
      setCustomInstallments(suggestCustomInstallments({ remainder, dueDate }));
    }
  }, [useCustomSchedule, remainder, dueDate, customInstallments.length]);

  // ── Handlers ─────────────────────────────────────────────

  const handlePresetClick = (percent) => {
    setDepositPercent(percent);
    setCustomDeposit(null);
  };

  const switchToCustomSchedule = () => {
    setScheduleMode('custom');
    setCustomInstallments(suggestCustomInstallments({ remainder, dueDate }));
  };

  const handleEvenSplit = () => {
    setCustomInstallments(suggestCustomInstallments({
      remainder,
      dueDate,
      count: customInstallments.length || 3,
    }));
  };

  const handleSubmit = () => {
    if (isSubmitting || hasWarning) return;
    setShowNameModal(true);
  };

  const closeNameModal = () => {
    if (isSubmitting) return;
    setShowNameModal(false);
    setPatientName('');
    setPatientEmail('');
    setSubmitError(null);
  };

  const handleEmailKeyDown = (e) => {
    if (e.key === 'Enter' && patientName.trim() && patientEmail.trim() && !isSubmitting) {
      submitWithName();
    }
  };

  const submitWithName = () => {
    const trimmedName = patientName.trim();
    const trimmedEmail = patientEmail.trim();

    if (!trimmedName) {
      setSubmitError('Please enter patient name');
      return;
    }

    if (!trimmedEmail) {
      setSubmitError('Please enter patient email');
      return;
    }

    if (!isValidEmail(trimmedEmail)) {
      setSubmitError('Please enter a valid email address');
      return;
    }

    setSubmitError(null);
    setShowNameModal(false);
    setShowAchModal(true);
  };

  const confirmAndSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    const submissionPaymentOption = paymentOption === 'full'
      ? 'full'
      : (useCustomSchedule ? 'installment' : 'plan');
    const normalizedInstallments = useCustomSchedule
      ? customInstallments.map(({ amount, dueDate: installmentDueDate }) => ({
        amount: Number(amount),
        dueDate: installmentDueDate,
      }))
      : null;
    const submissionPayoffDate = paymentOption === 'full'
      ? null
      : (useCustomSchedule ? scheduleValidation.payoffDate : payoffDate);

    const payload = {
      name: patientName.trim(),
      email: patientEmail.trim(),
      totalPrice,
      paymentOption: submissionPaymentOption,
      deposit: paymentOption === 'full' ? totalPrice : deposit,
      monthlyPayment: paymentOption === 'full' || useCustomSchedule ? 0 : monthlyPayment,
      months: paymentOption === 'full' ? 0 : (useCustomSchedule ? normalizedInstallments.length : months),
      payoffDate: submissionPayoffDate ? submissionPayoffDate.toISOString() : null,
      dueDate: dueDate || null,
      isSlidingScale,
      originalPrice: originalPrice || null,
      isExtended,
      timestamp: new Date().toISOString(),
      depositPercent: paymentOption !== 'full' && customDeposit === null ? depositPercent : null,
      customDeposit: paymentOption !== 'full' && customDeposit !== null ? customDeposit : null,
      ...(useCustomSchedule && { installments: normalizedInstallments }),
    };

    const bodyString = JSON.stringify(payload);
    if (!bodyString || bodyString === '{}') {
      setSubmitError('Invalid form data. Please try again.');
      setIsSubmitting(false);
      return;
    }

    try {
      const response = await fetch(SUBMISSION_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyString,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      try {
        const data = await response.json();
        if (data?.invoiceUrl) {
          setInvoiceUrl(data.invoiceUrl);
        }
      } catch {
        // Response may not be JSON — that's fine
      }

      setShowAchModal(false);
      if (useCustomSchedule) {
        setPaymentOption('installment');
      }
      setSubmitSuccess(true);
    } catch (error) {
      console.error('Submission error:', error);
      setSubmitError(error.message || 'Failed to submit. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Render ───────────────────────────────────────────────

  if (submitSuccess) {
    return (
      <DoneView
        paymentOption={paymentOption}
        patientEmail={patientEmail}
        invoiceUrl={invoiceUrl}
        deposit={deposit}
        monthlyPayment={monthlyPayment}
        months={months}
        totalPrice={totalPrice}
        isSlidingScale={isSlidingScale}
        installments={paymentOption === 'installment' ? customInstallments : null}
      />
    );
  }

  const priceSectionProps = {
    isSlidingScale,
    selectedPrice,
    setSelectedPrice,
    slidingScaleMin,
    slidingScaleMax: SLIDING_SCALE_MAX,
    fixedPrice: FIXED_PRICE,
  };

  // "Pay by" date text for the info section (1 month before due date)
  const payByDateText = dueDate
    ? `. We typically ask that your balance be paid off by ${formatDate(getOneMonthBefore(parseDueDate(dueDate)))}`
    : '';

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
            Due Date: {formatDate(parseDueDate(dueDate))}
          </div>
        )}
      </header>

      {/* Payment Option Selection */}
      {paymentOption === null && (
        <section className="section payment-option-section">
          <p className="payment-intro">
            Explore your payment options — nothing happens until you're ready, and we'll confirm everything with you first.
            <br /><br />
            Once you submit, we'll send an invoice to your email (and set up monthly invoices automatically if you choose a plan).
          </p>
          <div className="label" style={{ marginBottom: '16px' }}>How would you like to pay?</div>
          <div className="payment-options">
            <button className="payment-option-btn" onClick={() => setPaymentOption('full')}>
              <div className="option-title">Pay in Full</div>
              <div className="option-description">Pay the full amount upfront</div>
            </button>
            <button className="payment-option-btn" onClick={() => setPaymentOption('plan')}>
              <div className="option-title">Payment Plan</div>
              <div className="option-description">Split into monthly payments</div>
            </button>
          </div>
        </section>
      )}

      {/* Full Payment Option */}
      {paymentOption === 'full' && (
        <>
          <PriceSection {...priceSectionProps} />

          {/* Name & Email Form */}
          <section className="section">
            <div className="label" style={{ marginBottom: '12px' }}>Patient Details</div>
            <div className="name-input-wrapper">
              <input
                type="text"
                className="name-input"
                placeholder="Patient name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
              />
              <input
                type="email"
                className="name-input"
                placeholder="Patient email"
                value={patientEmail}
                onChange={(e) => setPatientEmail(e.target.value)}
                onKeyDown={handleEmailKeyDown}
              />
            </div>
            {submitError && (
              <div className="error-message" style={{ marginTop: '12px' }}>
                {submitError}
              </div>
            )}
          </section>

          {/* Info Section */}
          <footer className="info-section">
            <div className="info-item">
              <strong>Payment Methods</strong>
              <p>We accept all payment methods. If you are planning to use a debit card, consider paying by bank account (ACH) instead — it pulls from the same place and helps us keep things fee-free.</p>
            </div>
            <div className="info-item">
              <strong>Need a payment plan instead?</strong>
              <p><button className="contact-link" onClick={() => setPaymentOption(null)}>Change to payment plan</button></p>
            </div>
          </footer>

          {/* Submit Button */}
          <button
            className="submit-btn"
            onClick={submitWithName}
            disabled={isSubmitting || !patientName.trim() || !patientEmail.trim()}
          >
            {isSubmitting && <div className="spinner"></div>}
            {isSubmitting ? 'Saving...' : 'Submit'}
          </button>
        </>
      )}

      {/* Payment Plan Option */}
      {paymentOption === 'plan' && (
        <>
          <PriceSection {...priceSectionProps} />

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
                    const num = parseInt(value, 10);
                    if (!isNaN(num)) {
                      setCustomDeposit(num);
                      setDepositPercent(null);
                    }
                  }
                }}
              />
            </div>
          </div>

          {canUseCustomSchedule && (
            <section className="section schedule-mode-section">
              <div className="label" style={{ marginBottom: '10px' }}>Payment schedule</div>
              <div className="schedule-mode-toggle">
                <button
                  type="button"
                  className={`quick-btn ${scheduleMode === 'monthly' ? 'active' : ''}`}
                  onClick={() => setScheduleMode('monthly')}
                >
                  Equal monthly
                </button>
                <button
                  type="button"
                  className={`quick-btn ${scheduleMode === 'custom' ? 'active' : ''}`}
                  onClick={switchToCustomSchedule}
                >
                  Custom dates
                </button>
              </div>
              {scheduleMode === 'custom' && (
                <p className="schedule-mode-note">
                  With a deposit of 25% or more, you can set your own payment dates. Each payment is invoiced separately (not a monthly subscription).
                </p>
              )}
            </section>
          )}

          {!useCustomSchedule && (
            <section className="section timeline-section">
              <div className="timeline-header">
                <span className="label">Pay over</span>
                <span className="months-value">{months} {months === 1 ? 'month' : 'months'}</span>
              </div>
              <div className="slider-wrapper">
                <input
                  type="range"
                  min="1"
                  max={maxMonths}
                  value={months}
                  onChange={(e) => setMonths(parseInt(e.target.value, 10))}
                  className="slider"
                  aria-label="Select payment duration"
                  style={{ '--progress': `${((months - 1) / (maxMonths - 1)) * 100}%` }}
                />
              </div>
            </section>
          )}

          {useCustomSchedule && (
            <CustomScheduleEditor
              installments={customInstallments}
              setInstallments={setCustomInstallments}
              remainder={remainder}
              dueDate={dueDate}
              scheduleValidation={scheduleValidation}
              onEvenSplit={handleEvenSplit}
            />
          )}

          {/* Summary Cards */}
          <div className="summary-cards">
            <div className="summary-card">
              <span className="card-label">Deposit Today</span>
              <span className="card-amount">{formatCurrency(deposit)}</span>
            </div>
            {useCustomSchedule ? (
              <div className="summary-card">
                <span className="card-label">{customInstallments.length} Payments</span>
                <span className="card-amount">{formatCurrency(remainder)}</span>
              </div>
            ) : (
              <div className="summary-card">
                <span className="card-label">{months}× Monthly</span>
                <span className="card-amount">{formatCurrency(monthlyPayment)}</span>
              </div>
            )}
          </div>

          {/* Warnings */}
          {hasWarning && (
            <div className="warnings">
              {pastDueDate && (
                <div className="warning">
                  {useCustomSchedule
                    ? 'Your last payment is after your due date—move dates earlier or adjust amounts.'
                    : 'This plan extends past your due date—adjust months to finish earlier.'}
                </div>
              )}
              {useCustomSchedule && scheduleValidation.remainderMismatch && (
                <div className="warning">
                  Scheduled payments must add up to {formatCurrency(remainder)} (currently {formatCurrency(scheduleValidation.allocated)}).
                </div>
              )}
              {useCustomSchedule && scheduleValidation.incompleteRows && (
                <div className="warning">
                  Enter an amount and due date for each payment in your schedule.
                </div>
              )}
              {useCustomSchedule && scheduleValidation.invalidDates && (
                <div className="warning">
                  Each payment date must be today or later.
                </div>
              )}
              {belowMinPayment && (
                <div className="warning">
                  {useCustomSchedule
                    ? `Each payment must be at least ${formatCurrency(MIN_MONTHLY_PAYMENT)}.`
                    : `The minimum payment is ${formatCurrency(MIN_MONTHLY_PAYMENT)}/mo. Try a shorter timeframe or higher deposit.`}
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
              <p>We accept all payment methods. If you are planning to use a debit card, consider paying by bank account (ACH) instead — it pulls from the same place and helps us keep things fee-free.</p>
            </div>
            <div className="info-item">
              <strong>How It Works</strong>
              <p>
                {useCustomSchedule
                  ? `After you submit, we'll send your deposit invoice right away. Each scheduled payment gets its own invoice on the date you chose${payByDateText}.`
                  : `After you submit, we'll send a deposit invoice right away. Your first monthly invoice arrives about 30 days later, then one each month after that${payByDateText}.`}
              </p>
            </div>
            {!canUseCustomSchedule && (
              <div className="info-item">
                <strong>Need more flexibility?</strong>
                <p>
                  Put down 25% or more to build a custom payment schedule, or{' '}
                  <button className="contact-link" onClick={() => setShowContactModal(true)}>contact us</button>.
                </p>
              </div>
            )}
            <div className="info-item">
              <strong>Want to pay in full instead?</strong>
              <p><button className="contact-link" onClick={() => setPaymentOption(null)}>Change to full payment</button></p>
            </div>
          </footer>

          {/* Submit Button */}
          <button
            className="submit-btn"
            onClick={handleSubmit}
            disabled={isSubmitting || hasWarning}
          >
            {isSubmitting && <div className="spinner"></div>}
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>

          {/* Error Message */}
          {submitError && (
            <div className="error-message">
              {submitError}
            </div>
          )}
        </>
      )}

      {/* Intro Interstitial — shown first on load */}
      {showIntroModal && (
        <div className="modal-overlay">
          <div className="modal-content ach-modal">
            <div className="ach-modal-icon">🧭</div>
            <h2>Explore your options</h2>
            <p className="ach-modal-message">
              This page is for finding a plan that works for you.
              <br /><br />
              Nothing is set up until you choose to submit, so take your time looking around.
            </p>
            <button
              className="ach-modal-confirm-btn"
              onClick={() => setShowIntroModal(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Returning-Patient Welcome Modal */}
      {showWelcomeModal && !showIntroModal && (
        <div className="modal-overlay">
          <div className="modal-content ach-modal">
            <div className="ach-modal-icon">❤️</div>
            <h2>Welcome back</h2>
            <p className="ach-modal-message">
              Last time, you paid {formatCurrency(slidingScaleMin)}, and our new-patient price is now {formatCurrency(SLIDING_SCALE_MAX)}. Anywhere between the two is completely up to you — pick whatever feels right.
            </p>
            <button
              className="ach-modal-confirm-btn"
              onClick={() => setShowWelcomeModal(false)}
            >
              Got it
            </button>
          </div>
        </div>
      )}

      {/* Contact Modal */}
      {showContactModal && (
        <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" aria-label="Close" onClick={() => setShowContactModal(false)}>×</button>
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

      {/* Name & Email Entry Modal */}
      {showNameModal && (
        <div className="modal-overlay" onClick={closeNameModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" aria-label="Close" onClick={closeNameModal} disabled={isSubmitting}>×</button>
            <h2>Enter Patient Details</h2>
            <div className="name-input-wrapper">
              <input
                type="text"
                className="name-input"
                placeholder="Patient name"
                value={patientName}
                onChange={(e) => setPatientName(e.target.value)}
                disabled={isSubmitting}
                autoFocus
              />
              <input
                type="email"
                className="name-input"
                placeholder="Patient email"
                value={patientEmail}
                onChange={(e) => setPatientEmail(e.target.value)}
                onKeyDown={handleEmailKeyDown}
                disabled={isSubmitting}
              />
            </div>
            {submitError && (
              <div className="error-message" style={{ marginTop: '12px', marginBottom: '12px' }}>
                {submitError}
              </div>
            )}
            <div className="modal-actions">
              <button
                className="modal-cancel-btn"
                onClick={closeNameModal}
                disabled={isSubmitting}
              >
                Cancel
              </button>
              <button
                className="modal-submit-btn"
                onClick={submitWithName}
                disabled={!patientName.trim() || !patientEmail.trim() || isSubmitting}
              >
                {isSubmitting && <div className="spinner"></div>}
                {isSubmitting ? 'Saving...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ACH Payment Preference Modal */}
      {showAchModal && (
        <div className="modal-overlay">
          <div className="modal-content ach-modal">
            <div className="ach-modal-icon">🏦</div>
            <h2>One Quick Thing</h2>
            <p className="ach-modal-message">
              If you are going to pay with a debit card, consider using bank account (ACH) instead — it helps us keep things fee-free for everyone.
            </p>
            {submitError && (
              <div className="error-message" style={{ marginTop: '12px', marginBottom: '12px' }}>
                {submitError}
              </div>
            )}
            <button
              className="ach-modal-confirm-btn"
              onClick={confirmAndSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting && <div className="spinner"></div>}
              {isSubmitting ? 'Submitting...' : 'Got It — Submit My Plan'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App
