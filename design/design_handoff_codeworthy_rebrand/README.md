# Handoff: Codeworthy rebrand — landing, repo dashboard, sign in

## Overview

A full visual rebrand of the Codeworthy marketing site and the Steward repo dashboard, plus a repositioning: **the landing page now leads with the repo guard**, and the hiring/assessment product is a single secondary band near the bottom.

Three screens are covered:

1. **Landing** (`site/src/pages/Landing.tsx`)
2. **Repo dashboard** (`site/src/pages/steward/RepoDashboard.tsx`)
3. **Sign in** (`site/src/pages/Login.tsx`)

The other merchant/examinee screens (`Dashboard`, `CandidatePage`, `Compare`, `Invite`, `Team`, `Billing`, `Settings`, `Learn`, `ExamPage`, `Result`) are **not** redesigned here. They will inherit the new tokens automatically if you replace the `:root` block in `site/src/styles.css` (see *Migration*), but their layouts were not revisited.

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing intended look and behavior, not production code to copy directly. Your job is to **recreate them inside the existing `site/` app**: React 18 + Vite + `react-router-dom`, with a single global `site/src/styles.css` driven by CSS custom properties. Keep that architecture. Do not introduce Tailwind, CSS-in-JS, or a component library — the codebase's pattern is semantic class names + tokens, and the redesign was authored to fit it.

The prototypes use inline styles because of the tool they were made in. **Do not port the inline styles.** Translate every value into the existing class-based CSS in `styles.css`, using the tokens below.

## Fidelity

**High-fidelity.** Colors, typography, spacing, and radii below are final. Recreate pixel-perfectly. Where the prototype shows static text in place of an input or a button, that is a live control in the real app — the prototype just can't render focus states.

---

## Design tokens

Replace the `:root` block at the top of `site/src/styles.css` with this. Names are kept from the existing file wherever possible so most rules keep working unchanged; new names are marked NEW.

```css
:root {
  color-scheme: light;

  /* surfaces — light */
  --page:        #ffffff;
  --surface:     #f2f4f6;   /* was #f7f9fa */
  --surface-2:   #e8ecef;   /* was #eef2f4 */
  --sand:        #efe9df;   /* NEW — warm editorial band */
  --sand-ink:    #1f1a14;   /* NEW — text on sand */
  --sand-ink-2:  #6b6053;   /* NEW — body text on sand */
  --sand-eyebrow:#96826a;   /* NEW */

  /* surfaces — dark (used by the dashboard and dark landing bands) */
  --ink-900:     #0b1621;   /* NEW — dark page */
  --ink-800:     #101f2c;   /* NEW — dark card */
  --ink-700:     #16283a;   /* NEW — elevated */
  --line-dark:   #1b3040;   /* NEW — hairline on dark */
  --border-dark: #22384c;   /* NEW — border on dark */

  /* text */
  --ink:         #0d1b2a;
  --ink-2:       #46607a;
  --ink-muted:   #6b839a;
  --ink-faint:   #94a7b8;
  --on-dark:     #ffffff;   /* NEW */
  --on-dark-2:   #cfe0e8;   /* NEW — primary body on dark */
  --on-dark-3:   #a3b8c8;   /* NEW — secondary body on dark */
  --on-dark-4:   #8fa8bb;   /* NEW — labels on dark */
  --on-dark-5:   #6f8798;   /* NEW — meta on dark */
  --on-dark-6:   #5d7488;   /* NEW — faintest on dark */

  /* brand + status */
  --signal:      #4cc9c0;   /* teal — primary accent, ON DARK ONLY */
  --signal-deep: #0f8b82;   /* teal for text/links on light (AA on white) */
  --signal-press:#0b6f68;   /* NEW — hover/active on light */
  --signal-ink:  #06232a;   /* NEW — text on a --signal fill */
  --signal-wash: #e6f6f4;   /* NEW — light tint */
  --signal-line: #b9e6e1;   /* NEW — light tint border */

  --watch:       #e8b04b;   /* amber */
  --watch-ink:   #9a6d10;   /* amber text on light */
  --watch-wash:  #fdf4e2;
  --watch-line:  #f0dcb0;

  --risk:        #e07a5f;   /* coral */
  --risk-ink:    #b04e33;   /* coral text on light */
  --risk-wash:   #fdefea;
  --risk-line:   #f3cec2;

  --unknown:     #94a7b8;

  /* lines */
  --hairline:    #e3e8ec;
  --border:      #d3dbe2;
  --focus:       #0f8b82;

  --radius:      14px;
  --radius-sm:   9px;
  --radius-xs:   6px;

  --sans: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  --mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

### Removed tokens

`--accent`, `--accent-strong`, `--accent-bright`, `--accent-soft`, `--accent-wash`, `--accent-line`, `--highlight`, `--navy*`, `--brand-blue`, `--rating-strong/develop/needs/none`, `--amber-bright` are all retired. Map them:

| Old | New |
|---|---|
| `--accent` / `--accent-bright` | `--signal` |
| `--accent-strong` | `--signal-deep` |
| `--accent-soft` / `--accent-wash` | `--signal-wash` |
| `--accent-line` | `--signal-line` |
| `--navy` / `--navy-2` | `--ink-900` / `--ink-800` |
| `--navy-border` | `--border-dark` |
| `--navy-ink-2` / `--navy-muted` | `--on-dark-3` / `--on-dark-5` |
| `--rating-strong` | `--signal` |
| `--rating-develop` / `--amber-bright` | `--watch` |
| `--rating-needs` | `--risk` |
| `--rating-none` | `--unknown` |
| `--highlight` (hero underline) | deleted — see *Landing hero* |

### Color rules (important)

- **`--signal` (#4CC9C0) never appears as text or a border on white.** It fails contrast. On light surfaces use `--signal-deep` (#0F8B82) for text and links, and `--ink` (#0D1B2A) for primary buttons.
- **Primary buttons are teal on dark, ink on light.** Dark: `background: var(--signal); color: var(--signal-ink)`. Light: `background: var(--ink); color: #fff`.
- Status color is never the only signal — the mono status word (`HEALTHY` / `WATCH` / `AT RISK` / `VERIFIED`) always sits next to the dot.

## Typography

Unchanged families: Inter + JetBrains Mono, loaded from Google Fonts in `site/index.html` (weights 400/500/600/700/800 and 400/500/600/700). No change to that link tag.

The rule that governs everything: **mono is only ever used for things the system actually measured or emitted** — event type ids, repo full names, branch names, file paths, counts, timestamps, status words, section eyebrows, step numbers. Never for prose. Inter carries all voice.

| Role | Value |
|---|---|
| Hero H1 | `800 68px/1.02 var(--sans)`, `letter-spacing: -0.04em` |
| Section H2 | `700 40px var(--sans)`, `-0.03em` |
| Dark-band H2 | `700 38px/1.15 var(--sans)`, `-0.03em` |
| Final-CTA H2 | `800 44px var(--sans)`, `-0.035em` |
| Card H3 | `700 21px var(--sans)`, `-0.02em` |
| Step title | `700 17px/1.3 var(--sans)` |
| Hero body | `400 19px/1.6 var(--sans)` |
| Section body | `400 17px/1.6 var(--sans)` |
| Card body | `400 15px/1.65 var(--sans)` |
| Small body | `400 14px/1.6 var(--sans)` |
| Eyebrow | `700 11px var(--mono)`, `letter-spacing: .18em`, uppercase |
| Label / section head | `600 10px var(--mono)`, `.16em`, uppercase |
| Status word | `600 11px var(--mono)`, `.08em`, uppercase |
| Event id chip | `600 11px var(--mono)` |
| Big number | `700 30px var(--mono)`, `line-height: 1` |
| Repo title (dashboard) | `700 30px var(--mono)`, `-0.03em` |
| Wordmark | `800 20px var(--sans)`, `-0.035em` |

Add `text-wrap: pretty` to hero and section body paragraphs.

## Wordmark

Changed from `CodeWorthy` to **`Codeworthy.`** — lowercase w, trailing period.

```jsx
// site/src/components/Wordmark.tsx
export function Wordmark({ size = 20, onDark = false }: { size?: number; onDark?: boolean }) {
  return (
    <span className={"wordmark" + (onDark ? " on-dark" : "")} style={{ fontSize: size }}>
      Code<span className="worthy">worthy</span><span className="dot">.</span>
    </span>
  );
}
```

```css
.wordmark { font-weight: 800; letter-spacing: -0.035em; color: var(--ink); }
.wordmark .worthy { color: var(--signal-deep); }
.wordmark .dot    { color: var(--signal-deep); }
.wordmark.on-dark { color: #fff; }
.wordmark.on-dark .worthy,
.wordmark.on-dark .dot { color: var(--signal); }
```

`site/public/wordmark.svg` and `site/public/favicon.svg` both need regenerating with the new colors — the SVGs currently hardcode `#082F3C` and `#22C55E`. Replace with `#0D1B2A` and `#0F8B82`, and update the wordmark text to `Codeworthy.`.

---

## The vitals meter (replaces the ring)

This is the most significant component change. **Delete `components/Ring.tsx` and the `.health-ring*` CSS.** The conic-gradient ring encoded "% of vitals healthy" as an arc, which is unreadable at a glance, misleads as a score, and breaks down at small sizes.

Replacement: a **segmented meter** — one bar per vital, colored by that vital's status — under a large verdict word.

```jsx
const STATUS_COLOR = {
  healthy:   "var(--signal)",
  watch:     "var(--watch)",
  "at risk": "var(--risk)",
  unknown:   "var(--unknown)",
};

function VitalsMeter({ vitals }) {
  return (
    <div className="vitals-meter" role="img"
         aria-label={vitals.map(v => `${v.label}: ${v.status}`).join(", ")}>
      {vitals.map(v => (
        <span key={v.id} style={{ background: STATUS_COLOR[v.status] }} />
      ))}
    </div>
  );
}
```

```css
.vitals-meter { display: flex; gap: 5px; }
.vitals-meter > span { flex: 1; height: 6px; border-radius: 3px; }
/* compact variant, used in the landing hero card and login panel */
.vitals-meter.sm { gap: 4px; }
.vitals-meter.sm > span { height: 5px; }
```

The verdict word above it takes the color of the overall status:

```css
.health-verdict {
  font: 800 32px var(--sans);
  letter-spacing: -0.03em;
  line-height: 1.1;
}
/* color set inline from STATUS_COLOR[overall] */
```

Sub-line under the verdict, always: `"1 of 4 vitals needs a look · 2 changes flagged"` at `500 13px var(--sans)` / `--on-dark-4`.

The `overall` → color mapping is unchanged from `OVERALL_STATUS` in `RepoDashboard.tsx`: `Healthy → healthy`, `Needs attention → watch`, `At risk → at risk`.

---

## Screen 1 — Landing

Full width; content column `max-width: 1120px; margin: 0 auto; padding: 0 32px`. The page is a stack of full-bleed bands with alternating surfaces. **Band rhythm: dark → sand → paper → dark → paper → dark.** This rhythm is the point of the redesign; don't flatten it back to all-white.

### Nav (dark, not sticky-transparent)

`background: var(--ink-900)`, `min-height: 68px`, `border-bottom: 1px solid rgba(255,255,255,.07)`, flex, `gap: 28px`.

- Wordmark (on-dark), then three links — **How it works**, **What it catches**, **For hiring teams** — at `500 13.5px var(--sans)` / `--on-dark-4`, hover `#fff`.
- Right group (`margin-left: auto`, `gap: 18px`): "Sign in" text link, then primary button **Protect my repo** — `background: var(--signal)`, `color: var(--signal-ink)`, `padding: 10px 20px`, `radius: 8px`, `600 14px`.

### Hero band (`--ink-900`)

`padding: 96px 32px 104px`; grid `1.05fr .95fr`, `gap: 72px`, `align-items: center`.

**Left:**
- Eyebrow pill: inline-flex, `gap: 9px`, 6px teal dot, text `600 11px var(--mono)` `.16em` uppercase `--signal`, `border: 1px solid rgba(76,201,192,.3)`, `radius: 999px`, `padding: 6px 14px`, `margin-bottom: 28px`. Copy: **A senior engineer for your repo**
- H1, `margin: 0 0 24px`, three lines with `<br>`; third line in `--signal`:
  > Build at AI speed.<br>Land like a<br>**senior engineer.**
- Body, `max-width: 480px`, `margin: 0 0 36px`, `--on-dark-3`. `main` inline as mono/`--on-dark-2`:
  > Codeworthy watches the repository the way a tech lead would — it protects `main`, reads every change before it lands, and writes down what happened in plain English. It never merges. You still own that.
- CTAs, `gap: 12px`: primary **Protect my repo — free** (`--signal` fill, `--signal-ink` text, `15px 28px`, `radius 10px`, `600 16px`); secondary **See a live report →** (`border: 1px solid rgba(255,255,255,.18)`, `--on-dark-2`, same padding).
- Trust row, `margin-top: 40px`, `gap: 24px`, `500 12px var(--mono)` / `--on-dark-5`, `·` separators in `#3d5567`: `read-only + comment` · `never merges` · `hash-chained log`

**Note:** the old `.hero-worthy .underline` highlight-marker effect is deleted. So is `--highlight`.

**Right — the health instrument card:**
`background: var(--ink-800)`, `border: 1px solid var(--border-dark)`, `radius: 16px`, `overflow: hidden`.
- Header strip: `padding: 16px 22px`, `border-bottom: 1px solid var(--border-dark)`, flex space-between. Left: repo full name, `600 13px var(--mono)` / `--on-dark-2`. Right: `LAST 30 DAYS`, `600 10px var(--mono)` `.1em` uppercase / `--on-dark-5`.
- Body `padding: 26px 22px 22px`:
  - Label `REPO HEALTH`, then `.health-verdict` (**Needs attention**, `--watch`), then `.vitals-meter.sm` with `margin: 14px 0 26px`.
  - Four vital rows: `display: flex; gap: 12px; padding: 12px 0; border-top: 1px solid var(--line-dark)`. 7px status dot / label (`500 13px`, `--on-dark-2`, `flex: 1`) / status word (`600 11px var(--mono)`, `.06em`, status color).
  - Prescription callout: `margin-top: 20px`, `padding: 14px 16px`, `radius: 10px`, `background: rgba(232,176,75,.08)`, `border: 1px solid rgba(232,176,75,.25)`. Title `600 13px` `#f0d3a0`; body `500 12px/1.5` `--on-dark-3`.
- Footer strip: `padding: 13px 22px`, `border-top: 1px solid var(--border-dark)`, `500 11px var(--mono)` / `--on-dark-6`: `418 records · append-only · chain verified 07 Aug`

### "How it works" band (`--sand`, `padding: 88px 32px`)

Eyebrow `--sand-eyebrow`; H2 `--sand-ink`, `max-width: 720px`; deck `400 17px/1.6` `--sand-ink-2`, `max-width: 560px`, `margin-bottom: 56px`.

> **Set it up on a Tuesday. Forget it by Thursday.**
> No dashboard to babysit, no rules to write. Four steps, once.

Then a 4-column grid, `gap: 36px`. Each cell: `border-top: 2px solid var(--sand-ink)`, `padding-top: 20px`; number `700 12px var(--mono)` `.1em` `--signal-deep`, `margin-bottom: 14px`; title; body `--sand-ink-2`.

The old markup put 4 steps in a `repeat(6, 1fr)` grid with vertical dividers, leaving two empty columns and a ragged right edge. Use `repeat(4, 1fr)` with top rules.

Copy: **01 Install on your repo** / One click. It asks to read your code and comment — never to write it or merge. — **02 It protects main** / Changes go through a reviewable pull request. Force-pushes and deletions stop being possible. — **03 It reads every change** / Secrets, committed .env files, destructive migrations — caught before they merge, explained in plain language. — **04 You get one email a week** / What happened, what needs a look, and nothing to check in between.

### "What it catches" band (`--surface`, `padding: 88px 32px`)

H2 `max-width: 760px`, `margin-bottom: 56px`: **The four things that quietly wreck a young codebase**

2×2 grid, `gap: 20px`. Card: `background: var(--page)`, `border: 1px solid var(--hairline)`, `radius: 14px`, `padding: 30px 32px`. Each has a mono kicker (`600 11px`, `.1em`, uppercase) above the H3 — this is new and does the categorizing work:

| Kicker | Color | H3 |
|---|---|---|
| UNGUARDED MAIN | `--signal-deep` | Guards your default branch |
| LEAKED CREDENTIALS | `--risk-ink` | Blocks what breaks repos |
| BLACK-BOX TOOLING | `--signal-deep` | Explains every call it makes |
| AUDIT SEASON | `--signal-deep` | Keeps tamper-evident records |

Body copy is carried over from `DOES` in `Landing.tsx`, lightly tightened — see the prototype for exact strings.

### "The one rule" band (`--ink-900`, `padding: 80px 32px`)

Grid `.9fr 1.1fr`, `gap: 64px`, `align-items: center`. Left: eyebrow `--signal`, then H2 in two lines — **It advises.<br>You merge.** Right: body `400 17px/1.65` `--on-dark-3` (the "never merges / off by default" paragraph, with `off by default` as `<strong>` in `#fff`, weight 600), then a chip row, `gap: 10px`: `no write access` · `no history rewrites` · `opt-in AI review` · `every action reversible`. Chip: `600 11px var(--mono)`, `--on-dark-2`, `background: rgba(255,255,255,.06)`, `border: 1px solid var(--border-dark)`, `padding: 7px 13px`, `radius: 7px`.

### Hiring band (`--surface`, `padding: 72px 32px`)

One horizontal card — this is the entire hiring product's presence on the landing page. `background: var(--page)`, `border: 1px solid var(--hairline)`, `radius: 14px`, `padding: 32px 36px`, flex, `gap: 40px`, `align-items: center`.

Eyebrow **ALSO — FOR HIRING TEAMS**; H3 `700 24px` `-0.025em`: **The same engine that guards repos measures engineers**; body `max-width: 640px`. Right: outline button **See the assessment →** (`border: 1px solid var(--border)`, `--ink`, `13px 24px`, `radius 9px`) → routes to `/login?role=merchant`.

### Final CTA + footer (`--ink-900`, `padding: 84px 32px 40px`)

Centered. H2 with `main` in mono `--signal` at `.82em`: **Hand `main` to a senior engineer**. Deck `400 17px` `--on-dark-3`. Primary teal button **Protect my repo — free** (`15px 30px`).

Footer: `border-top: 1px solid var(--line-dark)`, `margin-top: 64px`, `padding-top: 26px`, flex space-between — wordmark (on-dark, 15px) and `500 12px var(--mono)` `--on-dark-6`: `© 2026 · make your work production-worthy`.

---

## Screen 2 — Repo dashboard

**The whole page is dark now** (`--ink-900`), not a light shell with a dark exception. `.shell-dark` as a scoped token remap goes away for this route; the dashboard owns its surface.

Full-bleed — remove the old `max-width: 1080px` centering on `.repo-dash`. Grid: `280px 1fr` (rail widened from 260).

### Top bar
`padding: 16px 28px`, `border-bottom: 1px solid var(--line-dark)`, space-between.
- Left, `gap: 26px`: wordmark (on-dark, 18px) + the doctrine pill, moved here from the repo header so it reads as a product-level promise: `advisory · you own every merge`, `600 12px var(--mono)`, `.06em`, uppercase, `--signal`, `border: 1px solid rgba(76,201,192,.28)`, `radius: 999px`, `padding: 4px 12px`.
- Right, `gap: 16px`: `@login` in `600 13px var(--mono)` `--on-dark-4`; 30px round avatar (`background: var(--border-dark)`, initials `700 11px`, `--on-dark-2`); Sign out button (`border: 1px solid var(--border-dark)`, `radius 8px`, `7px 13px`, `600 12px`, `--on-dark-4`).

### Rail
`border-right: 1px solid var(--line-dark)`, `padding: 26px 18px`, flex column, `gap: 8px`.
- Head `REPOSITORIES`, `600 10px var(--mono)`, `.16em`, `--on-dark-6`, `padding: 0 10px 6px`.
- Filter input: `border: 1px solid var(--border-dark)`, `radius 9px`, `9px 12px`, `500 13px`, placeholder `--on-dark-6`. Keep the existing "only show when > 6 repos" rule.
- Account group header: `600 11px`, `--on-dark-5`, with 16px avatar at `radius 4px`.
- Repo item: `display:flex; gap:10px; padding:11px 12px; radius:9px`. **New:** a 6px status dot at the left, colored by that repo's overall health — this is what lets you scan a problem repo without opening it. Name `flex: 1`, ellipsized. Right slot: flagged-count badge (`background: var(--risk)`, `color: #2a0f08`, `700 11px var(--mono)`, `radius 6px`, `min-width 20px`, `height 20px`) or, if zero, a `private` chip (`600 9px var(--mono)`, uppercase, `.06em`, `--on-dark-6`, `border: 1px solid var(--border-dark)`, `radius 5px`).
- Selected: `background: rgba(76,201,192,.1)`, `border: 1px solid rgba(76,201,192,.28)`, name `600` `#fff`.
- "＋ Add a repository" pinned to the bottom with `margin-top: auto`; `border: 1px dashed var(--border-dark)`.

### Main panel — `padding: 36px 40px 48px`

**Header:** eyebrow `REPOSITORY`; H1 = repo full name in `700 30px var(--mono)`, `-0.03em`, `#fff`. Right: the 7d/30d/90d window control (`border: 1px solid var(--border-dark)`, `radius 9px`, segments `600 12px var(--mono)`, `8px 14px`; selected = `--signal` fill / `--signal-ink` text) and a **Share summary ↗** outline button. The old two-piece open/copy `summary-link` collapses into one button with a copy action in a menu — or keep the split control if that's cheaper; it wasn't the problem.

**Health row:** grid `1fr 300px`, `gap: 20px`, `margin-bottom: 36px`.

*Left — health card:* `--ink-800`, `border: 1px solid var(--border-dark)`, `radius 14px`, `padding: 28px 30px`.
- Header: label `REPO HEALTH · 30 DAYS`, `.health-verdict`, sub-line; **Details** outline button top-right (`border: 1px solid var(--border-dark)`, `radius 9px`, `9px 16px`, `600 13px`, `--on-dark-2`). Alert count badge on the button when > 0, as today.
- `.vitals-meter`, `margin-bottom: 26px`.
- Vital rows: `display: grid; grid-template-columns: 14px 1fr auto; gap: 14px; align-items: start; padding: 16px 0; border-top: 1px solid var(--line-dark)`. Dot 8px, `margin-top: 6px`. Middle: label `600 14px` `#fff`; finding `400 13px/1.5` `--on-dark-4`, `margin-top: 3px`; **prescription inline** when the vital isn't healthy — `600 13px` `--signal`, `margin-top: 6px`, prefixed `→ `. Right: status word, `margin-top: 3px`.
- This inlining means the "What to look at" column of the old `HealthDetails` is now redundant. Keep `Details` for the **flagged-changes** list only, and relabel it.

*Right — stacked cards, `gap: 20px`:*
- "This window" counters card (`--ink-800`, `padding: 22px 24px`, `radius 14px`). Label, then three stats separated by `1px` `--line-dark` rules, `gap: 16px`. Number `700 30px var(--mono)`, `line-height: 1`; caption `500 12px` `--on-dark-4`. **14** merges to main (white) · **2** changes blocked (`--risk`) · **0** secrets reached main (`--signal`). Wire these from the existing `/health` and `/activity` payloads.
- Tamper-evidence card: `background: rgba(76,201,192,.08)`, `border: 1px solid rgba(76,201,192,.28)`, `radius 14px`, `padding: 20px 22px`. Title `600 13px` `--signal`; body `400 12.5px/1.55` `--on-dark-3`; **Export log ↓** action `600 12px` `--on-dark-2`, `margin-top: 12px`. The 🛡️/⚠️ emoji are gone.

**Change log:** header row — label `CHANGE LOG` left, `5 of 42 events` right (`500 12px` `--on-dark-5`).

Items: `display: grid; grid-template-columns: 20px 1fr; gap: 16px; padding: 20px 0; border-top: 1px solid var(--line-dark)`. Dot 10px, `margin-top: 5px`; **alert-tone dots get a halo** — `box-shadow: 0 0 0 4px rgba(224,122,95,.14)`.

Text `500 15px/1.55`; `#fff` for `watch` tone, `--on-dark-2` otherwise. Inline artifacts (paths, branch names) in mono at `.9em` / `--on-dark-2`.

Meta row, `gap: 12px`: the event-type chip is now **tone-colored** — `secret_blocked`/`risky_migration` get `color: var(--risk)`, `background: rgba(224,122,95,.12)`, `border: 1px solid rgba(224,122,95,.28)`; `ok`-tone events get `--signal` equivalents; neutral events get `--on-dark-4` on `rgba(255,255,255,.05)` / `--border-dark`. All at `600 11px var(--mono)`, `radius 6px`, `padding: 3px 8px`. Then actor `600 12px var(--mono)` `--on-dark-4`, then relative time `500 12px` `--on-dark-6`. Keep the existing `eventTone()` regex as the source of tone.

### Non-happy states
`Waking`, `RepoBlank`, `ActivityError` keep their logic and copy. Restyle onto dark: heading `700 18px` `#fff`, body `--on-dark-4`. The `repo-waking-pulse` dot becomes `--signal`.

---

## Screen 3 — Sign in

Slim dark top bar (`--ink-900`, `min-height: 68px`): wordmark left, **Back to site →** right.

Split, `grid-template-columns: 1.05fr .95fr`, `min-height: 660px`. The old `login-split` card treatment (rounded, bordered, floating in the page) is gone — the split now runs edge to edge.

**Left panel** (`--ink-900`, `padding: 64px 56px`, flex column, centered, `gap: 40px`):
- Eyebrow `YOUR REPOS, WATCHED`, `--signal`.
- H2 `800 40px/1.1`, `-0.035em`: **Sign in and see what landed while you were building.**
- Body `400 16px/1.65` `--on-dark-3`, `max-width: 400px`.
- Proof card (`--ink-800`, `border: 1px solid var(--border-dark)`, `radius 14px`, `padding: 20px 22px`): repo name + status word, `.vitals-meter.sm`, then `400 13px/1.55` `--on-dark-3` — `2 changes flagged in the last 30 days · 418 records verified`.

**The old proof card showed a candidate's 4.1 assessment score.** That's the wrong product for this page now — it's replaced with repo health.

**Right panel** (`--page`, `padding: 64px 56px`, centered column):
- H1 `800 30px`, `-0.03em`: **Sign in**. Deck `400 14px/1.6` `--ink-muted`: *GitHub is how Codeworthy connects to your repositories — there's nothing else to set up.*
- GitHub button, full width, `padding: 15px`, `background: var(--ink)`, `color: #fff`, `radius 10px`, `600 15px`, `gap: 10px`, existing 16×16 GitHub mark inline. Hover `#16283a`.
- Under it, `500 12px/1.5 var(--mono)` `--ink-faint`, centered: `read + comment scopes only · no write access` — this is new and does real conversion work.
- Divider `or explore the demo` (`flex: 1` 1px `--hairline` rules, `gap: 14px`, `500 12px` `--ink-faint`), `margin: 32px 0`.
- Role picker replaces the old segmented `.role-toggle`: two cards, `grid 1fr 1fr`, `gap: 10px`, `padding: 16px`, `radius 10px`. Selected: `background: var(--ink)`, `border: 1px solid var(--ink)`, title `600 14px` `#fff`, sub `400 12px` `--on-dark-4`. Unselected: `border: 1px solid var(--border)`, title `--ink`, sub `--ink-muted`. Copy: **Taking an assessment** / See the candidate view — **Hiring** / See the reviewer view.
- Fields: label `600 12px` `--ink-2`, `margin-bottom: 7px`; input `13px 14px`, `400 15px`, `border: 1px solid var(--border)`, `radius 9px`. Focus: `outline: 2px solid var(--focus); outline-offset: 0; border-color: transparent`.
- Submit is now **secondary**, not the page's primary action: `background: var(--surface-2)`, `color: var(--ink-2)`, `600 15px`, `padding: 14px`, `radius 10px`, label **Enter the demo**. Hover darkens to `#dfe4e8`.
- The old error paragraph (`--rating-needs`) becomes `--risk-ink` on `--risk-wash` with a `--risk-line` border, `radius 9px`, `10px 12px`.

---

## Interactions & behavior

Nothing in the data layer changes. `api.ts`, `auth.tsx`, `github-auth.tsx`, all `useEffect` fetches, `ApiError` handling, the `status` gate (`anon` → redirect, `loading`, `offline` → waking state), window-days refetching, rail flag counts, and the `HealthDetails` open/close state all stay exactly as they are.

Visual behavior:

- **Transitions:** `0.18s` on `background`, `border-color`, `color`. Buttons additionally `transform 0.18s`. Nothing longer than 200ms anywhere.
- **Primary button hover:** on dark, `background: #5fd6cd`; on light, `background: #16283a`. No lift, no glow — the old `box-shadow: 0 8px 20px -8px rgba(34,197,94,.6)` on green buttons is deleted. The new system has no colored glows.
- **Card hover** (landing "what it catches"): `border-color: var(--border)`. Nothing else.
- **Repo item hover:** `background: rgba(255,255,255,.04)`.
- **Change-log item hover:** `background: rgba(255,255,255,.02)`, full-bleed via negative margin + padding.
- **Focus-visible** everywhere: `outline: 2px solid var(--focus); outline-offset: 2px; border-radius: 4px`. On dark surfaces switch to `var(--signal)`.
- Keep `fadeUp` for the hero column and the hero card (`0.6s` / `0.7s .1s`). Delete `barIn` — no bars animate now. Wrap both in `@media (prefers-reduced-motion: reduce) { animation: none }`, which the current file is missing.

## Responsive

Breakpoints stay at 900px and 560px.

- **≤900px:** hero grid → 1 column, `padding: 56px 24px 64px`, H1 `clamp(38px, 8vw, 48px)`. Steps grid → 2 columns. "What it catches" → 1 column. "One rule" band → 1 column, `gap: 32px`. Hiring band → column, button full width. Login split → 1 column with the brand panel first, `padding: 40px 28px`.
- **≤720px** (dashboard): rail becomes a horizontal scroller above the main panel with `border-bottom` instead of `border-right`; health row → 1 column with the counters card becoming a 3-across row; main panel `padding: 24px 20px`.
- **≤560px:** steps → 1 column. Vital rows → `grid-template-columns: 14px 1fr` with the status word moving under the label. Change-log meta wraps.

## Accessibility

- `.vitals-meter` carries `role="img"` and an `aria-label` listing each vital and its status — the bars are decorative to a screen reader.
- The verdict word is real text, so it's read as-is. Don't replace it with an image or a pseudo-element.
- Every status color is paired with its mono word. Never ship a dot-only state.
- Contrast check the pairs you add: `--signal` on `--ink-900` passes; `--signal` on white does not. `--on-dark-5` (#6F8798) on `--ink-900` is ~4.6:1 — fine for meta text at 12px+, not for body copy.

## Assets

- **GitHub mark** — the existing inline 16×16 `<path>` in `Login.tsx`. Unchanged, reuse verbatim.
- **Wordmark / favicon SVGs** — `site/public/wordmark.svg`, `site/public/favicon.svg`. Both need recoloring and the wordmark needs its text changed to `Codeworthy.` (see *Wordmark*).
- **Emoji** — 🩺, 🛡️, ⚠️, ✓, ▲, ＋ are all removed. The `＋` in "Add a repository" is the one exception worth keeping; the rest were carrying meaning that now lives in color + mono labels.
- No new images, icons, or illustrations are introduced. There is nothing to source.

## Fonts

No change to `site/index.html` — the existing Google Fonts link already loads every weight used.

## Migration order (suggested)

1. Swap the `:root` block in `styles.css`; add the old→new alias mappings temporarily so nothing breaks while you work.
2. Update `Wordmark.tsx` + the two SVGs.
3. Build `VitalsMeter`; delete `Ring.tsx` and `.health-ring*`.
4. Rebuild `RepoDashboard.tsx` onto the dark shell.
5. Rebuild `Landing.tsx` band by band.
6. Rebuild `Login.tsx`.
7. Sweep the un-redesigned merchant/examinee screens for hardcoded `#22c55e` / `#082f3c` / `--accent*` / `--navy*` / `--rating-*` references and remove the temporary aliases.
8. Delete the aliases, `--highlight`, `barIn`, and the `.shell-dark` remap.

## Files in this bundle

- `CodeWorthy Redesign.dc.html` — the redesigned landing, repo dashboard, and sign-in, plus a palette/type reference block at the top. **This is the target.**
- `CodeWorthy Current.dc.html` — the current UI rebuilt from `Landing.tsx`, `RepoDashboard.tsx`, `Login.tsx`, and `styles.css`. Reference for diffing what changed.
- `tokens.css` — the `:root` block above, ready to paste.

Both HTML files open directly in a browser. They are design references — see *About the design files*.
