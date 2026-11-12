#!/usr/bin/env python3
"""Renders the digit templates WeldScope uses to read lead location numbers (core/src/marker_digits.bin).

Templates come from a font only (DejaVu Sans, the family the app already ships as Hack's parent), never from
anyone's radiographs. Layout: fonts x 10 digits x 28 rows x 20 columns, one byte per pixel.
Usage: python3 tools/digit-templates/make.py   (needs Pillow and the DejaVu fonts)"""
import os, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
TW, TH = 20, 28
FONTS = ['/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']
out = bytearray()
for path in FONTS:
    font = ImageFont.truetype(path, 80)
    for digit in '0123456789':
        im = Image.new('L', (160, 140), 0)
        ImageDraw.Draw(im).text((30, 10), digit, 255, font=font)
        im = im.crop(im.point(lambda v: 255 if v > 128 else 0).getbbox())
        if digit == '1':   # keep the 1 narrow: centre it in a typical digit box
            w = int(im.height * 0.6)
            if w > im.width:
                wide = Image.new('L', (w, im.height), 0); wide.paste(im, ((w - im.width) // 2, 0)); im = wide
        im = im.resize((TW, TH), Image.BOX).filter(ImageFilter.GaussianBlur(1.2))
        out += im.tobytes()
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'core', 'src', 'marker_digits.bin')
open(dst, 'wb').write(out)
print(len(FONTS), 'fonts,', len(out), 'bytes ->', os.path.normpath(dst))
