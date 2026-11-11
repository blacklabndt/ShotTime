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
    const skip = ignore != null, use = v => !(skip && v === ignore);
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

  return { viewDims, toView, fromView, viewTransform, rectToView, rotate, flip, crop, invert, median, smooth, sharpen, fixBadPixels, stats, autoWindow, splitRegions, render };
});
