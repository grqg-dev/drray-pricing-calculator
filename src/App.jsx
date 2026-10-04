import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  DEFAULT_FIXED_PRICE, MIN_MONTHLY_PAYMENT, DEFAULT_SLIDING_SCALE_MAX,
  SLIDING_SCALE_STEP, DEFAULT_MIN, DEPOSIT_PRESETS, SUBMISSION_API_URL,
  formatDate, formatCurrency, isValidEmail, parseDueDate, getOneMonthBefore,
  getPayoffDate, getFirstInvoiceDate, parseUrlParams, getMaxMonths,
  calculateDefaultSlidingPrice, calculateMinDeposit, calculateDeposit, getWarnings,
  qualifiesForCustomSchedule, suggestCustomInstallments, validateCustomSchedule,
  toDateInputValue, getEarliestPaymentDate, formatAmountInput, parseAmountInput,
  PAYMENT_INTERVALS, getMaxIntervalPayments, buildIntervalInstallments,
} from './utils'

// ── Sub-components ─────────────────────────────────────────

// Whole-dollar text field that shows "$2,500" while typing and reports 2500 (or '' when empty).
// Keeps the caret after the same digit when commas are inserted or removed.
function AmountInput({ value, onChange, ...rest }) {
  const inputRef = useRef(null);
  const caretDigits = useRef(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (caretDigits.current === null || !el || document.activeElement !== el) return;
    let pos = 0;
    let seen = 0;
    while (pos < el.value.length && seen < caretDigits.current) {
      if (/\d/.test(el.value[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
    caretDigits.current = null;
  });

  return (
    <input
      ref={inputRef}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value === '' || value === null ? '' : `$${formatAmountInput(value)}`}
      onChange={(e) => {
        const el = e.target;
        const caret = el.selectionStart ?? el.value.length;
        caretDigits.current = el.value.slice(0, caret).replace(/\D/g, '').length;
        onChange(parseAmountInput(el.value));
      }}
      {...rest}
    />
  );
}

const INTERVAL_LABELS = { 1: 'Monthly', 2: 'Every 2 months', 3: 'Every 3 months' };
const INTERVAL_SHORT = { 1: 'Monthly', 2: 'Every 2 mo', 3: 'Every 3 mo' };

function intervalSummary(count, amount) {
  const noun = count === 1 ? 'payment' : 'payments';
  return `${count} ${noun} of ${formatCurrency(amount)}`;
}

function Stepper({ value, min, max, onChange, label }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="stepper-btn" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
      <span className="stepper-value" aria-live="polite">{value}</span>
      <button type="button" className="stepper-btn" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
    </div>
  );
}

// Read-only list of upcoming payments; long monthly plans collapse the middle
function SchedulePreview({ rows }) {
  const shown = rows.length > 4 ? [rows[0], rows[1], null, rows[rows.length - 1]] : rows;
  return (
    <ol className="schedule-preview">
      {shown.map((row, i) => (row === null ? (
        <li key="more" className="schedule-preview-more">{rows.length - 3} more in between</li>
      ) : (
        <li key={row.dueDate + i} className="schedule-preview-row">
          <span>{formatDate(parseDueDate(row.dueDate))}</span>
          <span className="schedule-preview-amount">{formatCurrency(row.amount)}</span>
        </li>
      )))}
    </ol>
  );
}

// Equal-payment schedule once the deposit unlocks flexible plans: one card per frequency,
// each priced up front; the chosen card opens with a payment count and the dates.
function SchedulePlanCards({ schedule }) {
  const { intervalMonths, setIntervalMonths, count, setCount, maxCount, previewRows, onCustom, cardOptions } = schedule;
  return (
    <section className="section interval-section">
      <div className="label">How often</div>
      <div className="plan-cards" role="radiogroup" aria-label="How often">
        {cardOptions.map((opt) => {
          const selected = opt.intervalMonths === intervalMonths;
          return (
            <div key={opt.intervalMonths} className={`plan-card${selected ? ' selected' : ''}`}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                className="plan-card-head"
                onClick={() => setIntervalMonths(opt.intervalMonths)}
              >
                <span className="plan-card-radio" aria-hidden="true"></span>
                <span className="plan-card-title">{INTERVAL_LABELS[opt.intervalMonths]}</span>
                <span className="plan-card-sub">{intervalSummary(opt.count, opt.amount)}</span>
              </button>
              {selected && (
                <div className="plan-card-body">
                  <div className="stepper-row">
                    <span className="stepper-label">Number of payments</span>
                    <Stepper value={count} min={1} max={maxCount} onChange={setCount} label="Payments" />
                  </div>
                  <SchedulePreview rows={previewRows} />
                </div>
              )}
            </div>
          );
        })}
        <button type="button" className="plan-card plan-card-custom" onClick={onCustom}>
          <span className="plan-card-title">Choose my own dates</span>
          <span className="plan-card-sub">Set each payment's date and amount</span>
        </button>
      </div>
    </section>
  );
}

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
  onBackToEqual,
}) {
  // Invoices go out 15 days before each due date, so nothing can be due sooner
  const minDate = toDateInputValue(getEarliestPaymentDate());

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
        These payments cover what's left after your deposit. We'll email you each invoice 15 days before it's due.
      </p>
      <div className="custom-schedule-rows">
        {installments.map((row, index) => (
          <div className="custom-schedule-row" key={row.id}>
            <div className="custom-schedule-row-top">
              <span className="custom-schedule-row-label">Payment {index + 1}</span>
              <button
                type="button"
                className="custom-schedule-remove"
                onClick={() => removeRow(row.id)}
                disabled={installments.length <= 1}
                aria-label={`Remove payment ${index + 1}`}
              >
                Remove
              </button>
            </div>
            <label className="custom-schedule-field">
              <span>Amount</span>
              <AmountInput
                className="custom-schedule-amount"
                placeholder="$0"
                value={row.amount}
                onChange={(amount) => updateRow(row.id, 'amount', amount)}
                aria-label={`Payment ${index + 1} amount`}
              />
            </label>
            <label className="custom-schedule-field">
              <span>Due date</span>
              <input
                type="date"
                className="custom-schedule-date"
                min={minDate}
                value={row.dueDate}
                onChange={(e) => updateRow(row.id, 'dueDate', e.target.value)}
                aria-label={`Payment ${index + 1} due date`}
              />
            </label>
          </div>
        ))}
      </div>
      <button type="button" className="schedule-add-btn" onClick={addRow}>
        + Add payment
      </button>
      <div className={`custom-schedule-balance${scheduleValidation.remainderMismatch ? ' custom-schedule-balance-error' : ''}`}>
        Allocated: {formatCurrency(scheduleValidation.allocated)} of {formatCurrency(remainder)} remaining
      </div>
      <button type="button" className="text-link-btn" onClick={onBackToEqual}>Back to equal payments</button>
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
                  <span className="done-timeline-label">Due {formatDate(parseDueDate(row.dueDate))}</span>
                  <span className="done-timeline-detail">{formatCurrency(row.amount)}. We'll email the invoice 15 days before.</span>
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
  const [scheduleMode, setScheduleMode] = useState('equal');
  const [intervalMonths, setIntervalMonths] = useState(1);
  // Payments per frequency (months between payments → count); monthly uses `months`
  const [intervalCounts, setIntervalCounts] = useState({ 2: 3, 3: 2 });
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
  // Equal payments every 2+ months go out as one invoice per payment, like custom dates.
  // Monthly stays a Stripe subscription.
  const useIntervalSchedule = canUseCustomSchedule && !useCustomSchedule && intervalMonths > 1;
  const useInstallments = useCustomSchedule || useIntervalSchedule;

  const maxPaymentsFor = (n) => (n === 1 ? maxMonths : getMaxIntervalPayments({ intervalMonths: n, maxMonths, remainder }));
  const clampCount = (n, value) => Math.max(1, Math.min(value, maxPaymentsFor(n)));
  const activeInterval = canUseCustomSchedule ? intervalMonths : 1;
  const countFor = (n) => (n === 1 ? months : clampCount(n, intervalCounts[n]));
  const equalCount = countFor(activeInterval);
  const equalRows = buildIntervalInstallments({ remainder, count: equalCount, intervalMonths: activeInterval });
  const installmentRows = useCustomSchedule ? customInstallments : (useIntervalSchedule ? equalRows : []);
  const installmentAmount = useIntervalSchedule ? remainder / equalCount : 0;

  const scheduleValidation = validateCustomSchedule({
    installments: installmentRows,
    remainder,
    dueDate,
  });

  // Warning flags
  const monthlyWarnings = getWarnings({
    customDeposit, minDepositAmount, deposit, totalPrice, isSlidingScale, monthlyPayment, dueDate, payoffDate,
  });
  const { depositBelowMin, depositBelowPercent, depositExceedsTotal } = monthlyWarnings;
  const pastDueDate = useInstallments ? scheduleValidation.pastDueDate : monthlyWarnings.pastDueDate;
  const belowMinPayment = useInstallments ? scheduleValidation.belowMinPayment : monthlyWarnings.belowMinPayment;
  const hasWarning = depositBelowMin || depositBelowPercent || depositExceedsTotal
    || (useInstallments ? scheduleValidation.hasWarning : monthlyWarnings.hasWarning);

  useEffect(() => {
    if (!canUseCustomSchedule && scheduleMode === 'custom') {
      setScheduleMode('equal');
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

  // Custom dates start from whatever equal schedule is showing, so patients only tweak it
  const switchToCustomSchedule = () => {
    setScheduleMode('custom');
    setCustomInstallments(equalRows.map((row, i) => ({ ...row, id: `installment-${Date.now()}-${i}` })));
  };

  const setEqualCount = (value) => {
    if (activeInterval === 1) setMonths(Math.max(1, Math.min(value, maxMonths)));
    else setIntervalCounts((counts) => ({ ...counts, [activeInterval]: clampCount(activeInterval, value) }));
  };

  // Typical payment; uneven splits differ by $1, and the date list shows exact amounts
  const cardOptions = PAYMENT_INTERVALS.map((n) => {
    const count = countFor(n);
    return { intervalMonths: n, count, amount: remainder / count };
  });

  const scheduleProps = {
    intervalMonths,
    setIntervalMonths,
    count: equalCount,
    setCount: setEqualCount,
    maxCount: maxPaymentsFor(activeInterval),
    previewRows: activeInterval === 1 ? equalRows.map((row) => ({ ...row, amount: monthlyPayment })) : equalRows,
    onCustom: switchToCustomSchedule,
    cardOptions,
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
      : (useInstallments ? 'installment' : 'plan');
    const normalizedInstallments = useInstallments
      ? installmentRows.map(({ amount, dueDate: installmentDueDate }) => ({
        amount: Number(amount),
        dueDate: installmentDueDate,
      }))
      : null;
    const submissionPayoffDate = paymentOption === 'full'
      ? null
      : (useInstallments ? scheduleValidation.payoffDate : payoffDate);

    const payload = {
      name: patientName.trim(),
      email: patientEmail.trim(),
      totalPrice,
      paymentOption: submissionPaymentOption,
      deposit: paymentOption === 'full' ? totalPrice : deposit,
      monthlyPayment: paymentOption === 'full' || useInstallments ? 0 : monthlyPayment,
      months: paymentOption === 'full' ? 0 : (useInstallments ? normalizedInstallments.length : months),
      payoffDate: submissionPayoffDate ? submissionPayoffDate.toISOString() : null,
      dueDate: dueDate || null,
      isSlidingScale,
      originalPrice: originalPrice || null,
      isExtended,
      timestamp: new Date().toISOString(),
      depositPercent: paymentOption !== 'full' && customDeposit === null ? depositPercent : null,
      customDeposit: paymentOption !== 'full' && customDeposit !== null ? customDeposit : null,
      ...(useInstallments && { installments: normalizedInstallments }),
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
      if (useInstallments) {
        setCustomInstallments(installmentRows);
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
    ? ` Plan to finish paying by ${formatDate(getOneMonthBefore(parseDueDate(dueDate)))}.`
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
              <AmountInput
                className={`deposit-input ${customDeposit !== null ? 'active' : ''}`}
                placeholder="Custom"
                aria-label="Custom deposit amount"
                value={customDeposit !== null ? customDeposit : ''}
                onChange={(amount) => {
                  if (amount === '') {
                    setCustomDeposit(null);
                    setDepositPercent(0.10);
                  } else {
                    setCustomDeposit(amount);
                    setDepositPercent(null);
                  }
                }}
              />
            </div>
          </div>

          {!canUseCustomSchedule && (
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

          {canUseCustomSchedule && !useCustomSchedule && <SchedulePlanCards schedule={scheduleProps} />}

          {useCustomSchedule && (
            <CustomScheduleEditor
              installments={customInstallments}
              setInstallments={setCustomInstallments}
              remainder={remainder}
              dueDate={dueDate}
              scheduleValidation={scheduleValidation}
              onEvenSplit={handleEvenSplit}
              onBackToEqual={() => setScheduleMode('equal')}
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
            ) : useIntervalSchedule ? (
              <div className="summary-card">
                <span className="card-label">{equalCount}× {INTERVAL_SHORT[intervalMonths]}</span>
                <span className="card-amount">{formatCurrency(installmentAmount)}</span>
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
                    : useIntervalSchedule
                      ? 'Your last payment is after your due date—choose fewer payments to finish earlier.'
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
                  Pick due dates at least 15 days from today. We email each invoice 15 days before it's due.
                </div>
              )}
              {belowMinPayment && (
                <div className="warning">
                  {useInstallments
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
                  ? `When you submit, we'll email your deposit invoice. You'll get an invoice for each payment 15 days before the due date you picked.${payByDateText}`
                  : useIntervalSchedule
                  ? `When you submit, we'll email your deposit invoice. Your first payment is due in about 30 days, then every ${intervalMonths} months after that. You'll get each invoice 15 days before it's due.${payByDateText}`
                  : `After you submit, we'll send a deposit invoice right away. Your first monthly invoice arrives about 30 days later, then one each month after that.${payByDateText}`}
              </p>
            </div>
            {!canUseCustomSchedule && (
              <div className="info-item">
                <strong>Need more flexibility?</strong>
                <p>
                  Put down 50% or more to pay every 2 or 3 months or pick your own dates, or{' '}
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
