"""
Trains the DoodleBot sketch classifier and exports it to public/model/ in TF.js LayersModel
format.

Follow-up to #19 (which shipped the model currently in public/model/). Phase 1 goal from the
tracking issue: better accuracy on the existing 18 words, not more words - see word_bank
parity requirement below.

Key design decisions, and why:

  - Augmentation matched to how people actually draw on a phone (rotation +-15deg, scale
    jitter, stroke-width variation via morphological dilate/erode, small translation).
    Quick, Draw! bitmaps are bbox-normalised and drawn with a mouse; a carnival participant
    with a fingertip and 90 seconds is neither. This is the issue's own highest-value item.
  - Network is modestly deepened from #19's first-conv-block-16-filters baseline (see
    build_model() below), while keeping the exported artifact under the ~1MB budget #18 has to
    plan stall Wi-Fi around - checked automatically at the end of this script.
  - Validation accuracy is reported but is explicitly NOT the success metric. #19's own
    postmortem: held-out accuracy climbing means nothing on its own. The real gate is the
    hand-drawn table (scripts/diagnose-model.mjs gets close but is not a substitute for a human
    drawing on a real phone - see training/README.md).

Usage:
    python train.py --data data/ --out ../public/model/ --epochs 15
"""
import argparse
import json
import os

import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers

import export_tfjs

IMG_SIZE = 28

# Must match public/model/class_names.txt order exactly - lib/model.ts documents a real
# earlier bug where output indices got mapped against the word bank instead of this list,
# producing confident, consistently wrong labels. Output units are in THIS order.
CLASSES = [
    "house", "sun", "umbrella", "fish", "bicycle", "flower", "pizza", "envelope",
    "airplane", "crown", "lightning", "wristwatch", "spider", "sword", "camera",
    "ladder", "sailboat", "drums",
]

MAX_EXPORT_BYTES = 1_000_000  # ~1MB budget from the issue, checked at the end.


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_dataset(data_dir: str):
    xs, ys = [], []
    for label_idx, name in enumerate(CLASSES):
        path = os.path.join(data_dir, f"{name}.npy")
        arr = np.load(path)  # (N, 784) uint8, 0=background 255=ink (raw Quick Draw polarity)
        xs.append(arr)
        ys.append(np.full(arr.shape[0], label_idx, dtype=np.int64))
        print(f"  {name}: {arr.shape[0]} samples")
    # Raw Quick Draw npy bitmaps are already ink=255/background=0 (verified empirically against
    # the downloaded data - see training/README.md). Dividing by 255 alone already lands ink at
    # ~1.0 and background at ~0.0, which IS this project's polarity convention (lib/model.ts
    # non-negotiable) - no extra inversion needed. An earlier version of this line added one
    # anyway ("x = 1.0 - x"), which silently trained the whole run on backwards-polarity images:
    # it doesn't error, doesn't warn, and validation accuracy still looks plausible during
    # training (the model just learns the wrong-but-internally-consistent mapping) - it only
    # surfaces once the exported model is evaluated against correctly-inverted real predict()
    # input, which training/compare_models.mjs caught (candidate collapsed to 19% mean accuracy
    # against the shipped model's 94.4% on identical held-out data). Exactly the failure mode
    # CLAUDE.md and this issue both warn about: backwards polarity runs fine and predicts
    # nonsense. Do not reintroduce this inversion.
    x = np.concatenate(xs, axis=0).astype(np.float32) / 255.0  # -> [0,1], ink ~1, background ~0
    x = x.reshape(-1, IMG_SIZE, IMG_SIZE, 1)
    y = np.concatenate(ys, axis=0)
    return x, y


# ---------------------------------------------------------------------------
# Augmentation - matched to fingertip/phone drawing, not mouse-drawn bbox-normalised strokes.
# Applied on the fly per-batch via a Keras layer so it's cheap and never touches disk.
# ---------------------------------------------------------------------------

def build_augmentation():
    return keras.Sequential(
        [
            layers.RandomRotation(15 / 360, fill_mode="constant", fill_value=0.0),
            layers.RandomZoom((-0.15, 0.15), fill_mode="constant", fill_value=0.0),
            layers.RandomTranslation(0.08, 0.08, fill_mode="constant", fill_value=0.0),
        ],
        name="augmentation",
    )


def stroke_width_jitter(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Randomly thickens or thins ink per-sample via a 3x3 max/min filter, simulating the
    stroke-width variation a fingertip produces that a mouse-drawn, uniform-width Quick Draw
    stroke never has. Applied once up front (not per-epoch) - cheap enough at this dataset size
    and keeps RandomRotation/Zoom/Translation (which need a tf.data pipeline) doing the
    per-epoch work."""
    out = np.empty_like(x)
    for i in range(x.shape[0]):
        mode = rng.choice(["thicken", "thin", "none"], p=[0.35, 0.25, 0.40])
        img = x[i, :, :, 0]
        if mode == "thicken":
            img = _max_filter_3x3(img)
        elif mode == "thin":
            img = _min_filter_3x3(img)
        out[i, :, :, 0] = img
    return out


def _max_filter_3x3(img: np.ndarray) -> np.ndarray:
    padded = np.pad(img, 1, mode="constant", constant_values=0.0)
    out = np.zeros_like(img)
    for dy in range(3):
        for dx in range(3):
            out = np.maximum(out, padded[dy : dy + img.shape[0], dx : dx + img.shape[1]])
    return out


def _min_filter_3x3(img: np.ndarray) -> np.ndarray:
    padded = np.pad(img, 1, mode="constant", constant_values=1.0)
    out = np.ones_like(img)
    for dy in range(3):
        for dx in range(3):
            out = np.minimum(out, padded[dy : dy + img.shape[0], dx : dx + img.shape[1]])
    return out


# ---------------------------------------------------------------------------
# Model - modestly deepened from #19's first block (16 filters @ 3x3). Still small: the
# exported artifact is checked against MAX_EXPORT_BYTES at the end of this script.
# ---------------------------------------------------------------------------

def build_model(augment: keras.Sequential) -> keras.Model:
    # GlobalAveragePooling2D previously sat here and collapsed the 7x7x64 feature map to just
    # 64 values, throwing away nearly all spatial layout - two independent training runs
    # plateaued at 83.9% and 87.6% val accuracy, both well under #19's 94.5% shipped baseline.
    # The shipped model instead pools down to 3x3x64 and Flattens (576 features) into a 128-unit
    # dense head, keeping spatial detail GAP discards. Mirrored that here (with one extra
    # MaxPooling2D to keep the Flatten -> Dense input small enough for the size budget) rather
    # than reverting the deeper conv stack or the augmentation, which were the issue's actual
    # asks.
    inputs = keras.Input(shape=(IMG_SIZE, IMG_SIZE, 1))
    x = augment(inputs)
    x = layers.Conv2D(24, 3, activation="relu", padding="same")(x)
    x = layers.Conv2D(24, 3, activation="relu", padding="same")(x)
    x = layers.MaxPooling2D()(x)
    x = layers.Conv2D(48, 3, activation="relu", padding="same")(x)
    x = layers.MaxPooling2D()(x)
    x = layers.Conv2D(64, 3, activation="relu", padding="same")(x)
    x = layers.MaxPooling2D()(x)
    x = layers.Flatten()(x)
    x = layers.Dense(128, activation="relu")(x)
    x = layers.Dropout(0.3)(x)
    outputs = layers.Dense(len(CLASSES), activation="softmax")(x)
    return keras.Model(inputs, outputs)


def per_class_accuracy(model, x_val, y_val):
    preds = np.argmax(model.predict(x_val, verbose=0), axis=1)
    table = {}
    for idx, name in enumerate(CLASSES):
        mask = y_val == idx
        table[name] = float((preds[mask] == idx).mean()) if mask.any() else float("nan")
    return table


class _EpochMarker(keras.callbacks.Callback):
    """Writes the last-completed epoch number to disk so a killed run can resume from here
    instead of restarting - this training environment has been killing the process mid-run
    (observed twice: once at epoch 1, once at epoch 32) for reasons outside the script, so
    losing 30+ epochs of progress to a restart is a real cost, not a hypothetical one."""

    def __init__(self, path):
        super().__init__()
        self.path = path

    def on_epoch_end(self, epoch, logs=None):
        with open(self.path, "w") as f:
            f.write(str(epoch + 1))  # epoch is 0-indexed; store count of epochs completed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data")
    parser.add_argument("--out", default="../public/model")
    parser.add_argument("--epochs", type=int, default=60)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    tf.random.set_seed(args.seed)
    rng = np.random.default_rng(args.seed)

    print("Loading data...")
    x, y = load_dataset(args.data)
    print(f"Total samples: {x.shape[0]}")

    print("Applying stroke-width jitter...")
    x = stroke_width_jitter(x, rng)

    # Stratified-ish split: shuffle then slice, dataset is balanced per class already.
    perm = rng.permutation(x.shape[0])
    x, y = x[perm], y[perm]
    n_val = int(0.15 * x.shape[0])
    x_val, y_val = x[:n_val], y[:n_val]
    x_train, y_train = x[n_val:], y[n_val:]
    print(f"Train: {x_train.shape[0]}  Val: {x_val.shape[0]}")

    augment = build_augmentation()
    model = build_model(augment)
    model.compile(optimizer="adam", loss="sparse_categorical_crossentropy", metrics=["accuracy"])
    model.summary()

    os.makedirs(args.out, exist_ok=True)
    ckpt_weights = os.path.join(args.out, "_candidate_checkpoint.weights.h5")
    ckpt_epoch_marker = os.path.join(args.out, "_candidate_checkpoint.epoch")
    initial_epoch = 0
    if os.path.exists(ckpt_weights) and os.path.exists(ckpt_epoch_marker):
        initial_epoch = int(open(ckpt_epoch_marker).read().strip())
        model.load_weights(ckpt_weights)
        print(f"Resuming from checkpoint at epoch {initial_epoch} ({ckpt_weights})")

    # Augmentation makes each epoch a harder task than #19's unaugmented baseline, so a flat
    # 15-epoch schedule (the original default) undertrained the model - a prior candidate run
    # validated at 83.9%, well below the 94.5% shipped baseline it was supposed to beat. Give it
    # more epoch budget but stop on a plateau (restoring the best-val-accuracy weights, not
    # whatever the last epoch happened to land on) rather than hand-picking an epoch count.
    callbacks = [
        keras.callbacks.EarlyStopping(
            monitor="val_accuracy", patience=10, restore_best_weights=True,
        ),
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss", factor=0.5, patience=4, min_lr=1e-5,
        ),
        keras.callbacks.ModelCheckpoint(ckpt_weights, save_weights_only=True, save_freq="epoch"),
        _EpochMarker(ckpt_epoch_marker),
    ]

    history = model.fit(
        x_train, y_train,
        validation_data=(x_val, y_val),
        initial_epoch=initial_epoch,
        epochs=args.epochs,
        batch_size=args.batch_size,
        callbacks=callbacks,
        verbose=2,
    )

    val_acc = max(history.history["val_accuracy"]) if history.history.get("val_accuracy") else None
    # On a resumed run initial_epoch may already be past the plateau, in which case history is
    # empty (EarlyStopping/fit does nothing) - fall back to re-evaluating the loaded weights.
    if val_acc is None:
        val_acc = model.evaluate(x_val, y_val, verbose=0)[1]
    print(f"\nFinal validation accuracy: {val_acc * 100:.1f}%")

    print("\nPer-class held-out accuracy (NOT the hand-drawn gate - see training/README.md):")
    table = per_class_accuracy(model, x_val, y_val)
    for name, acc in sorted(table.items(), key=lambda kv: kv[1]):
        print(f"  {name:12s} {acc * 100:5.1f}%")

    # Strip the augmentation layer before export - it's a no-op at inference (only active
    # during training) but there's no reason to ship it in the exported graph. Collect trained
    # weights keyed by layer name so export_tfjs's tf_keras twin (see that module's docstring
    # for why a separate legacy-Keras rebuild is needed) can load them by name rather than
    # position.
    weights_by_layer = {
        layer.name: layer.get_weights()
        for layer in model.layers[2:]  # skip Input and the augmentation Sequential
        if layer.get_weights()
    }

    os.makedirs(args.out, exist_ok=True)
    tfjs_out = os.path.join(args.out, "_candidate_tfjs")
    total_bytes = export_tfjs.export(weights_by_layer, IMG_SIZE, len(CLASSES), tfjs_out)
    print(f"\nExported tfjs artifact: {total_bytes / 1e6:.2f} MB (budget: {MAX_EXPORT_BYTES / 1e6:.1f} MB)")
    if total_bytes > MAX_EXPORT_BYTES:
        print("WARNING: export exceeds the size budget from issue - do not ship without revisiting.")

    with open(os.path.join(args.out, "_candidate_report.json"), "w") as f:
        json.dump(
            {
                "val_accuracy": val_acc,
                "per_class_val_accuracy": table,
                "export_bytes": total_bytes,
                "epochs": args.epochs,
                "train_samples": int(x_train.shape[0]),
                "val_samples": int(x_val.shape[0]),
            },
            f,
            indent=2,
        )
    print(f"\nCandidate artifacts written to {tfjs_out}/ (NOT swapped into public/model/ yet).")
    print("Report written to _candidate_report.json.")

    # Run completed end-to-end - clear the resume checkpoint so the next invocation starts a
    # fresh run instead of silently resuming from this one's final epoch.
    for p in (ckpt_weights, ckpt_epoch_marker):
        if os.path.exists(p):
            os.remove(p)


if __name__ == "__main__":
    main()
