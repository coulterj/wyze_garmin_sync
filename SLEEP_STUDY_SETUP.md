# Tylenol Sleep Study — Setup

A personal **randomized self-experiment** to answer: *does acetaminophen actually
improve my sleep, or is it placebo?* You follow a pre-randomized "take / skip"
schedule, and every morning Garmin's sleep data plus your quick notes flow into
one private Google Sheet that shows — clearly — whether Tylenol nights beat
no-Tylenol nights.

**Why randomize?** Acetaminophen isn't a known sleep aid, so your neurologist may
suspect placebo. Taking it on a *fixed random schedule* — regardless of how you
feel that night — is exactly what separates a real effect from expectation. Show
her the schedule so she's on board with the "skip" nights.

## How the pieces fit

- **Google Sheet (private, your account)** — the whole system lives here:
  - **Log** tab: your randomized schedule + your 30-second daily entry.
  - **Garmin** tab: filled automatically every day (you never touch it).
  - **Dashboard** tab: yesterday-at-a-glance + the take-vs-skip charts.
- **This repo's daily job** already runs at 18:00 UTC and logs into Garmin. It now
  also pulls your sleep/HRV/heart-rate/etc. and pushes them into the sheet.
- **Blood pressure** needs zero manual entry — your Omron already auto-syncs to
  Garmin, and the sheet pulls it from there.

---

## One-time setup (~10 minutes)

### Part A — Build the sheet

1. Go to <https://sheets.new> to create a **new blank Google Sheet**. Name it
   e.g. "Tylenol Sleep Study".
2. **Extensions → Apps Script**. Delete the sample `function myFunction() {}`.
3. Open `setup_sheet.gs` from this repo, copy the **entire** file, and paste it
   into the Apps Script editor. Click the **Save** (💾) icon.
4. In the toolbar, make sure the function dropdown shows **`setUp`**, then click
   **Run**. Approve the permissions prompt (it's your own script on your own
   sheet — choose your account, "Advanced → Go to … (unsafe)" is expected for a
   personal script, then Allow).
5. A popup shows your **webhook token** — a long string. **Copy it somewhere
   safe** (you'll paste it into GitHub in Part B). Click back to the sheet: all
   three tabs are now built and your schedule is filled in.

### Part B — Turn on the daily auto-fill

6. Back in the Apps Script editor: **Deploy → New deployment**. Click the gear ⚙️
   next to "Select type" → **Web app**. Set:
   - **Execute as:** Me
   - **Who has access:** Anyone
   
   Click **Deploy**, approve if asked, and **copy the Web app URL** (ends in
   `/exec`).
7. In GitHub, go to your repo **Settings → Secrets and variables → Actions → New
   repository secret** and add **two** secrets:
   - `SHEET_WEBHOOK_URL` = the Web app URL from step 6
   - `SHEET_WEBHOOK_TOKEN` = the token from step 5

That's it. Tonight's daily run will start filling the Garmin tab.

### Part C — Load your recent history (optional, recommended)

To see the dashboard populated immediately instead of waiting, load the last
month from your own machine:

```bash
cd wyze_garmin_sync
export SHEET_WEBHOOK_URL='...your /exec url...'
export SHEET_WEBHOOK_TOKEN='...your token...'
python sleep_study.py --backfill 30
```

(You can also just trigger the GitHub Action manually: repo **Actions → Daily
Sync → Run workflow**.)

---

## Your daily routine (30 seconds)

Open the **Log** tab. Today's row is highlighted yellow.

- **Evening:** Look at the **Scheduled** column. Blue = **TAKE** tonight, gray =
  **SKIP**. Do what it says (that's the whole point). Fill in **Took it?** (Y/N),
  **Dose**, and **Time taken**.
- **Next morning:** on that **same night's row**, fill **How rested (1–5)** and an
  optional **Note** (alcohol, late caffeine, stress, sick, travel — anything that
  explains an odd night).

> Each row is **one night, dated by the evening you go to sleep.** Garmin files
> sleep under the morning you wake, and the sheet already lines the two up for you
> — just always write on the night's row.

Then glance at the **Dashboard** tab: the big banner tells you whether you took
Tylenol last night, with that night's sleep score, HRV, resting HR, naps, and BP.

---

## Reading the results

On the **Dashboard** tab:

- **DOES IT HELP?** — average **sleep score** and **how-rested** on Tylenol nights
  vs no-Tylenol nights, side by side. If the blue (Tylenol) bars are clearly
  higher, that's your signal.
- **Nights measured** — how many of each you've logged. More nights = more
  trustworthy. Over the ~2.5-month schedule you'll have ~37 take / ~38 skip.
- **Sleep-score difference** — the plain-English gap (e.g. "+6.2 points on
  Tylenol nights").
- **Trend chart** — every night's score over time, blue dots (Tylenol) vs gray
  (no Tylenol). Easy to eyeball whether blue tends to sit higher.

**A caution to keep it honest:** a few points' difference over a handful of nights
can be noise. Let the full schedule play out, and treat the dashboard as evidence
to *discuss* with your neurologist, not a verdict. She can judge whether the gap
is meaningful.

## Before your appointment

Just share the Google Sheet with her (or screen-share the Dashboard tab). The
take-vs-skip chart, the sample sizes, and the randomized schedule are exactly what
she needs to see. Everything stays in your private Google account — nothing is
public.

---

## Troubleshooting

- **Garmin tab stays empty** — the webhook secrets are missing/wrong, or the Web
  app wasn't deployed with access "Anyone". Re-check Part B. You can test locally
  with `python sleep_study.py` after exporting the two env vars; it prints whether
  the upload succeeded.
- **Changed the schedule / want to re-deploy the script** — after editing
  `setup_sheet.gs`, in Apps Script do **Deploy → Manage deployments → edit → New
  version**. The token and URL stay the same.
- **Sleep score looks off by a day** — it isn't: Garmin labels each night by the
  morning you wake; the sheet shifts the Log join by one day to match. Log on the
  bedtime row and it lines up.
