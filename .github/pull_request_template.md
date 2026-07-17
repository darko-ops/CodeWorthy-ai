# Summary

_What does this change do, in two or three sentences?_

## Root cause

_What actually caused the bug? Cite evidence (logs, code paths, a reproduction). "The retry created a second order" is a symptom, not a cause._

## The fix

_Why this approach? What alternatives did you consider and reject?_

## Testing

- [ ] Existing suite is green (`npm test`)
- [ ] I added a regression test and **verified it fails on `main`**

_What conditions do the new tests cover? What is deliberately not covered?_

## Data changes

_Migrations included? Are they backwards compatible with the currently deployed release? What is the rollback story for the data?_

## Deployment & rollback plan

_How would you release this (ordering, verification, what you'd monitor), and how would you roll it back if duplicate charges spike anyway?_

## AI assistance disclosure

_Which parts were AI-assisted, with what tools, and how did you verify them? (AI use is allowed and not penalized — this section is scored on how you stayed in control.)_
