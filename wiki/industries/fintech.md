---
kind: industry
slug: fintech
updated_at: 2026-05-01
sources:
  - https://www.federalreserve.gov/supervisionreg/topics/payments_systems.htm
  - https://stripe.com/blog/idempotency
  - https://www.pcisecuritystandards.org/document_library/
  - https://www.fdic.gov/regulations/laws/rules/
related:
  - staff-platform-engineer
  - distributed-systems
---

# Fintech

Financial-services software: payments, banking-as-a-service, lending,
trading, accounting infrastructure. The industry adds three pressures to
otherwise-normal engineering work: regulatory surface area, accounting
integrity, and money-movement adversarial conditions.

## Signal

> sources: 1, 2, 3

- Idempotency as a first-class concept across the system, not just at the
  HTTP layer. Candidates speak fluently about idempotency keys, dedup,
  retries, and reconciliation.
- Accounting-style discipline in data models: ledger-based design, immutable
  append-only event logs, double-entry bookkeeping rather than mutable
  balances.
- Awareness of at least one regulatory regime (PCI-DSS, KYC/AML, PSD2, SOX,
  Reg E, etc.) and what it implies for engineering choices (data
  retention, encryption, access logging).
- Production safeguards weighted heavily: rate limits, transaction caps,
  velocity checks, kill switches, manual approval flows.

## Corroborating evidence

> sources: 2, 3, 4

- `employment` at a regulated financial entity (bank, payment processor,
  trading firm) or a vendor that maps cleanly onto one (Stripe, Plaid,
  Ramp).
- `project` claims involving ledgers, settlement, reconciliation, fraud
  detection, or compliance reporting.
- `credential` claims like "PCI-DSS compliance training" or "AML
  certification" are weak on their own; they corroborate but rarely lead.
- `endorsement` claims from compliance, legal, or finance counterparts
  (rarer than peer endorsements, disproportionately informative when
  present).

## Caveats

> sources: 1, 4

- "Worked on a payments feature" varies wildly. Integrating Stripe Checkout
  on a SaaS app is fintech-adjacent; building the settlement system that
  Stripe Checkout calls is fintech.
- Regulatory exposure differs by jurisdiction and sub-sector. US bank
  charter work is very different from EU PSD2 work which is very different
  from crypto-exchange work. Endorsers from one sub-sector don't
  automatically corroborate claims about another.
- The industry's demand signal shifts faster than most. Crypto and embedded
  finance have both whipsawed in the last several years; the staleness
  warning matters here more than on, say, distributed systems.
