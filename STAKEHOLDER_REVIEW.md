# Pricing Calculator — Stakeholder Review

Hi! Please review the pricing calculator and answer the questions below. This helps us make sure everything works the way you expect and captures any changes you'd like to see.

---

## 🎯 What This Tool Does

The Pricing Calculator lets patients customize their payment plan before checkout. They can:
- See the total cost and how it breaks down (deposit + monthly payments)
- Choose how many months to spread payments over
- See their estimated payoff date
- Get warnings if their payment plan extends past their due date

---

## ✨ Feature Overview

### 1. Pricing Modes

**Fixed Price Mode** (default)
- Shows the standard $8,500 total
- Patient only chooses payment timeline

**Sliding Scale Mode** (for returning patients)
- Patient can adjust their price within a range
- Minimum is their previous price (or $4,000)
- Maximum is $8,500
- Adjusts in $250 increments

---

### 2. Payment Timeline

- Patients choose 1–9 months (or 1–12 with extended mode)
- Quick buttons for common choices: 3, 6, 9 (or 12)
- Slider for fine-tuned control

---

### 3. Cost Breakdown

The calculator shows three cards:
| Card | What it shows |
|------|---------------|
| **Today** | Deposit amount (10% of total, minimum $250) |
| **Monthly** | Equal monthly payments for remaining balance |
| **Total** | Final price + estimated payoff date |

---

### 4. Smart Warnings

The calculator shows helpful alerts when:
- ⚠️ Payment plan extends past the patient's due date
- ⚠️ Monthly payment would be less than $250

---

### 5. Footer Information

Three info sections at the bottom:
- **Payment Methods** — ACH, debit, credit cards (no processing fees, ACH preferred)
- **Timing** — Balance due 1 month before due date
- **Need flexibility?** — Encourages patients to reach out

---

## 📋 Review Questions

### Pricing

**Q1. Is the standard price correct?**
- [ ] Yes, $8,500 is correct
- [ ] No, it should be different: _____________

**Q2. Is the minimum deposit amount right?**
- [ ] Yes, 10% (minimum $250) works
- [ ] No, change to: _____________

**Q3. For sliding scale, is $4,000 the right minimum?**
- [ ] Yes, $4,000 minimum is correct
- [ ] No, change to: _____________

**Q4. Are $250 increments right for the sliding scale slider?**
- [ ] Yes, $250 steps feel right
- [ ] No, prefer smaller steps ($100)
- [ ] No, prefer larger steps ($500)

---

### Payment Terms

**Q5. Is the default payment term okay?**
- [ ] Yes, 6 months is a good default
- [ ] No, default to 3 months
- [ ] No, default to 9 months

**Q6. Should the maximum be 9 months or 12 months by default?**
- [ ] 9 months max is fine for most patients
- [ ] Make 12 months available to everyone
- [ ] Other: _____________

**Q7. Are the quick buttons (3, 6, 9) the right choices?**
- [ ] Yes, those are good
- [ ] No, change to: _____________

---

### Warnings & Messaging

**Q8. Is the due date warning helpful?**
> "Payment extends past your due date"
- [ ] Yes, keep it
- [ ] Change the wording to: _____________
- [ ] Remove it

**Q9. Is the minimum payment warning helpful?**
> "Minimum payment is $250/mo — try fewer months"
- [ ] Yes, keep it
- [ ] Change the wording to: _____________
- [ ] Remove it

**Q10. How do you feel about the payment methods text?**
> "We accept ACH, debit, and credit cards, and there are never any fees. Please pay with ACH if possible — this helps us control fees."
- [ ] Perfect as-is
- [ ] Change to: _____________

---

### Visual Design

**Q11. How does the overall look feel?**
- [ ] Love it — warm, professional, on-brand
- [ ] It's okay but could use some tweaks
- [ ] Needs significant changes

**Q12. Is the mobile layout working well?**
- [ ] Yes, looks great on phone
- [ ] Some issues: _____________

**Q13. Are the colors right?**
- [ ] Yes, the terracotta/cream palette works
- [ ] Would prefer different colors: _____________

---

### Missing Features

**Q14. Is anything missing that patients would need?**
- [ ] No, it covers everything
- [ ] Yes, add: _____________

**Q15. Should we add any of these features later?**
- [ ] Discount/promo codes
- [ ] Insurance integration
- [ ] Email/text the quote to patient
- [ ] Save quote for later
- [ ] None of these
- [ ] Other: _____________

---

## 🔗 Test Links

Try these URLs to see different modes:

| Mode | URL |
|------|-----|
| Default (fixed price) | `?` |
| Sliding scale | `?slidingScale=true` |
| With custom min price | `?slidingScale=true&originalPrice=5000` |
| With due date | `?dueDate=2026-06-15` |
| Extended 12 months | `?extended=true` |
| Full example | `?slidingScale=true&originalPrice=5500&dueDate=2026-07-01&extended=true` |

---

## 💬 Additional Feedback

Anything else you'd like to share?

```
[Write here]




```

---

**Thank you for reviewing!** Your feedback helps us make sure this works perfectly for patients.
