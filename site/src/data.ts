// Demo data layer. Everything the UI reads comes from here, so swapping in a
// real API later is a matter of replacing these exports with fetchers.

export const COMPETENCIES = [
  "Codebase comprehension",
  "Root-cause analysis",
  "Implementation",
  "Testing",
  "Systems thinking",
  "Security",
  "Data safety",
  "Git discipline",
  "AI collaboration",
  "Communication",
  "Deployment judgment",
  "Ownership",
] as const;

export type Competency = (typeof COMPETENCIES)[number];

export interface Lesson {
  id: string;
  level: string;
  title: string;
  summary: string;
}

export interface Exam {
  id: string;
  lessonId: string;
  title: string;
  ticket: string;
  timeboxHours: number;
  summary: string;
  scenario: string;
  focusCompetencies: Competency[];
  steps: string[];
}

export const LESSONS: Lesson[] = [
  {
    id: "contributor",
    level: "Contributor",
    title: "Inherited bug fixes",
    summary:
      "Enter an unfamiliar codebase, reproduce a production bug from real logs, and ship a focused fix with regression coverage.",
  },
  {
    id: "maintainer",
    level: "Maintainer",
    title: "Features across modules",
    summary:
      "Extend behavior that spans services, legacy code, and a UI — without breaking the consumers you didn't write.",
  },
  {
    id: "owner",
    level: "Owner",
    title: "Database & architectural change",
    summary:
      "Design backwards-compatible migrations and schema changes that deploy safely ahead of the app.",
  },
  {
    id: "release",
    level: "Release engineer",
    title: "CI, deployment & rollback",
    summary:
      "Take a red pipeline to green, prove the seeded failure reproduces, and plan a safe rollout with a rollback path.",
  },
  {
    id: "oncall",
    level: "On-call engineer",
    title: "Incidents & recovery",
    summary:
      "Triage a live incident from logs and dashboards, stop the bleeding, then fix the root cause under a timebox.",
  },
];

export const EXAMS: Exam[] = [
  {
    id: "acme-1287",
    lessonId: "contributor",
    title: "Duplicate orders on retried checkout",
    ticket: "ACME-1287",
    timeboxHours: 4,
    summary:
      "Customers occasionally receive duplicate orders — and duplicate charges — when a checkout request is retried. Support says this was fixed last quarter. It wasn't.",
    scenario:
      "You inherit Acme Wholesale's order-management API (TypeScript/Node/Postgres, two replicas behind a load balancer). The ticket includes production logs from a payment-provider latency incident. Investigate, reproduce, fix, and open a PR. Any AI tools you normally use are allowed — you'll defend the diff afterwards.",
    focusCompetencies: [
      "Root-cause analysis",
      "Testing",
      "Systems thinking",
      "Data safety",
      "Communication",
    ],
    steps: [
      "Read TICKET.md and the production log excerpts",
      "Reproduce the failure locally — the naive retry test won't do it",
      "Fix the root cause, not the symptom",
      "Add regression coverage that would have caught this",
      "Open a PR using the template; answer the open product question in it",
      "Defend your diff in an AI-led technical interview",
    ],
  },
  {
    id: "acme-legacy-api",
    lessonId: "maintainer",
    title: "Retire the legacy customer endpoints",
    ticket: "ACME-1310",
    timeboxHours: 6,
    summary:
      "Move the snake_case legacy endpoints to the modern service layer without breaking the admin dashboard that depends on the old response shape.",
    scenario:
      "The legacy query module predates the service pattern and still backs the customer and product routes. An internal dashboard depends on its exact response shape. Migrate the code without breaking either consumer, and coordinate the cutover in writing.",
    focusCompetencies: [
      "Codebase comprehension",
      "Implementation",
      "Systems thinking",
      "Communication",
    ],
    steps: [
      "Map every consumer of the legacy endpoints",
      "Design a compatibility strategy and write it down",
      "Migrate incrementally with tests at each step",
      "Open a PR explaining the rollout order",
    ],
  },
  {
    id: "acme-1490",
    lessonId: "maintainer",
    title: "The wrong merge resolution",
    ticket: "ACME-1490",
    timeboxHours: 2,
    summary:
      "Ops' duplicate-charge monitor flatlined the day the order-export release shipped, and a partner integration reported seeing another company's orders. Both trails lead back to one merge.",
    scenario:
      "A teammate merged the ACME-1454 order-export branch and resolved a gnarly conflict by taking one whole side of a file. CI stayed green and the export works. Audit the merge, determine what the resolution lost, repair it without losing the export, add the coverage that was missing, and explain why green CI never noticed.",
    focusCompetencies: [
      "Codebase comprehension",
      "Security",
      "Systems thinking",
      "Git discipline",
      "Communication",
      "Ownership",
    ],
    steps: [
      "Open the repo and map the branches around the ACME-1454 export merge",
      "Identify how the merge conflict was resolved",
      "Determine what behavior the resolution lost",
      "Repair the integration without losing the export feature",
      "Add tests that would have caught the loss",
      "Get CI green",
      "Explain in the PR why green CI failed to detect the loss",
      "Write the handoff: deploy order, verification, rollback",
      "Defend your repair in the AI-led technical interview",
    ],
  },
  {
    id: "acme-migration",
    lessonId: "owner",
    title: "Ship a zero-downtime schema change",
    ticket: "ACME-1342",
    timeboxHours: 6,
    summary:
      "Split a column under live traffic. Migrations run before the new app version deploys — your change must be compatible with the previous release.",
    scenario:
      "Production applies migrations ahead of the rolling deploy, so for a window the old code runs against the new schema. Design the expand/contract sequence, write the migrations, and prove the old release keeps working at every step.",
    focusCompetencies: ["Data safety", "Deployment judgment", "Systems thinking", "Testing"],
    steps: [
      "Write an expand/contract migration plan",
      "Implement the expand phase with backfill",
      "Prove backwards compatibility with the previous release's tests",
      "Document the contract phase and its rollback",
    ],
  },
  {
    id: "acme-ci",
    lessonId: "release",
    title: "Red to green: rescue the pipeline",
    ticket: "ACME-1355",
    timeboxHours: 3,
    summary:
      "CI is red, a teammate's change just landed upstream, and a release is due. Absorb the change, get to green honestly, and ship with a rollback plan.",
    scenario:
      "Mid-assessment, a simulated teammate merges a change that conflicts with yours. Rebase, reconcile the behavior, keep the mandatory red/green/recovery checks passing, and write the release notes — including how you'd roll it back.",
    focusCompetencies: ["Git discipline", "Deployment judgment", "AI collaboration", "Ownership"],
    steps: [
      "Diagnose why the pipeline is red",
      "Rebase onto the teammate's change and reconcile behavior",
      "Get to green without weakening the checks",
      "Write release notes with a rollback plan",
    ],
  },
  {
    id: "acme-incident",
    lessonId: "oncall",
    title: "Sev-2: checkout latency is climbing",
    ticket: "ACME-1401",
    timeboxHours: 2,
    summary:
      "You're on call. p99 checkout latency has tripled in the last hour and support tickets are arriving. Stabilize first, then find the cause.",
    scenario:
      "Structured logs and a metrics dashboard are your only windows into production. Mitigate the customer impact quickly, communicate status honestly, and only then chase the root cause.",
    focusCompetencies: ["Systems thinking", "Ownership", "Communication", "Root-cause analysis"],
    steps: [
      "Read the dashboards and form a hypothesis",
      "Apply a mitigation and verify it moved the metric",
      "Post honest status updates as you go",
      "Identify the root cause and file the follow-up fix",
    ],
  },
];

// ---------------------------------------------------------------------------
// Merchant-side demo data: the candidate pipeline.
// ---------------------------------------------------------------------------

export type CandidateStatus = "invited" | "in_progress" | "submitted" | "defense" | "reported";

export const STATUS_LABEL: Record<CandidateStatus, string> = {
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Submitted",
  defense: "In defense",
  reported: "Report ready",
};

// How far along the assessment pipeline each status is.
export const STATUS_PROGRESS: Record<CandidateStatus, number> = {
  invited: 0,
  in_progress: 40,
  submitted: 70,
  defense: 85,
  reported: 100,
};

export interface CompetencyRating {
  competency: Competency;
  rating: number; // 1-5
  evidence: string;
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  examId: string;
  status: CandidateStatus;
  invitedAt: string;
  updatedAt: string;
  ratings: CompetencyRating[]; // present once reported (or partially in defense)
}

export const CANDIDATES: Candidate[] = [
  {
    id: "cand-01",
    name: "Priya Raman",
    email: "priya.raman@example.com",
    examId: "acme-1287",
    status: "reported",
    invitedAt: "2026-07-06",
    updatedAt: "2026-07-12",
    ratings: [
      { competency: "Root-cause analysis", rating: 5, evidence: "Traced the duplicate charges to the in-memory idempotency cache and the post-capture write window before touching code." },
      { competency: "Implementation", rating: 4, evidence: "Database-backed key claim inside the checkout transaction; focused diff." },
      { competency: "Testing", rating: 4, evidence: "Added concurrent-retry and cross-replica regression tests; both fail on the baseline." },
      { competency: "Systems thinking", rating: 4, evidence: "Called out the two-replica topology unprompted in the PR." },
      { competency: "Data safety", rating: 4, evidence: "Additive migration, compatible with the previous release." },
      { competency: "AI collaboration", rating: 4, evidence: "Used AI to draft tests, then rewrote assertions after spotting a race in the generated version." },
      { competency: "Communication", rating: 5, evidence: "PR answered the integrator's open product question with explicit status-code semantics." },
      { competency: "Deployment judgment", rating: 3, evidence: "Mentioned staged rollout when prompted; no monitoring plan." },
    ],
  },
  {
    id: "cand-02",
    name: "Marcus Webb",
    email: "marcus.webb@example.com",
    examId: "acme-1287",
    status: "reported",
    invitedAt: "2026-07-06",
    updatedAt: "2026-07-11",
    ratings: [
      { competency: "Root-cause analysis", rating: 3, evidence: "Found the cache but attributed the bug to 'timing' without identifying the write-after-capture window." },
      { competency: "Implementation", rating: 3, evidence: "Fix works for the visible case; used an advisory lock held across the payment call." },
      { competency: "Testing", rating: 3, evidence: "Sequential retry covered; concurrency test added only after the hidden suite hint." },
      { competency: "Systems thinking", rating: 2, evidence: "Did not consider the second replica until the defense round." },
      { competency: "Data safety", rating: 4, evidence: "Migration was additive and reversible." },
      { competency: "AI collaboration", rating: 2, evidence: "Accepted a generated transaction helper he could not explain under questioning." },
      { competency: "Communication", rating: 4, evidence: "Clear PR narrative; honest about what he had not verified." },
      { competency: "Deployment judgment", rating: 3, evidence: "Basic rollback answer; no duplicate-charge monitoring." },
    ],
  },
  {
    id: "cand-03",
    name: "Sofia Alvarez",
    email: "sofia.alvarez@example.com",
    examId: "acme-1287",
    status: "defense",
    invitedAt: "2026-07-08",
    updatedAt: "2026-07-15",
    ratings: [
      { competency: "Root-cause analysis", rating: 4, evidence: "Reproduced the race with a scripted concurrent harness on day one." },
      { competency: "Implementation", rating: 4, evidence: "Unique-constraint claim; clean error semantics." },
      { competency: "Testing", rating: 4, evidence: "Concurrency and restart cases covered before submission." },
    ],
  },
  {
    id: "cand-04",
    name: "Dan Kowalski",
    email: "dan.kowalski@example.com",
    examId: "acme-1287",
    status: "submitted",
    invitedAt: "2026-07-10",
    updatedAt: "2026-07-16",
    ratings: [],
  },
  {
    id: "cand-05",
    name: "Aisha Bello",
    email: "aisha.bello@example.com",
    examId: "acme-ci",
    status: "in_progress",
    invitedAt: "2026-07-13",
    updatedAt: "2026-07-17",
    ratings: [],
  },
  {
    id: "cand-06",
    name: "Tom Nguyen",
    email: "tom.nguyen@example.com",
    examId: "acme-1287",
    status: "in_progress",
    invitedAt: "2026-07-14",
    updatedAt: "2026-07-16",
    ratings: [],
  },
  {
    id: "cand-07",
    name: "Elena Petrova",
    email: "elena.petrova@example.com",
    examId: "acme-legacy-api",
    status: "invited",
    invitedAt: "2026-07-15",
    updatedAt: "2026-07-15",
    ratings: [],
  },
  {
    id: "cand-08",
    name: "Jordan Lee",
    email: "jordan.lee@example.com",
    examId: "acme-1287",
    status: "invited",
    invitedAt: "2026-07-16",
    updatedAt: "2026-07-16",
    ratings: [],
  },
  {
    id: "cand-09",
    name: "Noah Fischer",
    email: "noah.fischer@example.com",
    examId: "acme-1490",
    status: "reported",
    invitedAt: "2026-07-18",
    updatedAt: "2026-07-21",
    ratings: [
      { competency: "Codebase comprehension", rating: 4, evidence: "Diffed the merge against its main parent and found the deleted hunks within twenty minutes." },
      { competency: "Root-cause analysis", rating: 4, evidence: "Named the whole-file resolution as the cause, the symptoms as consequences." },
      { competency: "Security", rating: 4, evidence: "Strong tenant-isolation analysis in the PR — but the restored guard module was never wired into the listing route, so the cross-customer listing remains open." },
      { competency: "Systems thinking", rating: 4, evidence: "Reconstructed the monitor-flatline failure mode and restored the checkout log line with all fields." },
      { competency: "Git discipline", rating: 4, evidence: "Forward-fixed on a clean branch; export preserved; teammate commits untouched." },
      { competency: "Testing", rating: 3, evidence: "Log-field and flag tests fail on baseline and pass on the branch; no test covers the listing guard." },
      { competency: "Communication", rating: 4, evidence: "PR explains the coverage gap that kept CI green and proposes the missing tests." },
      { competency: "Ownership", rating: 3, evidence: "Found the unreported flag deletion unprompted; did not notice the listing guard was still unwired." },
    ],
  },
  {
    id: "cand-10",
    name: "Grace Osei",
    email: "grace.osei@example.com",
    examId: "acme-1490",
    status: "reported",
    invitedAt: "2026-07-18",
    updatedAt: "2026-07-21",
    ratings: [
      { competency: "Codebase comprehension", rating: 5, evidence: "Used git show --cc on the merge, then grepped for importers of the orphaned modules to confirm all three losses." },
      { competency: "Root-cause analysis", rating: 5, evidence: "Identified the accept-incoming resolution and explained why each parallel mainline change vanished." },
      { competency: "Security", rating: 5, evidence: "Restored and verified the listing guard; flagged the export endpoint's unguarded bulk read unprompted and raised it as a product question." },
      { competency: "Systems thinking", rating: 4, evidence: "Restored the monitor line and the flag semantics; explained the pilot-customer impact of the dead flag." },
      { competency: "Git discipline", rating: 5, evidence: "Re-merged with a correct resolution, preserving the export and every teammate commit; history reads cleanly." },
      { competency: "Testing", rating: 4, evidence: "All three restorations covered by tests that fail on the baseline; log capture designed deliberately." },
      { competency: "Communication", rating: 5, evidence: "The why-green section is teachable: coverage gap plus whole-file resolution, with a prevention proposal." },
      { competency: "Ownership", rating: 5, evidence: "Found all three losses including the unreported one, plus the export's access-control posture." },
    ],
  },
];

// Automated verification: the baseline-check verdict on the candidate's tests
// plus the sanitized hidden-suite summary. Additive export — page components
// read it by candidate id; absent means verification hasn't run yet.
export type BaselineVerdict = "genuine-regression-test" | "test-theater" | "no-regression-test";

export interface VerificationResult {
  baselineVerdict: BaselineVerdict;
  checks: Array<{ id: string; result: "pass" | "fail" }>;
}

export const VERIFICATIONS: Record<string, VerificationResult> = {
  "cand-01": {
    baselineVerdict: "genuine-regression-test",
    checks: [
      { id: "concurrent_same_key_retry", result: "pass" },
      { id: "cross_replica_dedup", result: "pass" },
      { id: "reused_key_distinct_checkout", result: "pass" },
      { id: "no_key_checkout", result: "pass" },
      { id: "unrelated_regression", result: "pass" },
    ],
  },
  "cand-02": {
    baselineVerdict: "genuine-regression-test",
    checks: [
      { id: "concurrent_same_key_retry", result: "pass" },
      { id: "cross_replica_dedup", result: "fail" },
      { id: "reused_key_distinct_checkout", result: "pass" },
      { id: "no_key_checkout", result: "pass" },
      { id: "unrelated_regression", result: "pass" },
    ],
  },
  "cand-03": {
    baselineVerdict: "genuine-regression-test",
    checks: [
      { id: "concurrent_same_key_retry", result: "pass" },
      { id: "cross_replica_dedup", result: "pass" },
      { id: "reused_key_distinct_checkout", result: "pass" },
      { id: "no_key_checkout", result: "pass" },
      { id: "unrelated_regression", result: "pass" },
    ],
  },
  "cand-09": {
    baselineVerdict: "genuine-regression-test",
    checks: [
      { id: "authz_check_present", result: "fail" },
      { id: "structured_logging_present", result: "pass" },
      { id: "feature_flag_guard_present", result: "pass" },
      { id: "order_export_intact", result: "pass" },
      { id: "unrelated_regression", result: "pass" },
    ],
  },
  "cand-10": {
    baselineVerdict: "genuine-regression-test",
    checks: [
      { id: "authz_check_present", result: "pass" },
      { id: "structured_logging_present", result: "pass" },
      { id: "feature_flag_guard_present", result: "pass" },
      { id: "order_export_intact", result: "pass" },
      { id: "unrelated_regression", result: "pass" },
    ],
  },
};

// ---------------------------------------------------------------------------
// Team, billing, compare, and examinee-result demo data (mockups 1g-1l).
// ---------------------------------------------------------------------------

export type TeamRole = "Owner" | "Reviewer" | "Viewer";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: TeamRole;
  lastActive: string;
  reviews: number | null;
  isYou?: boolean;
}

export const TEAM: TeamMember[] = [
  { id: "tm-1", name: "Dana Kim", email: "dana.kim@acme.com", role: "Owner", lastActive: "Just now", reviews: 18, isYou: true },
  { id: "tm-2", name: "Raj Mehta", email: "raj.mehta@acme.com", role: "Reviewer", lastActive: "2h ago", reviews: 31 },
  { id: "tm-3", name: "Lena Graff", email: "lena.graff@acme.com", role: "Reviewer", lastActive: "Yesterday", reviews: 12 },
  { id: "tm-4", name: "Theo Owens", email: "theo.owens@acme.com", role: "Viewer", lastActive: "3d ago", reviews: null },
];

export const PENDING_TEAM_INVITES = [
  { email: "sam.ortiz@acme.com", role: "Reviewer" as TeamRole, invited: "2 days ago" },
];

export const BILLING = {
  plan: "Team",
  priceMonthly: 499,
  renews: "Aug 6, 2026",
  included: { assessments: 50, seats: 5, overage: "$12 / assessment" },
  usage: { assessments: 8, seats: 4, cycle: "Jul 6 – Aug 6" },
  invoices: [
    { date: "Jul 6, 2026", id: "INV-2026-07", amount: "$499.00", status: "Paid" },
    { date: "Jun 6, 2026", id: "INV-2026-06", amount: "$499.00", status: "Paid" },
    { date: "May 6, 2026", id: "INV-2026-05", amount: "$511.00", status: "Paid" },
  ],
  card: { brand: "VISA", last4: "4242", expires: "08 / 28" },
  upsell: {
    plan: "Scale",
    priceMonthly: 1499,
    pitch: "Unlimited assessments, 20 seats, SSO, and a custom simulation library.",
  },
};

export type Recommendation = "Advance" | "In review" | "Hold";

// Compare view: candidate ids side by side with the reviewer recommendation.
export const COMPARE: Array<{ candidateId: string; recommendation: Recommendation }> = [
  { candidateId: "cand-01", recommendation: "Advance" },
  { candidateId: "cand-03", recommendation: "In review" },
  { candidateId: "cand-02", recommendation: "Hold" },
];

// The examinee's own released result (demo: Priya's ACME-1287 profile).
export const EXAMINEE_RESULTS: Record<
  string,
  { candidateId: string; growthEdgeTrack: string }
> = {
  "acme-1287": { candidateId: "cand-01", growthEdgeTrack: "Release engineer" },
};

// Mission-control verification mode per exam step (mvp-architecture
// Principle 2). Additive: exams without an entry fall back to the page's
// keyword heuristic. "auto" = live-automated (a check that ticks);
// "review" = submitted-pending-review.
export type StepMode = "auto" | "review";

export const EXAM_STEP_MODES: Record<string, StepMode[]> = {
  "acme-1490": [
    "auto", // repo opened / branch pushed — deterministic GitHub events
    "review", // identifying the resolution is a judgment artifact
    "review", // the lost-behavior determination is a judgment artifact
    "auto", // repair presence is live-automated; quality via review
    "auto", // candidate's tests present + red/green baseline check
    "auto", // required checks green
    "review", // the why-green explanation is judged by a human
    "review", // handoff completeness is judged by a human
    "review", // the defense
  ],
};

// Scenario rubric gates: a competency's rating is capped unless every listed
// hidden check passed — a repair that leaves a behavior deleted cannot score
// high on preserving it, no matter how good the writeup. Additive export;
// exams without gates are unaffected.
export interface RubricGate {
  competency: Competency;
  cap: number;
  requires: string[]; // hidden-suite check ids that must all pass
}

export const RUBRIC_GATES: Record<string, RubricGate[]> = {
  "acme-1490": [
    { competency: "Security", cap: 2, requires: ["authz_check_present"] },
    { competency: "Systems thinking", cap: 2, requires: ["structured_logging_present"] },
    {
      competency: "Git discipline",
      cap: 2,
      requires: ["feature_flag_guard_present", "order_export_intact"],
    },
  ],
};

// Live pilot repositories (Phase 0), keyed by exam id. Additive: exams
// without an entry render no repo link. These are private repos under the
// CodeWorthy GitHub account — the links resolve only for signed-in owners.
export const PILOT_REPOS: Record<string, string> = {
  "acme-1287": "https://github.com/CodeWorthy-ai/cw-pilot-1287-01",
  "acme-1490": "https://github.com/CodeWorthy-ai/cw-pilot-1490-01",
};

export function examById(id: string): Exam | undefined {
  return EXAMS.find((e) => e.id === id);
}

export function candidateById(id: string): Candidate | undefined {
  return CANDIDATES.find((c) => c.id === id);
}

export function averageRating(c: Candidate): number | null {
  if (c.ratings.length === 0) return null;
  return c.ratings.reduce((sum, r) => sum + r.rating, 0) / c.ratings.length;
}

// ---------------------------------------------------------------------------
// Examinee-side progress, persisted locally per browser.
// ---------------------------------------------------------------------------

export type ExamProgress = "not_started" | "in_progress" | "submitted";

const PROGRESS_KEY = "codeworthy.examProgress";

export function readProgress(): Record<string, ExamProgress> {
  try {
    return JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function writeProgress(examId: string, progress: ExamProgress): Record<string, ExamProgress> {
  const all = { ...readProgress(), [examId]: progress };
  localStorage.setItem(PROGRESS_KEY, JSON.stringify(all));
  return all;
}
