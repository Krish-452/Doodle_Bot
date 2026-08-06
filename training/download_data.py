"""
Downloads a bounded number of samples per class from the Quick, Draw! numpy_bitmap dataset.

Each class file on Google's bucket can be 50-250MB (some categories have 300k+ samples) - we
only need ~15k/class, so this uses HTTP Range requests to read just the .npy header (to learn
the array's dtype/shape) and then just the first N rows' worth of bytes, rather than pulling
the whole file down over stall-grade... well, developer-grade Wi-Fi.

Usage:
    python download_data.py --out data/ --samples-per-class 15000
"""
import argparse
import io
import os
import urllib.request

import numpy as np

BASE_URL = "https://storage.googleapis.com/quickdraw_dataset/full/numpy_bitmap/{name}.npy"

# Must match public/model/class_names.txt, in the same order.
CLASSES = [
    "house", "sun", "umbrella", "fish", "bicycle", "flower", "pizza", "envelope",
    "airplane", "crown", "lightning", "wristwatch", "spider", "sword", "camera",
    "ladder", "sailboat", "drums",
]


def _range_get(url: str, start: int, end: int) -> bytes:
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def download_class(name: str, n_samples: int) -> np.ndarray:
    """Fetches the .npy header via a small range request, then just the rows we need."""
    url = BASE_URL.format(name=name)

    # npy header is never bigger than a few KB; 8192 bytes is generous headroom.
    head = _range_get(url, 0, 8191)
    header_stream = io.BytesIO(head)
    version = np.lib.format.read_magic(header_stream)
    if version == (1, 0):
        shape, fortran_order, dtype = np.lib.format.read_array_header_1_0(header_stream)
    else:
        shape, fortran_order, dtype = np.lib.format.read_array_header_2_0(header_stream)
    if fortran_order:
        raise ValueError(f"{name}: fortran-ordered array not supported by this downloader")
    data_start = header_stream.tell()

    total_rows, row_len = shape
    n = min(n_samples, total_rows)
    itemsize = dtype.itemsize
    row_bytes = row_len * itemsize

    data_end = data_start + n * row_bytes - 1
    raw = _range_get(url, data_start, data_end)
    arr = np.frombuffer(raw, dtype=dtype, count=n * row_len).reshape(n, row_len)
    return arr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="data")
    parser.add_argument("--samples-per-class", type=int, default=15000)
    parser.add_argument("--classes", nargs="*", default=CLASSES)
    args = parser.parse_args()

    os.makedirs(args.out, exist_ok=True)

    for name in args.classes:
        dest = os.path.join(args.out, f"{name}.npy")
        if os.path.exists(dest):
            existing = np.load(dest)
            if existing.shape[0] >= args.samples_per_class:
                print(f"skip {name}: already have {existing.shape[0]} samples")
                continue
        print(f"downloading {name} ({args.samples_per_class} samples)...")
        arr = download_class(name, args.samples_per_class)
        np.save(dest, arr)
        print(f"  -> {arr.shape[0]} samples, {arr.nbytes / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
