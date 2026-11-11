/* Image operations on greyscale frames. An image is { rows, cols, frames: [TypedArray], min, max, ... }
   where min/max are the storable pixel range. Every operation returns a new image and leaves the input alone. */
'use strict';
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Imaging = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const like = (img, rows, cols, frames) => Object.assign({}, img, { rows, cols, frames });
  const blank = (a, n) => new a.constructor(n);
  const mapFrames = (img, fn) => like(img, img.rows, img.cols, img.frames.map(a => fn(a, img.cols, img.rows)));
  const clampRound = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : Math.round(v));

  function rotate(img, quarterTurnsCW) {
    const q = ((quarterTurnsCW % 4) + 4) % 4, w = img.cols, h = img.rows;
    if (q === 0) return like(img, h, w, img.frames.map(a => a.slice()));
    const nw = q === 2 ? w : h, nh = q === 2 ? h : w;
    return like(img, nh, nw, img.frames.map(a => {
      const o = blank(a, a.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let nx, ny;
        if (q === 1) { nx = h - 1 - y; ny = x; } else if (q === 2) { nx = w - 1 - x; ny = h - 1 - y; } else { nx = y; ny = w - 1 - x; }
        o[ny * nw + nx] = a[y * w + x];
      }
      return o;
    }));
  }

  function flip(img, horizontal) {
    return mapFrames(img, (a, w, h) => {
      const o = blank(a, a.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) o[y * w + x] = horizontal ? a[y * w + (w - 1 - x)] : a[(h - 1 - y) * w + x];
      return o;
    });
  }

  function crop(img, r) {
    const x = Math.max(0, Math.round(r.x)), y = Math.max(0, Math.round(r.y));
    const w = Math.min(img.cols - x, Math.round(r.w)), h = Math.min(img.rows - y, Math.round(r.h));
    if (w < 1 || h < 1) throw new Error('The crop area is outside the image.');
    return like(img, h, w, img.frames.map(a => {
      const o = blank(a, w * h);
      for (let j = 0; j < h; j++) o.set(a.subarray((y + j) * img.cols + x, (y + j) * img.cols + x + w), j * w);
      return o;
    }));
  }

  function invert(img) { const s = img.min + img.max; return mapFrames(img, a => a.map(v => s - v)); }

  // 3x3 median with edge replication.
  function median3Frame(a, w, h) {
    const o = blank(a, a.length), v = new Float64Array(9);
    for (let y = 0; y < h; y++) {
      const y0 = y > 0 ? y - 1 : 0, y2 = y < h - 1 ? y + 1 : h - 1;
      for (let x = 0; x < w; x++) {
        const x0 = x > 0 ? x - 1 : 0, x2 = x < w - 1 ? x + 1 : w - 1;
        let k = 0;
        for (const yy of [y0, y, y2]) { const r = yy * w; v[k++] = a[r + x0]; v[k++] = a[r + x]; v[k++] = a[r + x2]; }
        o[y * w + x] = med9(v);
      }
    }
    return o;
  }
  function med9(p) { // sorting network (Paeth); returns the middle value
    const s = (i, j) => { if (p[i] > p[j]) { const t = p[i]; p[i] = p[j]; p[j] = t; } };
    s(1, 2); s(4, 5); s(7, 8); s(0, 1); s(3, 4); s(6, 7); s(1, 2); s(4, 5); s(7, 8);
    s(0, 3); s(5, 8); s(4, 7); s(3, 6); s(1, 4); s(2, 5); s(4, 7); s(4, 2); s(6, 4); s(4, 2);
    return p[4];
  }
  function median(img) { return mapFrames(img, median3Frame); }

  function gaussianFrame(a, w, h, sigma) {
    const r = Math.max(1, Math.ceil(sigma * 3)), k = new Float64Array(2 * r + 1);
    let sum = 0; for (let i = -r; i <= r; i++) { k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma)); sum += k[i + r]; }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) { const row = y * w; for (let x = 0; x < w; x++) { let acc = 0; for (let i = -r; i <= r; i++) { const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i; acc += a[row + xx] * k[i + r]; } tmp[row + x] = acc; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let acc = 0; for (let i = -r; i <= r; i++) { const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i; acc += tmp[yy * w + x] * k[i + r]; } out[y * w + x] = acc; }
    return out;
  }
  function smooth(img, sigma) {
    if (!(sigma > 0)) throw new Error('Smoothing radius must be above zero.');
    return mapFrames(img, (a, w, h) => { const g = gaussianFrame(a, w, h, sigma), o = blank(a, a.length); for (let i = 0; i < a.length; i++) o[i] = clampRound(g[i], img.min, img.max); return o; });
  }
  function sharpen(img, sigma, amount) {
    if (!(sigma > 0) || !(amount > 0)) throw new Error('Sharpen radius and amount must be above zero.');
    return mapFrames(img, (a, w, h) => { const g = gaussianFrame(a, w, h, sigma), o = blank(a, a.length); for (let i = 0; i < a.length; i++) o[i] = clampRound(a[i] + amount * (a[i] - g[i]), img.min, img.max); return o; });
  }
  // Replaces isolated pixels that differ from their 3x3 median by more than `threshold` pixel values.
  function fixBadPixels(img, threshold) {
    let count = 0;
    const out = mapFrames(img, (a, w, h) => {
      const m = median3Frame(a, w, h), o = a.slice();
      for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - m[i]) > threshold) { o[i] = m[i]; count++; }
      return o;
    });
    out.fixedCount = count;
    return out;
  }

  // Histogram-based statistics of one frame (percentiles are approximate to 1/4096 of the range).
  // `ignore` (optional) is a value to leave out, such as the Pixel Padding Value outside the plate.
  function stats(a, ignore) {
    let lo = Infinity, hi = -Infinity, count = 0;
    const skip = ignore != null;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (skip && v === ignore) continue; count++; if (v < lo) lo = v; if (v > hi) hi = v; }
    if (!count) { lo = hi = skip ? ignore : 0; }
    const bins = 4096, hist = new Uint32Array(bins), span = hi - lo || 1;
    for (let i = 0; i < a.length; i++) { if (skip && a[i] === ignore) continue; hist[Math.min(bins - 1, Math.max(0, Math.floor(((a[i] - lo) / span) * bins)))]++; }
    const pct = p => { const target = p / 100 * count; let acc = 0; for (let b = 0; b < bins; b++) { acc += hist[b]; if (acc >= target) return lo + (b + 0.5) / bins * span; } return hi; };
    return { min: lo, max: hi, count, pct };
  }
  // Starting window for a radiograph. CR/DR plates often have unexposed areas, saturated edges, lead markers
  // and wires far from the useful exposure, so:
  //  1. a pile-up at either extreme (more than 5% of pixels within 0.5% of the range from an end) is left out;
  //  2. the main cluster is found around the histogram peak, stopping where bins stay below 0.5% of the peak
  //     for more than 2% of the range;
  //  3. the window spans the lowPct-highPct percentiles of that cluster.
  // `ignore` is a value to leave out entirely, such as the Pixel Padding Value.
  function autoWindow(a, slope = 1, intercept = 0, lowPct = 0.5, highPct = 99.8, ignore) {
    const skip = ignore != null, use = v => v === v && !(skip && v === ignore); // v === v drops NaN
    let mn = Infinity, mx = -Infinity, n = 0;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (!use(v)) continue; n++; if (v < mn) mn = v; if (v > mx) mx = v; }
    if (!n) return { center: (skip ? ignore : 0) * slope + intercept, width: 1 };
    const e = (mx - mn) * 0.005;
    let lowPile = 0, highPile = 0;
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (!use(v)) continue; if (v <= mn + e) lowPile++; else if (v >= mx - e) highPile++; }
    let lo = mn, hi = mx;
    if (e > 0 && lowPile > 0.05 * n) { let m = Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (use(v) && v > mn + e && v < m) m = v; } if (m !== Infinity) lo = m; }
    if (e > 0 && highPile > 0.05 * n) { let m = -Infinity; for (let i = 0; i < a.length; i++) { const v = a[i]; if (use(v) && v < mx - e && v > m) m = v; } if (m !== -Infinity) hi = m; }
    if (hi < lo) { lo = mn; hi = mx; }
    const B = 512, span = hi - lo || 1, h = new Float64Array(B);
    for (let i = 0; i < a.length; i++) { const v = a[i]; if (use(v) && v >= lo && v <= hi) h[Math.min(B - 1, Math.floor((v - lo) / span * B))]++; }
    let pk = 0; for (let i = 1; i < B; i++) if (h[i] > h[pk]) pk = i;
    const thr = h[pk] * 0.005, gapMax = Math.round(B * 0.02);
    let b0 = pk, b1 = pk;
    for (let i = pk - 1, g = 0; i >= 0; i--) { if (h[i] >= thr) { b0 = i; g = 0; } else if (++g > gapMax) break; }
    for (let i = pk + 1, g = 0; i < B; i++) { if (h[i] >= thr) { b1 = i; g = 0; } else if (++g > gapMax) break; }
    let tot = 0; for (let i = b0; i <= b1; i++) tot += h[i];
    const pct = p => { const t = p / 100 * tot; let acc = 0; for (let i = b0; i <= b1; i++) { acc += h[i]; if (acc >= t) return lo + (i + 0.5) / B * span; } return lo + (b1 + 1) / B * span; };
    let w0 = pct(lowPct) * slope + intercept, w1 = pct(highPct) * slope + intercept;
    if (w0 > w1) [w0, w1] = [w1, w0];
    const width = Math.max(1, w1 - w0);
    return { center: w0 + width / 2, width };
  }

  // Equal parts along one direction, each widened by `overlap` pixels where it meets a neighbour.
  function splitRegions(rows, cols, parts, direction, overlap = 0) {
    parts = Math.max(1, Math.min(50, Math.floor(parts)));
    const len = direction === 'rows' ? rows : cols, out = [];
    for (let i = 0; i < parts; i++) {
      const a = Math.max(0, Math.round(i * len / parts) - (i > 0 ? overlap : 0));
      const b = Math.min(len, Math.round((i + 1) * len / parts) + (i < parts - 1 ? overlap : 0));
      out.push(direction === 'rows' ? { x: 0, y: a, w: cols, h: b - a } : { x: a, y: 0, w: b - a, h: rows });
    }
    return out;
  }

  // 8-bit display values for one frame. Window applies to rescaled values; MONOCHROME1 displays inverted.
  function render(a, img, center, width, invertView, out) {
    const lo = center - width / 2, scale = 255 / Math.max(1e-9, width), slope = img.slope, icpt = img.intercept;
    const inv = (img.photometric === 'MONOCHROME1') !== !!invertView;
    const o = out || new Uint8ClampedArray(a.length * 4);
    const useLut = img.bitsAllocated <= 16;
    let lut = null, off = 0;
    if (useLut) {
      off = img.signed ? 2 ** (img.bitsAllocated - 1) : 0;
      lut = new Uint8Array(2 ** img.bitsAllocated);
      for (let i = 0; i < lut.length; i++) { const v = ((i - off) * slope + icpt - lo) * scale; const g = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); lut[i] = inv ? 255 - g : g; }
    }
    for (let i = 0, j = 0; i < a.length; i++, j += 4) {
      let g;
      if (lut) g = lut[a[i] + off];
      else { const v = (a[i] * slope + icpt - lo) * scale; g = v < 0 ? 0 : v > 255 ? 255 : Math.round(v); if (inv) g = 255 - g; }
      o[j] = o[j + 1] = o[j + 2] = g; o[j + 3] = 255;
    }
    return o;
  }

  // Box blur with edge clamping, O(n) per pass regardless of radius (running sums).
  function boxBlur(src, w, h, r) {
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h), k = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w; let acc = 0;
      for (let i = -r; i <= r; i++) acc += src[row + Math.min(w - 1, Math.max(0, i))];
      for (let x = 0; x < w; x++) {
        tmp[row + x] = acc / k;
        acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < w; x++) {
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += tmp[Math.min(h - 1, Math.max(0, i)) * w + x];
      for (let y = 0; y < h; y++) {
        out[y * w + x] = acc / k;
        acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
      }
    }
    return out;
  }

  // Replaces isolated specks on the bright side of the display (CR dust shows as white dots). `whiteSign` is
  // +1 when higher values display whiter (MONOCHROME2) and -1 for MONOCHROME1. Returns the number replaced.
  function despeckle(f, w, h, whiteSign, threshold) {
    const m = median3Frame(f, w, h); let count = 0;
    for (let i = 0; i < f.length; i++) if (whiteSign * (f[i] - m[i]) > threshold) { f[i] = m[i]; count++; }
    return count;
  }

  // EDGE-style display enhancement, after the Kodak CR approach of splitting an image into a large-scale
  // band (thickness changes) and detail bands, then rebalancing them. Carestream's EDGE algorithm is not
  // published; this is an approximation with controls of the same names.
  //   out = mean + kG·(L − mean) + kD·(M − L) + kS·(I − M)
  // I = input after optional noise reduction and despeckle, L = large-kernel blur (kernelPx), M = small blur.
  // At the default 1.0 settings kG = 0.5 (thickness latitude compressed), kD = 2.4 (detail raised) and
  // kS = 1.8 (fine edges raised); with a 20 mm kernel these gave the closest match to an INDUSTREX EDGE HD 1
  // screenshot of the owner's plate (correlation 0.55 → 0.69 overall, 0.33 → 0.46 for detail; sharpness
  // cannot be judged at screenshot zoom). kG = kD = kS = 1 returns the input unchanged.
  // detailLimit (pixel units) softly caps the detail band to limit halos. Returns Float32Array in pixel-value
  // units; padding pixels (value `padding`) become NaN.
  function edgeEnhance(a, w, h, o = {}) {
    const gc = o.globalContrast ?? 1, dc = o.detailContrast ?? 1, sh = o.sharpness ?? 1, nr = Math.max(0, Math.min(1, o.noiseReduction ?? 0));
    const r = Math.max(1, Math.round((o.kernelPx ?? 60) / 2)), pad = o.padding, n = w * h;
    const src = new Float32Array(n);
    let sum = 0, cnt = 0;
    for (let i = 0; i < n; i++) { const v = a[i]; src[i] = v; if (pad == null || v !== pad) { sum += v; cnt++; } }
    const mean = cnt ? sum / cnt : 0;
    if (pad != null) for (let i = 0; i < n; i++) if (a[i] === pad) src[i] = mean; // keep padding from dragging the blurs
    let specks = 0;
    if (o.despeckle && o.despeckleThreshold > 0) specks = despeckle(src, w, h, o.whiteSign || 1, o.despeckleThreshold);
    let I = src;
    if (nr > 0) { const g = gaussianFrame(src, w, h, 1); I = new Float32Array(n); for (let i = 0; i < n; i++) I[i] = src[i] + nr * (g[i] - src[i]); }
    const L = boxBlur(boxBlur(I, w, h, r), w, h, r); // two box passes ≈ a smooth kernel about kernelPx wide
    const M = gaussianFrame(I, w, h, 1.5);
    const kG = o.kG ?? 0.5 * gc, kD = o.kD ?? 2.4 * dc, kS = o.kS ?? 1 + 0.8 * sh;
    // Optional soft limit on the detail band: ordinary detail passes almost unchanged, but the huge swings
    // next to very bright or dark objects (wires, markers, plate edges) are capped, which keeps halos small.
    const T = o.detailLimit > 0 ? o.detailLimit : 0;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (pad != null && a[i] === pad) { out[i] = NaN; continue; }
      let d = M[i] - L[i];
      if (T) d = d / (1 + Math.abs(d) / T);
      out[i] = mean + kG * (L[i] - mean) + kD * d + kS * (I[i] - M[i]);
    }
    out.specks = specks;
    return out;
  }

  // Finds separate pieces of film or plate in a scan. Areas with no film/plate read as background, which on
  // CR/DR data is near the low end of the values (or the Pixel Padding Value). The image is cut recursively
  // ("XY-cut") wherever a band averages close to background along a straight line across the whole piece.
  // Lines may tilt up to maxTiltDeg (plates are rarely placed perfectly square), so each cut records its line,
  // and each piece is trimmed to its own edges. The search runs on a 4× reduced copy for speed.
  //   opts.sensitivity 0..1 (default 0.6): how far a band may sit above background and still count as a gap
  //   opts.minSize (px, default 2% of the shorter side, at least 16): smaller pieces are ignored
  //   opts.margin (px, default 0): grow (+) or shrink (−) each piece's rectangle
  //   opts.maxTiltDeg (default 2), opts.padding (Pixel Padding Value, counted as background)
  // Returns [{ x, y, w, h, cuts }] in image pixels. Each cut is { axis, a, k, keep } describing a dividing line
  // inside the piece's rectangle: for axis 'x' the line is x = a + k·y, for 'y' it is y = a + k·x, and the piece
  // is on the side keep ('<' or '>'). Pixels on the other side belong to a neighbouring piece.
  function findPieces(a, w, h, opts = {}) {
    const pad = opts.padding;
    const st = stats(a, pad);
    if (!st.count) return [];
    let edgeSum = 0, edgeN = 0; const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
    for (let x = 0; x < w; x += step) { edgeSum += a[x] + a[(h - 1) * w + x]; edgeN += 2; }
    for (let y = 0; y < h; y += step) { edgeSum += a[y * w] + a[y * w + w - 1]; edgeN += 2; }
    const sign = edgeSum / edgeN > st.pct(90) ? -1 : 1; // background normally low; flip if the border sits near the top
    let bg = sign * (sign > 0 ? st.pct(0.1) : st.pct(99.9));
    const base = sign * st.pct(50);
    // Padding means "no data": when the scan has padding pixels, their value is the background level.
    if (pad != null) { let hasPad = false; for (let i = 0; i < a.length && !hasPad; i += 7) if (a[i] === pad) hasPad = true; if (hasPad) bg = Math.min(bg, sign * pad); }
    const sens = Math.max(0.05, Math.min(0.95, opts.sensitivity ?? 0.6));
    // A position is a gap when its line average is near background (25%–65% of the way up to the typical
    // plate level, by sensitivity), or when it is a narrow valley well below the plate on both sides
    // (deeper than 60%–20% of the plate-to-background difference), as with the thin line between two strips.
    const thr = bg + (0.25 + 0.4 * sens) * (base - bg), rel = 0.6 - 0.4 * sens;
    const minSize = Math.max(16, Math.round(opts.minSize ?? 0.02 * Math.min(w, h)));
    const maxK = Math.tan((opts.maxTiltDeg ?? 2) * Math.PI / 180);
    const inside = (cuts, x, y) => cuts.every(c => { const t = c.axis === 'x' ? x - (c.a + c.k * y) : y - (c.a + c.k * x); return c.keep === '<' ? t < 0 : t >= 0; });
    // Signal image (background low), computed once; padding counts as background.
    const S = new Float32Array(w * h);
    for (let i = 0; i < S.length; i++) { const v = a[i]; S[i] = pad != null && v === pad ? bg : sign * v; }
    // How much the plate itself varies (interquartile range of plate pixels). A gap must dip well beyond this,
    // so a weld band or thickness change is never taken for a gap, even when the scan has no background at all
    // (then the "background" estimate above comes from the plate itself).
    const sample = []; const sstep = Math.max(1, Math.floor(S.length / 200000));
    for (let i = 0; i < S.length; i += sstep) if (S[i] >= thr) sample.push(S[i]);
    sample.sort((x, y) => x - y);
    const iqr = sample.length ? sample[Math.floor(sample.length * 0.75)] - sample[Math.floor(sample.length * 0.25)] : 0;
    const minDip = 6 * iqr;
    // Mean along lines through rectangle r whose position along `axis` drifts by `drift` pixels across it.
    function profile(r, cuts, axis, drift) {
      const len = axis === 'x' ? r.w : r.h, other = axis === 'x' ? r.h : r.w, p = new Float64Array(len), cnt = new Float64Array(len);
      const ostep = Math.max(1, Math.floor(other / 250)), k = other > 1 ? drift / (other - 1) : 0, hasCuts = cuts.length > 0;
      for (let o = 0; o < other; o += ostep) {
        const shift = Math.round(k * o);
        const u0 = Math.max(0, -shift), u1 = Math.min(len, len - shift);
        if (axis === 'x') {
          const y = r.y + o, row = y * w + r.x;
          for (let u = u0; u < u1; u++) { const t = u + shift; if (hasCuts && !inside(cuts, r.x + t, y)) continue; p[u] += S[row + t]; cnt[u]++; }
        } else {
          const x = r.x + o;
          // pixels across a dividing line belong to the neighbour: leave them out rather than count them as background
          for (let u = u0; u < u1; u++) { const t = u + shift, y = r.y + t; if (hasCuts && !inside(cuts, x, y)) continue; p[u] += S[y * w + x]; cnt[u]++; }
        }
      }
      for (let u = 0; u < len; u++) p[u] = cnt[u] ? p[u] / cnt[u] : bg;
      return p;
    }
    function gaps(p) {
      const n = p.length, g = new Uint8Array(n), L = Math.max(minSize, 24);
      // local plate level: a high percentile of the profile around each position
      const lvl = new Float64Array(n), win = [];
      for (let i = 0; i < n; i += 4) {
        win.length = 0; for (let j = Math.max(0, i - L); j < Math.min(n, i + L); j++) win.push(p[j]);
        win.sort((x, y) => x - y); const v = win[Math.floor(win.length * 0.8)];
        for (let q = i; q < Math.min(n, i + 4); q++) lvl[q] = v;
      }
      // Broad gaps: near background and well below the typical plate level. Narrow gaps (a thin line between
      // strips): well below the plate on either side. Both must dip beyond the plate's own variation.
      for (let i = 0; i < n; i++) {
        const dip = lvl[i] - p[i];
        g[i] = (p[i] < thr && base - p[i] > minDip) || (dip > minDip && dip > rel * (lvl[i] - bg)) ? 1 : 0;
      }
      return g;
    }
    function runs(p) {
      const g = gaps(p), out = []; let s0 = -1;
      for (let i = 0; i <= p.length; i++) {
        const sig = i < p.length && !g[i];
        if (sig && s0 < 0) s0 = i;
        if (!sig && s0 >= 0) { if (i - s0 >= minSize) out.push([s0, i]); s0 = -1; }
      }
      return out;
    }
    // Deepest interior valley (relative to the profile's own plate level) for a drift; the drift that best
    // follows a dividing line dips deepest. Coarse steps of 8 px, then 1 px around the best.
    function valley(p) {
      let lo = 0, hi = p.length - 1;
      while (lo < hi && p[lo] < thr) lo++; while (hi > lo && p[hi] < thr) hi--;
      lo += minSize; hi -= minSize; let m = Infinity;
      for (let i = lo; i <= hi; i++) m = Math.min(m, p[i]);
      return m;
    }
    function bestDrift(r, cuts, axis) {
      const other = axis === 'x' ? r.h : r.w, maxD = Math.round(maxK * other);
      let best = 0, bv = valley(profile(r, cuts, axis, 0));
      const tryD = d => { const v = valley(profile(r, cuts, axis, d)); if (v < bv - 1e-9) { bv = v; best = d; } };
      for (let d = -maxD; d <= maxD; d += 8) if (d) tryD(d);
      const c = best; for (let d = c - 7; d <= c + 7; d++) if (d !== c && Math.abs(d) <= maxD) tryD(d);
      return best;
    }
    const pieces = [];
    (function cut(r, cuts, depth) {
      let cur = r;
      // Look along both axes first and cut along the cleanest gap (closest to background), so a gap that only
      // separates some pieces (e.g. two side by side above one wide piece) is not used to cut through another.
      if (depth < 6) {
        const options = [];
        for (const axis of ['x', 'y']) {
          const other = axis === 'x' ? cur.h : cur.w;
          const drift = bestDrift(cur, cuts, axis);
          let p = profile(cur, cuts, axis, drift), rs = runs(p), used = drift;
          if (rs.length < 2 && drift) { p = profile(cur, cuts, axis, 0); rs = runs(p); used = 0; }
          if (rs.length >= 2) {
            let gapMin = Infinity; for (let i = rs[0][1]; i < rs[rs.length - 1][0]; i++) gapMin = Math.min(gapMin, p[i]);
            options.push({ axis, rs, used, other, depth: (gapMin - bg) / Math.max(1e-9, base - bg) });
          }
        }
        if (options.length) {
          const { axis, rs, used, other } = options.sort((a, b) => a.depth - b.depth)[0];
          const len = axis === 'x' ? cur.w : cur.h, k = other > 1 ? used / (other - 1) : 0;
          rs.forEach(([s0, s1], i) => {
            // offset u at o = 0, drifting by k per step along the other axis: x = cur.x + u + k·(y − cur.y)
            const line = u => (axis === 'x' ? { axis, a: cur.x + u - k * cur.y, k } : { axis, a: cur.y + u - k * cur.x, k });
            const nc = cuts.slice();
            if (i > 0) nc.push(Object.assign(line((rs[i - 1][1] + s0) / 2), { keep: '>' }));
            if (i < rs.length - 1) nc.push(Object.assign(line((s1 + rs[i + 1][0]) / 2), { keep: '<' }));
            // Each part reaches to the middle of the gaps around it (or the region edge); trimming then finds
            // its exact edges, even where a neighbour narrowed the band this cut was based on.
            const from = i > 0 ? (rs[i - 1][1] + s0) / 2 : 0, to = i < rs.length - 1 ? (s1 + rs[i + 1][0]) / 2 : len;
            const lo = from + Math.min(0, used), hi = to + Math.max(0, used);
            const a0 = Math.max(0, Math.floor(lo)), a1 = Math.min(len, Math.ceil(hi));
            cut(axis === 'x' ? { x: cur.x + a0, y: cur.y, w: a1 - a0, h: cur.h } : { x: cur.x, y: cur.y + a0, w: cur.w, h: a1 - a0 }, nc, depth + 1);
          });
          return;
        }
      }
      // No split: trim to the piece's own edges (twice, as trimming one axis can reveal background on the other).
      for (let pass = 0; pass < 2; pass++) {
        for (const axis of ['x', 'y']) {
          const rs = runs(profile(cur, cuts, axis, 0));
          if (!rs.length) return;
          const s0 = rs[0][0], s1 = rs[rs.length - 1][1];
          cur = axis === 'x' ? { x: cur.x + s0, y: cur.y, w: s1 - s0, h: cur.h } : { x: cur.x, y: cur.y + s0, w: cur.w, h: s1 - s0 };
        }
      }
      pieces.push({ r: cur, cuts });
    })({ x: 0, y: 0, w, h }, [], 0);
    const m = Math.round(opts.margin || 0);
    return pieces.map(({ r, cuts }) => {
      const x0 = Math.max(0, r.x - m), y0 = Math.max(0, r.y - m), x1 = Math.min(w, r.x + r.w + m), y1 = Math.min(h, r.y + r.h + m);
      const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      rect.cuts = cuts.filter(c => {
        const span = c.axis === 'x' ? [c.a + c.k * rect.y, c.a + c.k * (rect.y + rect.h)] : [c.a + c.k * rect.x, c.a + c.k * (rect.x + rect.w)];
        const lo = c.axis === 'x' ? rect.x : rect.y, hi = lo + (c.axis === 'x' ? rect.w : rect.h);
        return Math.max(span[0], span[1]) > lo && Math.min(span[0], span[1]) < hi;
      });
      return rect;
    }).filter(r => r.w >= minSize && r.h >= minSize);
  }
  // Which way "less radiation" goes: towards the no-signal (background) level. On raw CR/DR data that is low
  // values (+1); if the image border sits near the top of the range it is high (-1). Plate scratches and dust
  // read as less radiation; cracks, lack of fusion, porosity and undercut read as more radiation.
  function lessRadiationSign(a, w, h, pad) {
    const st = stats(a, pad); let sum = 0, n = 0; const step = Math.max(1, Math.floor(Math.min(w, h) / 200));
    for (let x = 0; x < w; x += step) { sum += a[x] + a[(h - 1) * w + x]; n += 2; }
    for (let y = 0; y < h; y += step) { sum += a[y * w] + a[y * w + w - 1]; n += 2; }
    return sum / n > st.pct(90) ? -1 : 1;
  }

  // Pixel noise of a frame: robust spread of each pixel's difference from the mean of its left/right neighbours.
  function noiseLevel(a, w, h, pad) {
    const d = []; const step = Math.max(1, Math.floor((w * h) / 200000));
    for (let i = w + 1; i < w * h - w - 1; i += step) {
      const x = i % w; if (x < 1 || x > w - 2) continue;
      if (pad != null && (a[i] === pad || a[i - 1] === pad || a[i + 1] === pad)) continue;
      d.push(Math.abs(a[i] - (a[i - 1] + a[i + 1]) / 2));
    }
    d.sort((p, q) => p - q);
    return d.length ? Math.max(1, 1.4826 * d[d.length >> 1] / Math.sqrt(1.5)) : 1;
  }

  // Repairs a thin scratch along a drawn segment { x0, y0, x1, y1 }. At each step along the segment, pixels
  // across it (within ±band) are examined: a run at most maxWidth wide that is darker-in-radiation terms
  // ("less radiation", `sign`) than the plate on BOTH sides by more than 4× the local noise is replaced by a
  // straight interpolation between the two sides. Features reading as more radiation (cracks, voids) and plain
  // edges (a step with one side unchanged) are never changed. Returns { frame, count } (a new array).
  function repairScratch(a, w, h, seg, o = {}) {
    const out = a.slice(), B = Math.max(4, Math.round(o.band ?? 8)), maxW = Math.max(1, Math.round(o.maxWidth ?? 9));
    const sign = o.sign || 1, lo = o.min ?? -Infinity, hi = o.max ?? Infinity, pad = o.padding;
    const dx = seg.x1 - seg.x0, dy = seg.y1 - seg.y0, vertical = Math.abs(dy) >= Math.abs(dx);
    const len = Math.max(1, Math.round(Math.max(Math.abs(dx), Math.abs(dy))));
    const half = Math.ceil(maxW / 2) + 1, vals = new Float64Array(2 * B + 1), idx = new Int32Array(2 * B + 1);
    const med = arr => { const c = arr.slice().sort((p, q) => p - q); return c.length ? c[c.length >> 1] : NaN; };
    let count = 0;
    for (let i = 0; i <= len; i++) {
      const cx = Math.round(seg.x0 + dx * i / len), cy = Math.round(seg.y0 + dy * i / len);
      let ok = true;
      for (let d = -B; d <= B; d++) {
        const x = vertical ? cx + d : cx, y = vertical ? cy : cy + d;
        if (x < 0 || y < 0 || x >= w || y >= h) { ok = false; break; }
        idx[d + B] = y * w + x; vals[d + B] = sign * a[y * w + x];
        if (pad != null && a[y * w + x] === pad) { ok = false; break; }
      }
      if (!ok) continue;
      const left = [], right = [];
      for (let d = half; d <= B; d++) { left.push(vals[B - d]); right.push(vals[B + d]); }
      const mL = med(left), mR = med(right), ref = Math.min(mL, mR);
      const noise = o.noise > 0 ? o.noise : 1.4826 * med(left.concat(right).map(v => Math.abs(v - med(left.concat(right))))) || 1;
      const thr = Math.max(o.minContrast || 0, 4 * noise);
      // Never repair next to a feature reading as more radiation (a crack, void or undercut): leave the spot alone.
      let brighter = false;
      for (let d = -B; d <= B && !brighter; d++) if (vals[B + d] - Math.max(mL, mR) > thr) brighter = true;
      if (brighter) continue;
      // deepest point near the centre, then the run around it
      let c = 0, best = -Infinity;
      for (let d = -half + 1; d < half; d++) { const depth = ref - vals[B + d]; if (depth > best) { best = depth; c = d; } }
      if (best <= thr) continue;
      let l = c, r = c;
      while (l - 1 > -half && ref - vals[B + l - 1] > thr * 0.5) l--;
      while (r + 1 < half && ref - vals[B + r + 1] > thr * 0.5) r++;
      if (r - l + 1 > maxW) continue;
      const vl = sign * (vals[B + l - 1] + vals[B + l - 2]) / 2, vr = sign * (vals[B + r + 1] + vals[B + r + 2]) / 2;
      for (let d = l; d <= r; d++) {
        const t = (d - l + 1) / (r - l + 2), v = vl + (vr - vl) * t;
        out[idx[B + d]] = Math.min(hi, Math.max(lo, Math.round(v)));
        count++;
      }
    }
    return { frame: out, count };
  }

  // Finds long, straight, thin scratches (such as scanner roller scratches along a plate), up to maxTiltDeg from
  // vertical or horizontal. A pixel is "line-like" when it reads as less radiation than the plate on both sides
  // (3–8 px away) by more than 4× the image's noise. Rows are grouped into blocks; a line is reported where
  // line-like pixels follow one straight path through at least minCoverage of the blocks it spans and the line
  // is at least minLength long. Dips going most of the way to background (the gap between two pieces) are
  // left alone. IQI wires and markers are far shorter than minLength. Returns [{ x0, y0, x1, y1, coverage }].
  function findScratches(a, w, h, o = {}) {
    const pad = o.padding, sign = o.sign || lessRadiationSign(a, w, h, pad);
    const st = stats(a, pad), bgLevel = sign > 0 ? st.pct(0.1) : st.pct(99.9), base = st.pct(50);
    const minLen = o.minLength ?? Math.round(0.5 * Math.max(w, h)), minCov = o.minCoverage ?? 0.6;
    const maxK = Math.tan((o.maxTiltDeg ?? 2) * Math.PI / 180);
    const found = [];
    for (const vertical of [true, false]) {
      const W = vertical ? w : h, H = vertical ? h : w; // scan lines run along H
      const get = (x, y) => (vertical ? a[y * w + x] : a[x * w + y]);
      // valley strength per pixel: how far below the lower of its two sides (in "less radiation" units)
      const S = new Float32Array(W * H), cs = new Float64Array(W + 1), plateMin = sign * bgLevel + 0.5 * (sign * base - sign * bgLevel);
      for (let y = 0; y < H; y++) {
        cs[0] = 0; for (let x = 0; x < W; x++) cs[x + 1] = cs[x] + sign * get(x, y);
        for (let x = 8; x < W - 8; x++) {
          const v = sign * get(x, y), L = (cs[x - 2] - cs[x - 8]) / 6, R = (cs[x + 9] - cs[x + 3]) / 6;
          // only on plate: both sides well above background (excludes plate edges and unexposed areas)
          const pv = get(x, y); S[y * W + x] = (pad != null && pv === pad) || Math.min(L, R) < plateMin ? 0 : Math.min(L, R) - v;
        }
      }
      const sample = []; for (let i = 0; i < S.length; i += 97) sample.push(Math.abs(S[i]));
      sample.sort((p, q) => p - q);
      // at least 4× the noise and 1.5% of the plate-to-background range (smooth CR data has very little noise)
      const noise = Math.max(1, 1.4826 * sample[sample.length >> 1]), thr = Math.max(4 * noise, 0.015 * Math.abs(base - bgLevel));
      const BL = 32, nb = Math.floor(H / BL);
      if (nb < 2) continue;
      // per block, per column: fraction of rows where the pixel (or a neighbour) is line-like
      const C = new Float32Array(nb * W);
      for (let b = 0; b < nb; b++) for (let y = b * BL; y < (b + 1) * BL; y++) for (let x = 9; x < W - 9; x++) {
        const i = y * W + x; if (S[i] > thr || S[i - 1] > thr || S[i + 1] > thr) C[b * W + x] += 1 / BL;
      }
      const maxD = Math.round(maxK * H), cand = [];
      for (let d = -maxD; d <= maxD; d += 2) {
        for (let x0 = 9; x0 < W - 9; x0++) {
          let hit = 0, first = -1, last = -1;
          for (let b = 0; b < nb; b++) {
            const x = Math.round(x0 + d * ((b + 0.5) * BL) / H);
            if (x < 9 || x >= W - 9) continue;
            if (C[b * W + x] >= 0.5) { hit++; if (first < 0) first = b; last = b; }
          }
          if (first < 0) continue;
          const span = last - first + 1, cov = hit / span;
          if (span * BL >= minLen && cov >= minCov) cand.push({ x0, d, first, last, cov, score: hit });
        }
      }
      // keep the strongest of nearby candidates (same scratch seen at neighbouring columns or tilts)
      cand.sort((p, q) => q.score - p.score || q.cov - p.cov);
      const kept = [];
      for (const c of cand) {
        const xm = c.x0 + c.d / 2;
        if (kept.some(k => Math.abs(k.x0 + k.d / 2 - xm) < 8)) continue;
        // skip gaps between pieces: along most of its length the line drops below 60% of the way from background
        // to the plate level (the thin gap between two strips does; a phosphor scratch does not)
        let gapLike = 0, n = 0;
        for (let y = c.first * BL; y < (c.last + 1) * BL; y += 7) {
          const x = Math.round(c.x0 + c.d * y / H); if (x < 4 || x >= W - 4) continue;
          let m = Infinity; for (let q = -4; q <= 4; q++) m = Math.min(m, sign * get(x + q, y));
          if (m - sign * bgLevel < 0.6 * (sign * base - sign * bgLevel)) gapLike++;
          n++;
        }
        if (!n || gapLike / n > 0.5) continue;
        kept.push(c);
      }
      for (const c of kept) {
        const y0 = c.first * BL, y1 = (c.last + 1) * BL - 1, xa = c.x0 + c.d * y0 / H, xb = c.x0 + c.d * y1 / H;
        found.push(vertical ? { x0: xa, y0, x1: xb, y1, coverage: +c.cov.toFixed(2) } : { x0: y0, y0: xa, x1: y1, y1: xb, coverage: +c.cov.toFixed(2) });
      }
    }
    return found;
  }

  // Sets pixels of a cropped piece that lie across its dividing lines (in a neighbouring piece) to `fill`.
  // `rect` is the piece rectangle the frame was cropped to; returns the number of pixels filled.
  function fillOutsideCuts(frame, rect, fill) {
    let count = 0;
    if (!rect.cuts || !rect.cuts.length) return 0;
    for (let y = 0; y < rect.h; y++) for (let x = 0; x < rect.w; x++) {
      const X = rect.x + x, Y = rect.y + y;
      const ok = rect.cuts.every(c => { const t = c.axis === 'x' ? X - (c.a + c.k * Y) : Y - (c.a + c.k * X); return c.keep === '<' ? t < 0 : t >= 0; });
      if (!ok) { frame[y * rect.w + x] = fill; count++; }
    }
    return count;
  }

  // Display-only view rotation (0/90/180/270° clockwise). Maps image pixel coordinates to the rotated
  // frame and back; W = columns, H = rows of the unrotated image.
  const viewDims = (cols, rows, rot) => (rot % 180 ? { w: rows, h: cols } : { w: cols, h: rows });
  function toView(x, y, cols, rows, rot) {
    switch (rot) { case 90: return { x: rows - y, y: x }; case 180: return { x: cols - x, y: rows - y }; case 270: return { x: y, y: cols - x }; default: return { x, y }; }
  }
  function fromView(x, y, cols, rows, rot) {
    switch (rot) { case 90: return { x: y, y: rows - x }; case 180: return { x: cols - x, y: rows - y }; case 270: return { x: cols - y, y: x }; default: return { x, y }; }
  }
  // Canvas transform that draws an unrotated image (at 0,0) in the rotated frame.
  function viewTransform(ctx, cols, rows, rot) {
    if (rot === 90) { ctx.translate(rows, 0); ctx.rotate(Math.PI / 2); }
    else if (rot === 180) { ctx.translate(cols, rows); ctx.rotate(Math.PI); }
    else if (rot === 270) { ctx.translate(0, cols); ctx.rotate(-Math.PI / 2); }
  }
  // Axis-aligned rectangle of an image-space box in the rotated frame.
  function rectToView(r, cols, rows, rot) {
    const a = toView(r.x, r.y, cols, rows, rot), b = toView(r.x + r.w, r.y + r.h, cols, rows, rot);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
  }

  return { noiseLevel, lessRadiationSign, repairScratch, findScratches, findPieces, fillOutsideCuts, boxBlur, despeckle, edgeEnhance, viewDims, toView, fromView, viewTransform, rectToView, rotate, flip, crop, invert, median, smooth, sharpen, fixBadPixels, stats, autoWindow, splitRegions, render };
});
