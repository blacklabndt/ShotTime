"""Shared helpers for fitting the EDGE-style filter to INDUSTREX screenshots (see README.md here).
Inputs are the owner's real files and screenshots; they are never committed."""
import numpy as np, cv2
from PIL import Image

def load_raw(path, cols, rows):
    return np.fromfile(path, dtype='<u2').reshape(rows, cols).astype(np.float32)

def shot(path):
    """Screenshot as float grey (text is green, so the image area is where R==G==B)."""
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    grey = (np.abs(a[..., 0] - a[..., 1]) < 6) & (np.abs(a[..., 1] - a[..., 2]) < 6)
    return a.mean(axis=2), grey

def register(ref_small, target, mask=None, iters=300):
    """Affine warp mapping `target` (screenshot crop) coordinates onto ref_small; returns the 2x3 matrix."""
    n = lambda x: ((x - x.mean()) / (x.std() + 1e-6)).astype(np.float32)
    w = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, iters, 1e-7)
    _, w = cv2.findTransformECC(n(target), n(ref_small), w, cv2.MOTION_AFFINE, crit, mask, 5)
    return w
