# 30-Day Validation Plan

Four hypotheses must be proven before building more product:

1. **Learners improve** — completing simulations makes someone observably better at testing, debugging, and explaining work.
2. **The assessment separates candidates** — it distinguishes: cannot complete the work / AI completed it but they don't understand it / understands the local fix but misses production risk / can responsibly own the change.
3. **Employers trust the evidence** — an engineering manager believes the evidence predicts job performance.
4. **The test saves employer time** — it eliminates weak interviews or makes final interviews substantially more informative.

## Week 1 — Build the challenge  ✅ (this repo)

- [x] Create the fictional application (`simulations/acme-orders`)
- [x] Seed one realistic bug (duplicate order/charge on checkout retry)
- [x] Write visible and hidden evaluation tests
- [x] Define a scoring rubric (`evaluation/rubric.md`)
- [x] Create the pull-request template (`.github/pull_request_template.md`)
- [x] Write the technical-defense questions (`evaluation/defense-questions.md`)

## Week 2 — Run five learners through it

Observe them directly. Measure:

- Where they become confused
- Which AI tools they use and how
- Whether the instructions are clear
- Whether strong and weak performance look meaningfully different
- How long the challenge takes against the scenario's declared timebox (4h for ACME-1287) — is the timebox realistic?
- Whether the defense exposes shallow understanding

## Week 3 — Produce employer reports

Turn each submission into a competency report (`evaluation/report-template.md`). Give the reports — without our conclusions — to experienced engineers and ask:

- What hiring decision would this influence?
- What evidence do you trust? What feels overstated? What is missing?
- Would this replace or shorten an interview stage?

## Week 4 — Sell a pilot

Approach 10–20 startup engineering leaders. Offer: a standardized assessment, up to five candidates, manual review, a calibration session, at ~$500–1,000. Do not ask "do you like this idea?" — ask them to use it in an active hiring process and pay something for it.

## Operating rules for the MVP phase

- Manually review **every** submission. Automation introduced before we understand how strong engineers behave will encode shallow assumptions into the evaluator.
- Terminal/activity capture only with explicit consent.
- Candidates receive their own competency report.
- Keep validity claims narrow until scores are compared against structured human review and (with consent) later job performance.
