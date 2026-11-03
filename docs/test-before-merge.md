# Try It Before It Ships

*A plain-language plan for the next part of CodeWorthy. Written so that someone
who has never written code can read the whole thing and understand it.*

---

## The problem in one sentence

People who build apps with AI can make changes fast, but they have no easy way
to find out if a change broke something **before** it goes live.

## The idea in one sentence

CodeWorthy already keeps your work organized and stops risky changes from
reaching your live app. Now it will also **try every change for you**, in a safe
copy, and tell you in plain words what happened.

---

## A few words, explained once

You do not need to learn these. They are here so the rest of this page makes
sense.

| Word | What it means here |
|---|---|
| **Your live app** | The version of your app that real people use. In code it is called the `main` branch. |
| **A change** | A set of edits to your app. Usually the AI wrote them for you. |
| **A proposal** | A change that is waiting to go into your live app. In code it is called a pull request. CodeWorthy already turns every change into a proposal. |
| **Merge** | The moment a proposal goes into your live app. You click the button. CodeWorthy never clicks it for you. |
| **Checkup** | The health report CodeWorthy already shows you. It has a row of **vitals**, each green, yellow, or red. |
| **The record** | The permanent, tamper-proof diary CodeWorthy keeps of everything that happens to your app. |
| **A safe copy** | A throwaway copy of your app that runs somewhere private, with none of your passwords or keys. If it breaks, nothing real breaks. |

---

## What happens, step by step

This is the whole process from your point of view.

1. **You make a change.** You ask your AI tool to add a feature or fix a bug. It edits the code.
2. **CodeWorthy turns it into a proposal.** This already happens today. Your live app is untouched.
3. **CodeWorthy makes a safe copy of your app with the change in it.** The copy is private. It has no passwords, no keys, and no way to reach the internet. It is deleted when the check is done.
4. **CodeWorthy tries the change.** In the safe copy it asks four simple questions:
   - Does the app still install?
   - Does the app still build?
   - Does the app still start?
   - Do the checks that already existed still pass?
5. **If the change claims to fix a problem, CodeWorthy proves it.** It shows the problem happening in the old version, and not happening in the new one. We call this *red then green*. Red means the problem is there. Green means it is gone.
6. **You get one short paragraph.** Something like: *"Your app still starts. All 12 existing checks pass. Nothing checks the two files you changed, so I cannot promise those work. The bug you asked to fix is gone."*
7. **The checkup updates.** The test vital goes green, yellow, or red based on what just happened.
8. **You decide.** You read the paragraph and click merge, or you ask the AI to fix what broke. CodeWorthy advises. You own the decision.
9. **It goes in the record.** The result is written to the permanent diary. Later, you or an auditor can see that this change was tried before it shipped, and what happened.

That is the whole thing. No setup. No test-writing. No new tools to learn.

---

## What you will see

**On every proposal**, one plain-language note:

> **Tried this change.** Your app installs, builds, and starts. All 12 existing
> checks pass. Nothing checks the files you changed, so I cannot promise those
> work. The bug this fixes is gone: it happened in the old version and does not
> happen now.

**On the checkup**, the test vital now says something real:

| Color | What it means |
|---|---|
| 🟢 Healthy | The app runs, existing checks pass, and the changed parts are covered. |
| 🟡 Needs attention | The app runs, but parts of what changed are not checked by anything. |
| 🔴 At risk | The app does not install, build, or start with this change in it. |

**In the record**, one line per try, like:

> *Nov 3, 2:14 pm. Tried proposal #42 "Add a signup email." App started.
> 12 of 12 checks passed. Fix confirmed: red on old, green on new.*

---

## Two settings you control

CodeWorthy has always had two ways of acting, and this feature follows them.

- **Advise (the default).** CodeWorthy tells you what happened. You decide.
- **Block (you turn it on).** You can say: *"Do not let me merge if the app
  does not start."* Then the merge button stays off until it does. You can
  always override, and the override goes in the record with your reason.

This follows CodeWorthy's one rule: **you own every merge.** The tool never
merges, never deletes history, and never makes a one-way decision alone.

---

## What this is not

Being clear about this keeps the plan small and honest.

- **It is not a place to host your app.** Tools like Vercel, Netlify, Replit,
  and Lovable already give you a preview link. CodeWorthy will show you that
  link and write it in the record. It will not build its own.
- **It does not use your real passwords or keys.** The safe copy has none. Some
  apps cannot start without them. When that happens, CodeWorthy says so plainly
  instead of pretending.
- **It does not write a full set of tests for you.** AI-written tests that
  nobody reads give false comfort. CodeWorthy will run what exists, prove a fix
  when it can, and tell you clearly what is *not* checked.
- **It is not a third product.** It is part of Steward, the thing that already
  protects your app. There is no new door on the front page.

---

## Why we are confident we can build it

Most of the hard parts already exist in this project.

- **The safe copy** is already designed. The hiring side of CodeWorthy runs a
  stranger's code in a private, throwaway space with no keys and no internet.
  Same design, new use.
- **Red then green** is already built. The hiring side uses it to prove a
  candidate's fix is real. Same check, new use.
- **The checkup** already has a test vital. Today it can only look at the code
  from the outside. This gives it a way to actually run it.
- **The record** already exists. This just adds a new kind of entry.

One engine will serve all three parts of CodeWorthy: measuring engineers,
protecting apps, and teaching.

---

## What we build first

In this order. Each step is useful on its own.

1. **Install, build, start, run existing checks.** Zero setup. One paragraph
   back. Test vital updates. Entry in the record.
2. **Red then green** for proposals that say they fix something.
3. **The Block setting**, off by default.
4. **A note on what is not covered.** When the files you changed are checked by
   nothing, say so.
5. **A few smoke checks written from the change itself.** For example, if the
   change touched the signup form, try submitting the signup form. These are
   AI-written and clearly labelled as best-effort.

---

## How we find out if this is a good idea, cheaply

Before building any of it, one test that takes a day:

> Take twenty public apps built with Lovable, Bolt, or Cursor. Put each in a
> safe copy with no keys. Try to install, build, and start it. Count how many
> work.

If most of them start, this is a few weeks of work. If almost none do, we learn
that early and change the plan. That number decides everything, so we get it
first.

---

## The one-paragraph version

CodeWorthy already keeps your app safe by organizing changes and holding them
until you say go. Next, it will **try each change in a private throwaway copy**,
with none of your secrets, and tell you in a few plain sentences whether your
app still works and whether the fix is real. You stay in charge of the merge
button. Everything it finds goes in the record. It will not host your app, will
not use your passwords, and will not pretend to have tested what it has not.
