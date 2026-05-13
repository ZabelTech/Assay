---
kind: skill
slug: code-review
updated_at: 2026-05-01
sources:
  - https://google.github.io/eng-practices/review/
  - https://mtlynch.io/human-code-reviews-1/
  - https://www.pullrequest.com/blog/code-review-best-practices/
related:
  - staff-platform-engineer
  - distributed-systems
  - fintech
---

# Code review

The cross-cutting skill of giving (and receiving) substantive review on
others' code. Cross-cutting because it shows up in nearly every role and
industry, with the demand intensity and shape varying by context.

## Signal

> sources: 1, 2

- Comments distinguish style/taste opinions (negotiable) from
  correctness/safety concerns (blocking) and signal which is which.
- Reviewer engages with the **why** of a change before the **what** —
  asks for the design intent rather than rewriting the code in the comment
  thread.
- Comments are specific and actionable: "this races with X on Y path"
  rather than "this looks risky."
- When the reviewer doesn't understand a piece, they say so out loud
  rather than rubber-stamping.

## Corroborating evidence

> sources: 1, 3

- `project` claims describing a contribution to a sizeable open-source
  codebase where review history is public; the author's review comments
  themselves become evidence.
- `endorsement` claims from peers specifically describing review style
  ("changed how our team approaches review", "always catches the subtle
  case"). Generic endorsements that don't mention review behavior are
  weak signal for this skill.
- `employment` claims at companies known for review culture (e.g. Google,
  Stripe historically). Weak on its own; the title doesn't review code.

## Caveats

> sources: 2, 3

- Review style is culturally loaded. What reads as "thorough" in one team
  reads as "blocker" in another. Endorsements from a single company
  describe that company's review culture, not a universal property.
- High comment volume is not the same as good review. A reviewer who leaves
  fifty nits and approves a broken architecture has worse output than a
  reviewer who leaves three pointed comments. The signal is in the
  substance, not the count.
- The skill rebalances with seniority. Junior reviewers add value by
  catching local correctness issues; staff/principal reviewers add value
  by surfacing architectural concerns before the code is even written
  (i.e. via design review). Both are "code review" colloquially; they
  cite different evidence.
