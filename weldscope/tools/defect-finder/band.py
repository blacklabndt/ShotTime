"""Weld band finder: split a plate into films, then follow the lighter (less radiation) ridge of the weld
along each film. Film convention in: more radiation = darker. Returns an unsure flag rather than guessing."""
import numpy as np, cv2
def _runs(sep, n):
    out = []; y = 0
    while y < n:
        if sep[y]: y += 1; continue
        y1 = y
        while y1 < n and not sep[y1]: y1 += 1
        if y1 - y > 0.12 * n or y1 - y > 120: out.append((y, y1))
        y = y1
    return out
def films(img):
    """Return (image turned so films run left-right, [(y0,y1,x0,x1)] per film, turned)."""
    hi = np.percentile(img, 99.5); gap = (img >= max(hi - 3, 250)) | (img <= 0)   # unexposed gap / padding
    rng = float(np.percentile(img, 99)) - float(np.percentile(img, 1)) + 1
    def seps(ax):                                                                 # also a thin light line between films
        r = np.median(img, axis=ax).astype(np.float32); n = len(r); k = max(5, int(n * 0.06)) | 1
        loc = cv2.medianBlur(r.reshape(-1, 1).astype(np.uint8), min(k, 255)).ravel().astype(np.float32)
        thin = (r - loc) > 0.3 * rng; thin[:int(n * 0.1)] = False; thin[int(n * 0.9):] = False
        return (gap.mean(ax) > 0.5) | thin
    rows = _runs(seps(1), img.shape[0]); cols = _runs(seps(0), img.shape[1])
    if len(cols) != len(rows): turned = len(cols) > len(rows)                     # the gap between films decides
    else: turned = img.shape[0] > img.shape[1]
    if turned: img = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE); rows = [(img.shape[0] - b, img.shape[0] - a) for a, b in cols][::-1]
    H, W = img.shape
    out = [(a, b, 0, W) for a, b in rows] or [(0, H, 0, W)]
    return img, out, turned
def profile_score(p, hmin, hmax, rough=None):
    """Best lighter band in a cross profile: (score, centre, half width). Score = band mean minus flank means, in MADs."""
    n = len(p); c = np.concatenate([[0], np.cumsum(p)]); best = (-9, 0, 0)
    rc = None if rough is None else np.concatenate([[0], np.cumsum(rough)])
    for h in np.unique(np.linspace(hmin, hmax, 10).astype(int)):
        f = max(3, h // 2)
        for y in range(h + f, n - h - f, 2):
            inside = (c[y + h] - c[y - h]) / (2 * h)
            a = (c[y - h] - c[y - h - f]) / f; b = (c[y + h + f] - c[y + h]) / f
            s = min(inside - a, inside - b)
            if rough is not None and (rc[y + h] - rc[y - h]) / (2 * h) > 0.35: continue
            if s > best[0]: best = (s, y, h)
    return best
def band(film, chunks=8):
    """film: 2-D uint8, long axis horizontal. Returns dict(top, bot polylines at chunk centres, xs, sure, score)."""
    H, W = film.shape; g = cv2.GaussianBlur(film.astype(np.float32), (0, 0), max(1, H * 0.01))
    m = int(H * 0.04); hmin, hmax = max(4, int(H * 0.03)), int(H * 0.22)
    ca, cb = int(W * 0.2), int(W * 0.8)                                   # film ends are often burn-off past the pipe
    whole = np.percentile(g[m:H - m, ca:cb], 30, axis=1)                       # 30th percentile ignores lead numbers
    hp = g - cv2.GaussianBlur(g, (0, 0), H * 0.05)                       # lead numbers: strong, sharp, lighter
    belt = (hp > 0.15 * (np.percentile(g, 99) - np.percentile(g, 1))).mean(1).astype(np.float32)
    rough = (cv2.GaussianBlur(belt.reshape(-1, 1), (0, 0), H * 0.015).ravel() > 0.08).astype(np.float32)[m:H - m]
    s0, y0, h0 = profile_score(whole, hmin, hmax, rough); y0 += m
    rng = np.percentile(g[m:H - m, ca:cb], 95) - np.percentile(g[m:H - m, ca:cb], 5) + 1e-3
    xs = []; top = []; bot = []; sc = []
    for i in range(chunks):
        a, b = W * i // chunks, W * (i + 1) // chunks
        lo, hi2 = max(m, y0 - 3 * h0), min(H - m, y0 + 3 * h0)          # stay near the whole-film ridge
        p = np.percentile(g[lo:hi2, a:b], 30, axis=1)
        s, y, h = profile_score(p, max(4, int(h0 * 0.7)), max(5, int(h0 * 1.4)))
        xs.append((a + b) // 2); top.append(lo + y - h); bot.append(lo + y + h); sc.append(s / rng)
    top = np.array(top, float); bot = np.array(bot, float); sc = np.array(sc)
    cen = (top + bot) / 2; med = np.median(cen)
    ok = (np.abs(cen - med) < 1.5 * h0) & (sc > 0.01)
    if ok.sum() >= 3:                                                   # replace stray chunks from their neighbours
        for arr in (top, bot): arr[~ok] = np.interp(np.array(xs)[~ok], np.array(xs)[ok], arr[ok])
    x = np.array(xs, float); c2 = (top + bot) / 2; fit = np.polyval(np.polyfit(x, c2, 1), x)
    straight = np.abs(c2 - fit).max() < 0.6 * h0 and np.ptp((bot - top)) < 1.2 * h0     # a weld band runs straight and even
    sure = (s0 / rng > 0.04) and ok.mean() >= 0.75 and straight
    pad = 0.5 * h0                                                      # margin: heat-affected zone, band slack
    return dict(xs=np.array(xs), top=np.clip(top - pad, 0, H), bot=np.clip(bot + pad, 0, H), rough=np.nonzero(rough)[0] + m, sure=bool(sure), score=float(s0 / rng), ok=float(ok.mean()))
def find(img):
    """Plate -> (turned image, [dict(rect, band)])."""
    im, fl, turned = films(img); out = []
    for (y0, y1, x0, x1) in fl: out.append(dict(rect=(y0, y1, x0, x1), band=band(im[y0:y1, x0:x1])))
    return im, out, turned
def draw(im, res):
    v = cv2.cvtColor(im, cv2.COLOR_GRAY2BGR)
    for r in res:
        y0, y1, x0, x1 = r['rect']; b = r['band']; col = (0, 220, 0) if b['sure'] else (0, 160, 255)
        cv2.rectangle(v, (x0, y0), (x1 - 1, y1 - 1), (255, 120, 0), 2)
        for arr in (b['top'], b['bot']):
            pts = np.stack([x0 + b['xs'], y0 + arr], 1).astype(np.int32); cv2.polylines(v, [pts], False, col, 3)
        for yy in b['rough']: cv2.line(v, (x0, y0 + int(yy)), (x0 + 25, y0 + int(yy)), (0, 0, 255), 1)
        cv2.putText(v, '%.3f %.2f' % (b['score'], b['ok']), (x0 + 8, y0 + 28), 0, 0.8, col, 2)
    return v
if __name__ == '__main__':
    import sys, json, random
    M = [json.loads(l) for l in open('tech/dcm_meta.jsonl')]; M = [m for m in M if m.get('png')]
    random.seed(int(sys.argv[1])); S = random.sample(M, 12); ts = []
    for m in S:
        im, res, _ = find(cv2.imread('tech/dcm/' + m['png'], 0)); v = draw(im, res); h, w = v.shape[:2]
        t = np.zeros((330, 600, 3), np.uint8); s = min(600 / w, 330 / h); r = cv2.resize(v, (int(w * s), int(h * s))); t[:r.shape[0], :r.shape[1]] = r; ts.append(t)
    cv2.imwrite('band/out%s.jpg' % sys.argv[1], np.vstack([np.hstack(ts[i:i + 3]) for i in range(0, 12, 3)]))
