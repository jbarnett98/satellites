"""
Build the Milky Way glow map by summing the light of the Tycho-2 catalogue.

The Milky Way, to the eye, is the integrated light of stars too faint to see individually.
We reproduce it the same way: every Tycho-2 star fainter than the ones the site plots
individually contributes its flux (10^(-0.4·V)) to the sky pixel it falls in, weighted by a
colour derived from its B−V index. The result is divided by each pixel's solid angle (so it is
surface brightness, not count), smoothed, tone-mapped, and written as a small RGB texture the
site drapes over the celestial sphere underneath the plotted stars.

Input : data/raw/tycho2/tyc2.dat.00.gz … tyc2.dat.19.gz   (CDS I/259, 2,539,913 stars)
Output: web/public/textures/sky/milky-way-glow-<width>.webp  (equirectangular RA × Dec,
        RA 0° at the left edge increasing rightward, Dec +90° at the top)

Run from pipeline/:  uv run python -m ap_pipeline.sky.build_milky_way_glow_from_tycho2
"""

from __future__ import annotations

import gzip
import math
import time

import numpy as np
from PIL import Image

from ap_pipeline.paths import RAW, SKY_TEXTURES, ensure_dirs, rel

SRC_DIR = RAW / "tycho2"

# Defaults; --width and --sigma override them (Stage 4: 8192 / 2.5 replaced 4096 / 7.0 after the
# 4096 map read as blotches at 1:1 on a 1920-px screen — 40° of sky is only 455 texels there).
WIDTH, HEIGHT = 8192, 4096
BRIGHT_LIMIT = 8.0   # stars brighter than this are plotted individually by the site — leave them out
FLUX_CAP_MAG = 10.0  # a star brighter than this counts as if it were V=10: stops single
                     # stars making blobs, so the map traces the *density* of faint stars,
                     # which is what the unaided eye actually sees as the Milky Way
BLUR_SIGMA_PX = 2.5  # smooths 2.5M points into a glow while keeping the band's real structure
GAMMA = 0.85         # lifts the faint wings of the band without flattening the core

# B−V → linear RGB, the same hand-fit black-body ramp the browser uses for plotted stars.
_BV_STOPS = np.array([
    [-0.4, 0.60, 0.70, 1.00],
    [0.0, 0.78, 0.86, 1.00],
    [0.4, 0.96, 0.96, 1.00],
    [0.65, 1.00, 0.97, 0.90],
    [1.0, 1.00, 0.87, 0.70],
    [1.5, 1.00, 0.72, 0.48],
    [2.0, 1.00, 0.60, 0.34],
])


def bv_to_rgb(bv: np.ndarray) -> np.ndarray:
    x = np.clip(bv, _BV_STOPS[0, 0], _BV_STOPS[-1, 0])
    return np.stack([np.interp(x, _BV_STOPS[:, 0], _BV_STOPS[:, c]) for c in (1, 2, 3)], axis=1)


def read_tycho2() -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Return ra_deg, dec_deg, v_mag, b_minus_v for every usable star."""
    ra_l: list[float] = []
    dec_l: list[float] = []
    v_l: list[float] = []
    bv_l: list[float] = []
    files = sorted(SRC_DIR.glob("tyc2.dat.*.gz"))
    if not files:
        raise SystemExit(f"no Tycho-2 parts found in {rel(SRC_DIR)}")

    for f in files:
        t0 = time.perf_counter()
        n0 = len(ra_l)
        with gzip.open(f, "rt", encoding="ascii") as fh:
            for line in fh:
                p = line.split("|")
                # Mean J2000 position when solved; otherwise the observed position.
                ra_s, dec_s = p[2].strip(), p[3].strip()
                if not ra_s:
                    ra_s, dec_s = p[24].strip(), p[25].strip()
                bt_s, vt_s = p[17].strip(), p[19].strip()
                if not vt_s and not bt_s:
                    continue
                if vt_s and bt_s:
                    bt, vt = float(bt_s), float(vt_s)
                    bv = 0.850 * (bt - vt)          # Tycho → Johnson, ESA 1997 §1.3
                    v = vt - 0.090 * (bt - vt)
                elif vt_s:
                    v, bv = float(vt_s), 0.65
                else:
                    v, bv = float(bt_s) - 0.6, 0.65  # BT-only stars are few and faint
                ra_l.append(float(ra_s))
                dec_l.append(float(dec_s))
                v_l.append(v)
                bv_l.append(bv)
        print(f"  {f.name}: {len(ra_l) - n0:,} stars in {time.perf_counter() - t0:.1f} s")

    return (np.asarray(ra_l), np.asarray(dec_l), np.asarray(v_l), np.asarray(bv_l))


def accumulate(ra: np.ndarray, dec: np.ndarray, v: np.ndarray, bv: np.ndarray) -> np.ndarray:
    keep = v >= BRIGHT_LIMIT
    ra, dec, v, bv = ra[keep], dec[keep], v[keep], bv[keep]
    print(f"  {keep.sum():,} stars fainter than V={BRIGHT_LIMIT} contribute to the glow")

    flux = np.power(10.0, -0.4 * np.maximum(v, FLUX_CAP_MAG))
    rgb = bv_to_rgb(bv) * flux[:, None]

    x = np.clip((ra / 360.0 * WIDTH).astype(np.int64), 0, WIDTH - 1)
    y = np.clip(((90.0 - dec) / 180.0 * HEIGHT).astype(np.int64), 0, HEIGHT - 1)
    idx = y * WIDTH + x

    img = np.zeros((HEIGHT * WIDTH, 3), dtype=np.float64)
    for c in range(3):
        img[:, c] = np.bincount(idx, weights=rgb[:, c], minlength=HEIGHT * WIDTH)
    img = img.reshape(HEIGHT, WIDTH, 3)

    # Flux per pixel → surface brightness: divide by the pixel's solid angle ∝ cos(dec).
    row_dec = 90.0 - (np.arange(HEIGHT) + 0.5) / HEIGHT * 180.0
    cos_dec = np.maximum(np.cos(np.radians(row_dec)), math.cos(math.radians(89.5)))
    img /= cos_dec[:, None, None]
    return img


def gaussian_blur_wrapped(img: np.ndarray, sigma: float) -> np.ndarray:
    """Separable Gaussian blur via FFT. Circular in both axes, so the RA=0° seam is invisible;
    the pole-to-pole wrap in Dec is harmless because the poles are dim."""
    h, w = img.shape[:2]
    ky = np.exp(-0.5 * (np.minimum(np.arange(h), h - np.arange(h)) / sigma) ** 2)
    kx = np.exp(-0.5 * (np.minimum(np.arange(w), w - np.arange(w)) / sigma) ** 2)
    kernel = np.outer(ky, kx)
    kernel /= kernel.sum()
    k_hat = np.fft.rfft2(kernel)
    out = np.empty_like(img)
    for c in range(img.shape[2]):
        out[:, :, c] = np.fft.irfft2(np.fft.rfft2(img[:, :, c]) * k_hat, s=(h, w))
    return np.maximum(out, 0.0)


def smooth_and_tonemap(img: np.ndarray, sigma: float) -> Image.Image:
    out = gaussian_blur_wrapped(img, sigma)

    lum = out.mean(axis=2)
    floor = np.percentile(lum, 55)
    ref = np.percentile(lum, 99.8)
    print(f"  luminance percentiles: p20={floor:.3g}  p50={np.percentile(lum, 50):.3g}  "
          f"p90={np.percentile(lum, 90):.3g}  p99.7={ref:.3g}  max={lum.max():.3g}")

    norm = np.clip((out - floor) / (ref - floor), 0.0, 1.0)
    mapped = np.power(norm, GAMMA)
    return Image.fromarray((mapped * 255.0 + 0.5).astype(np.uint8), mode="RGB")


def main(argv: list[str] | None = None) -> int:
    import argparse

    global WIDTH, HEIGHT
    ap = argparse.ArgumentParser(description="Milky Way glow map from Tycho-2.")
    ap.add_argument("--width", type=int, default=WIDTH, help="map width in texels (height is half)")
    ap.add_argument("--sigma", type=float, default=BLUR_SIGMA_PX, help="Gaussian blur, texels")
    ap.add_argument("--quality", type=int, default=86, help="WebP quality")
    args = ap.parse_args(argv)
    WIDTH, HEIGHT = args.width, args.width // 2
    out = SKY_TEXTURES / f"milky-way-glow-{WIDTH}.webp"

    ensure_dirs()
    t0 = time.perf_counter()
    print("reading Tycho-2:")
    ra, dec, v, bv = read_tycho2()
    print(f"  {len(ra):,} stars read in {time.perf_counter() - t0:.1f} s")
    print(f"accumulating at {WIDTH}×{HEIGHT}:")
    img = accumulate(ra, dec, v, bv)
    print(f"smoothing (σ = {args.sigma} texels) and tone-mapping:")
    pic = smooth_and_tonemap(img, args.sigma)
    pic.save(out, "WEBP", quality=args.quality, method=6)
    print(f"→ {rel(out)}  {out.stat().st_size / 1024:.0f} KB  ({WIDTH}×{HEIGHT})  total {time.perf_counter() - t0:.1f} s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
