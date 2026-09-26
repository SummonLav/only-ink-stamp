#!/usr/bin/env python3
"""Behavioral checks for the rendering contract; no external fixtures needed."""
import numpy as np
from PIL import Image, ImageDraw
from stamp import render, settings

src = Image.new("RGBA", (256, 192), "white")
draw = ImageDraw.Draw(src)
draw.rounded_rectangle((40, 30, 215, 165), radius=25, fill="#227755")
draw.ellipse((100, 68, 155, 126), fill="white")
base = dict(size=256, seed=26, bleed=0, padding=0)
a, _ = render(src, base)
b, _ = render(src, base)
assert a.tobytes() == b.tobytes(), "Seed reproducibility"
arr = np.array(a)
assert a.mode == "RGBA" and arr[0, 0, 3] == 0, "Transparent background"
assert arr[96, 125, 3] == 0, "Original negative space preserved"
assert arr[50, 80, 3] > 0, "Foreground survives extraction"
z, _ = render(src, base | dict(density=0, edge=1))
assert np.max(np.array(z)[:, :, 3]) == 0, "Zero density clears pooled ink too"
low, _ = render(src, base | dict(density=.25))
high, _ = render(src, base | dict(density=.9))
assert np.array(high)[:, :, 3].sum() > np.array(low)[:, :, 3].sum(), "Density affects actual opacity"
plain = base | dict(density=.5, variation=0, grain=0, wear=0, edge=0)
flat, _ = render(src, plain)
varied, _ = render(src, plain | dict(variation=.9))
assert np.array(varied)[:, :, 3][50:60,70:90].std() > np.array(flat)[:, :, 3][50:60,70:90].std(), "Spatial pressure variation"
edged, _ = render(src, plain | dict(edge=1))
assert np.array(edged)[30, 80, 3] > np.array(flat)[30, 80, 3], "Edge pooling affects perimeter"
assert abs(int(np.array(edged)[52, 80, 3]) - int(np.array(flat)[52, 80, 3])) <= 1, "Edge control leaves interior alone"
uniform, _ = render(src, plain | dict(edge=1,edge_variation=0))
patchy, _ = render(src, plain | dict(edge=1,edge_variation=1))
assert uniform.tobytes() != patchy.tobytes(), "Local edge irregularity works"
red, _ = render(src, plain | dict(color="#dd3322"))
assert tuple(np.array(red)[50,80,:3]) == (221,51,34), "Selected pigment preserved"
crop, _ = render(src, base | dict(region=[0,0,.5,1]))
assert crop.size == (171,256), "Normalized source crop geometry"
tri, _ = render(src, base | dict(polygon=[[0,0],[1,0],[0,1]]))
assert np.array(tri)[150,200,3] == 0 and np.array(tri)[50,80,3] > 0, "Lasso clips shape"
clear = Image.new("RGBA", (50,50), (0,0,0,0))
ImageDraw.Draw(clear).rectangle((10,10,40,40),fill=(255,255,255,255))
cut, _ = render(clear, base | dict(mode="alpha"))
assert np.array(cut)[128,128,3] > 0 and np.array(cut)[0,0,3] == 0, "Alpha-only white artwork"
for bad in ({"region":[0,0,0,1]}, {"color":"bad"}, {"density":float('nan')}, {"polygon":[[0,0]]}):
    try: settings(bad)
    except ValueError: pass
    else: raise AssertionError("Invalid parameter accepted")
print("PASS: reproducibility, alpha, negative space, density, pressure, edge locality, edge variation, color, crop, lasso, input validation")
