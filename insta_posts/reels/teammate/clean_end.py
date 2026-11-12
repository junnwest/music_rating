"""Erase the sillajuku logo + CTA from a reel's last frame, leaving the smooth blurred-cover background.
The logo sits in the centre; everything around it is a soft gradient, so the box is filled by blending the
row-wise and column-wise interpolations between its edges, then feathered in."""
import sys
import numpy as np
from PIL import Image, ImageFilter

def clean(src, dst):
    im = Image.open(src).convert('RGB')
    a = np.asarray(im, dtype=np.float32)
    soft = np.asarray(im.filter(ImageFilter.GaussianBlur(40)), dtype=np.float32)
    diff = np.abs(a - soft).sum(axis=2)
    H, W = diff.shape
    ys, xs = np.nonzero(diff[300:1700, 100:980] > 40)
    if len(ys) == 0:
        im.save(dst); return
    y0, y1 = ys.min() + 300 - 50, ys.max() + 300 + 50
    x0, x1 = max(1, xs.min() + 100 - 60), min(W - 2, xs.max() + 100 + 60)
    left, right = a[y0:y1, x0 - 1], a[y0:y1, x1 + 1]
    top, bot = a[y0 - 1, x0:x1], a[y1 + 1, x0:x1]
    tx = np.linspace(0, 1, x1 - x0)[None, :, None]
    ty = np.linspace(0, 1, y1 - y0)[:, None, None]
    horiz = left[:, None, :] * (1 - tx) + right[:, None, :] * tx
    vert = top[None, :, :] * (1 - ty) + bot[None, :, :] * ty
    out = a.copy()
    out[y0:y1, x0:x1] = (horiz + vert) / 2
    res = Image.fromarray(out.clip(0, 255).astype(np.uint8))
    # feather: blur only the patched box (plus margin) and blend it back with a soft mask
    blurred = res.filter(ImageFilter.GaussianBlur(25))
    mask = Image.new('L', (W, H), 0)
    mask.paste(255, (x0 - 20, y0 - 20, x1 + 20, y1 + 20))
    mask = mask.filter(ImageFilter.GaussianBlur(30))
    Image.composite(blurred, res, mask).save(dst)

if __name__ == '__main__':
    clean(sys.argv[1], sys.argv[2])
