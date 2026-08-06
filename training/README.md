# Training pipeline

Commits the pipeline that was missing per issue #33 — `lib/model.ts`'s module comment
previously pointed at `scratchpad/train_py/`, which never existed in this repo. This directory
is that pipeline, reproducible from a clean checkout.

Produces the model in `public/model/` (18-class fallback CNN, follow-up to #19). Read the issue
this pipeline was built for before changing anything here — it has the full rationale for why
augmentation is the priority change, and the exact non-negotiables (ink polarity, class-list
ordering, export size budget) that carry over from #19 and `CLAUDE.md`.

## Setup

Needs Python 3.11 or 3.12 — TensorFlow does not yet ship wheels for 3.13+. If your default
`python` is newer, create a venv against an older interpreter explicitly:

```bash
py -3.11 -m venv .venv          # Windows, if multiple Pythons are installed via py launcher
python3.11 -m venv .venv        # macOS/Linux
source .venv/bin/activate       # or .venv\Scripts\activate on Windows
pip install tensorflow numpy
pip install --no-deps tensorflowjs   # --no-deps: tensorflowjs's default deps pull in uvloop,
                                      # which does not support Windows and isn't needed for
                                      # just running the converter CLI
```

## 1. Download data

```bash
python download_data.py --out data/ --samples-per-class 15000
```

Pulls from the public Quick, Draw! `numpy_bitmap` bucket. Uses HTTP Range requests to read only
the `.npy` header plus the first N samples' worth of bytes — full class files can be
50–250MB+ (some categories have 300k+ samples); we only need ~15k/class, so there's no reason
to pull the rest over a residential/laptop connection. Re-running with a higher
`--samples-per-class` for one weak class only re-downloads what's missing (see "Raise samples
per class" in the issue).

`CLASSES` in this script must stay in sync with `public/model/class_names.txt`. It intentionally
does not read that file — the list is small and duplicating it here makes it obvious at a glance
that training and inference agree, without a runtime file dependency between two otherwise
decoupled tools.

## 2. Train

```bash
python train.py --data data/ --out ../public/model/ --epochs 15
```

What it does, and why:

- **Augmentation** (`build_augmentation`, `stroke_width_jitter`): rotation ±15°, scale jitter,
  small translation, and stroke-width dilate/erode. This is the highest-value change the issue
  calls out — Quick, Draw!'s bitmaps are bbox-normalized and mouse-drawn; a carnival participant
  with a fingertip and 90 seconds produces neither.
- **Network** (`build_model`): modestly deepened from #19's first conv block (16 filters @
  3×3) — three conv stages instead of two, going 24→24→48→64 filters. Still small on purpose;
  export size is checked against a ~1MB budget at the end of the script, matching what #18 has
  to plan stall Wi-Fi around.
- **Ink polarity**: raw Quick Draw `.npy` bitmaps are ink=255/background=0. This script inverts
  and normalizes to ink≈1.0/background≈0.0 — the same polarity `lib/model.ts` expects at
  inference. Get this backwards and the model trains fine, loads fine, and returns confident
  nonsense in the app. Non-negotiable, carried from #19.
- **Validation accuracy is reported but is not the success metric.** #19's own postmortem:
  held-out accuracy climbing (e.g. 94.5% → 96%) means nothing on its own — that's the exact trap
  this pipeline exists to avoid repeating. The real gate is the hand-drawn table below.

Output: a candidate model at `public/model/_candidate_tfjs/` plus
`public/model/_candidate_report.json` (per-class held-out accuracy, export size). **Nothing is
swapped into the live `public/model/model.json` automatically.** That's a deliberate manual
step — see below.

## 3. Hand-drawn validation (the actual gate)

This is the part this pipeline **cannot do for you**. Held-out accuracy on Quick, Draw!'s own
bitmaps was already 94.5% on the current shipped model and it still had 9 categories fail
real hand-drawn testing (#19 step 4) — the validation set has the same mouse-drawn,
bbox-normalized bias as the training data, so it can't catch what a real fingertip does.

Per the issue: **each of the 18 categories, drawn three times, hurriedly, on a real phone,
top-1 at ≥0.50 confidence on 2 of 3.** Do this against the *current shipped* model first to get
a baseline table, before touching anything — without a before-table there's no way to tell
whether a retrain helped or hurt.

`scripts/diagnose-model.mjs` (repo root) can supplement this — it runs the real inference
pipeline against synthetically generated curved strokes at multiple canvas sizes, which is
useful for catching preprocessing bugs (it's exactly how the dilation fix in `lib/model.ts` was
found and verified) — but it is not a substitute for a human drawing on a real device. Don't
post its output as if it were the hand-drawn table.

## 4. Promote a candidate

Only after the hand-drawn after-table is posted and it beats (or at least doesn't regress) the
before-table:

```bash
cp public/model/_candidate_tfjs/model.json public/model/model.json
cp public/model/_candidate_tfjs/*.bin public/model/
# class_names.txt only changes in Phase 2 (new classes) - Phase 1 keeps the same 18 in the
# same order, so nothing to touch there.
rm -rf public/model/_candidate_tfjs public/model/_candidate_report.json
```

Then re-run `node scripts/verify-word-bank.mjs` (word bank didn't change in Phase 1, but it's
a cheap sanity check) and get a device-QA pass (#16) before the freeze (#18) — any model change
needs re-timing on the slowest phone.
