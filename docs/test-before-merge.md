# Try It Before It Ships

*A plain-language plan for the next part of CodeWorthy. Written so that someone
who has never written code can read the whole thing and understand it.*

*The part of CodeWorthy that watches over your app is called
**SirCodyWorthington**. It used to be called Steward, and a few web addresses
and code names still say "steward." Same thing, new name.*

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
| **Solo mode** | The default. You are the only person changing this app, so changes go straight to main and SirCodyWorthington checks each one after it lands. |
| **Group mode** | For apps with more than one person changing them. Every change becomes a proposal first, and nothing reaches main until someone clicks merge. (Called "shared mode" in the settings today.) |
| **Publish** | The button in Lovable or Bolt that puts your app in front of real people. For most AI builders, *this* is the moment a change ships, not a merge on GitHub. |
| **Sync** | Lovable and Bolt copy every edit to GitHub as you go. One copy in the tool, one on GitHub, kept the same. |

---

## What happens, step by step

This is the whole process from your point of view.

1. **You make a change.** You ask your AI tool to add a feature or fix a bug. It edits the code.
2. **The change lands where your setup says.** In solo mode (the default) it goes to main, and your live app is untouched until you press Publish. In the full loop or group mode it becomes a proposal, and main waits for you.
3. **CodeWorthy makes a safe copy of your app with the change in it.** The copy is private. It has no passwords, no keys, and no way to reach the internet. It is deleted when the check is done.
4. **CodeWorthy tries the change.** In the safe copy it asks four simple questions:
   - Does the app still install?
   - Does the app still build?
   - Does the app still start?
   - Do the checks that already existed still pass?
5. **If the change claims to fix a problem, CodeWorthy proves it.** It shows the problem happening in the old version, and not happening in the new one. We call this *red then green*. Red means the problem is there. Green means it is gone.
6. **You get one short paragraph.** Something like: *"Your app still starts. All 12 existing checks pass. Nothing checks the two files you changed, so I cannot promise those work. The bug you asked to fix is gone."*
7. **The checkup updates.** The test vital goes green, yellow, or red based on what just happened.
8. **You decide.** You read the paragraph and press Publish or click merge, or you ask the AI to fix what broke. SirCodyWorthington advises. You own the decision.
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

**Solo mode is the default for everyone.** Most people connecting an app are
the only person working on it, and making them open a proposal to themselves
just gets protection turned off. So every new app starts in solo mode.
SirCodyWorthington keeps watching, though. If it sees a second person pushing
changes to the app, it says so and suggests switching to group mode:

> *Two people have changed this app in the last week. Want to switch to group
> mode, so every change is a proposal someone else can look at first?*

You click yes or not now. It never switches by itself.

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
- **It is not a third product.** It is part of SirCodyWorthington, the thing
  that already protects your app. There is no new door on the front page.

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

## Seeing it run, without CodeWorthy hosting anything

Reading "your app still starts" is good. Seeing it is better. CodeWorthy can
show you the change running in three ways, and none of them need CodeWorthy to
host your app.

**1. The preview you already have.** Lovable and Bolt show your app live inside
their editor, and give you a link once you publish. CodeWorthy does not replace
that. It puts the link next to its own note, so the verdict and the view are in
one place.

**2. Pictures from the safe copy.** When the safe copy can start your app, it
opens the pages the change touched, takes screenshots, and attaches them to the
proposal. No link, no hosting, just pictures. You get a quick look without
opening anything.

**3. Run it on your own computer.** A small helper program on your machine. You
click *Try it here*, and the helper:

1. Grabs the proposal's version of your app.
2. Starts it on your computer.
3. Opens it in your browser so you can click around.
4. Sends back a short report: did it start, what you looked at, screenshots if
   you want them.

This is the best way to *see* a change, because your computer already has your
passwords and keys, so apps that cannot start in the safe copy will start here.
Two cautions come with it:

- **Your real keys are in play.** If the change talks to a payment service or
  deletes data, it could do that for real. The helper warns you when it sees a
  live key and uses test keys where it can.
- **It only proves what happened on your computer.** In the record, that is a
  different kind of entry from the safe copy. Both are kept. The note always
  says which one happened.

The helper is optional, and it is for people who already run their app on
their own machine. If you build only in Lovable or Bolt, you never need it.
Ways 1 and 2 cover you.

---

## Connecting Lovable or Bolt: three clicks, once

Both tools already copy your app to GitHub as you work. CodeWorthy lives on
GitHub. So GitHub is the bridge, and you already have it. There is nothing to
install and nothing to paste.

**Step 1. In Lovable or Bolt, click Connect to GitHub.** This is a button they
provide. It makes a GitHub repository for your app and keeps it in sync with
every edit. If you did this already, skip it.

**Step 2. In CodeWorthy, click Connect my app and pick that repository.** GitHub
asks you once to allow CodeWorthy to see it. Say yes.

**Step 3. Tell CodeWorthy "I build with Lovable" or "I build with Bolt," and
answer one question: where does your app go live?**

- **"I press Publish in Lovable or Bolt."** This is most people. Nothing else
  to do. Your tool keeps syncing straight to main, and you check
  SirCodyWorthington's verdict before you press Publish.
- **"It goes live from GitHub"** (for example Vercel or Netlify builds it from
  your main branch). CodeWorthy walks you through the full loop, described
  below. It takes one more minute.

That's it. From then on:

- Every time your tool syncs a change, SirCodyWorthington tries it in a safe
  copy.
- Within a few minutes you see one of two verdicts on your checkup and in the
  record: **Safe to publish** or **Hold off, here's why**, with pictures when
  it can get them.
- You check that before you press Publish in Lovable or Bolt. That is your
  "before it ships" moment, and SirCodyWorthington never touches the Publish
  button.

**Why solo mode matters here.** Group mode requires a proposal for every change
to main. Lovable and Bolt need to write to the synced branch directly, and if
they are blocked, Lovable quietly pushes your edits to a side branch instead,
where the next sync can overwrite them. Solo mode, the default, means this
cannot happen. SirCodyWorthington still blocks force-pushes and branch
deletion, still records everything, and still tries every change. It just
reviews after the sync lands instead of before. If a second person starts
working in the app, it will suggest group mode, and tell you to move your
tool to a `draft` branch first so nothing gets sidelined.

---

## The full loop, for apps that go live from GitHub

If your live site is built from your GitHub main branch rather than by the
Publish button, main *is* the thing that ships. So the try should happen
before main changes, not after. Here is the whole setup, done once:

1. **In Lovable or Bolt, switch to a branch called `draft`.** Both tools have
   a branch picker. CodeWorthy shows you where it is. From now on every edit
   your tool makes lands on `draft`, never on main.
2. **SirCodyWorthington opens a proposal from `draft` to `main`** the moment
   `draft` changes, and keeps it up to date as you keep editing. You do not
   open anything.
3. **It tries the proposal** in the safe copy, same as always: install, build,
   start, existing checks, red then green when a fix is claimed, pictures.
4. **You read the verdict and click merge.** Main changes. Your site rebuilds.
   Nothing reached it that was not tried first.

Two things to know:

- **Your tool's own preview still shows `draft`,** so you can see your work in
  Lovable or Bolt the whole time. Main just waits for you.
- **If you ever push to main some other way,** SirCodyWorthington notices and
  tells you, and reminds you that `draft` is now behind. It never rewrites
  either branch to fix that. It shows you the one safe step.

This is the loop the rest of this page describes, with the tool's sync as the
way code gets written. Once it is set up, you never think about branches
again. You edit, you read the verdict, you click merge.

---

## What we build first

In this order. Each step is useful on its own.

1. **The three-click connect for Lovable and Bolt.** Pick the tool, answer
   where it goes live, get solo mode and the safe defaults, done.
2. **Install, build, start, run existing checks.** Zero setup. One paragraph
   back. Test vital updates. Entry in the record.
3. **Safe to publish / Hold off.** The verdict, shown where you'll see it
   before you press Publish.
4. **Pictures from the safe copy**, and the link to the preview you already
   have.
5. **Red then green** for changes that say they fix something.
6. **The full loop**: the `draft` branch walkthrough and the proposal
   SirCodyWorthington keeps open for apps that go live from GitHub.
7. **The Block setting**, off by default, and the "switch to group mode?"
   suggestion when a second person shows up.
8. **A note on what is not covered.** When the files you changed are checked by
   nothing, say so.
9. **The helper for your own computer.** Optional, for people who already run
   their app locally.
10. **A few smoke checks written from the change itself.** For example, if the
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
app still works and whether the fix is real. If you build with Lovable or Bolt, connecting takes three clicks and you check
the verdict before you press Publish. You stay in charge of the merge button
and the Publish button. Everything it finds goes in the record. It will not host
your app, will not use your passwords, and will not pretend to have tested what
it has not.
