# Only Ink Stamp

**English** · [简体中文](README.zh-CN.md)

Turn a piece of an image into an ink stamp, with uneven pressure, pooled edges, and a little wear.

**Part of the Only series.** Only is a collection of small, playful tools. Each one does one thing: take a simple idea, make it fun to play with, and let you take the result with you. This one is all about ink stamps.

## Before → After

![Before and after: the SEPT. region selected in the original poster, beside the resulting green ink stamp](docs/images/comparison.png)

The outline on the original marks the selected area. The stamp on the right uses that area, with adjustable ink color, pressure variation, edge pooling, and worn patches.

[Original image](docs/images/source.jpg) · [Transparent stamp PNG](docs/images/stamp.png) · [Example settings](docs/examples/sept.json)

## What you can do

- **Pick a shape.** Use a rectangle, a freehand lasso, or precise selection coordinates.
- **Choose your ink.** Use a preset or custom color, or sample a color from the source to extract it.
- **Adjust the pressure.** Control overall ink density and uneven coverage independently.
- **Pool ink along the edges.** Adjust both the strength and the irregular distribution of darker edges.
- **Add a little imperfection.** Dial in grain, wear, and subtle bleed, or generate another impression.
- **Keep the result.** Export a transparent PNG, a paper preview, and reusable JSON settings.

A monochrome interface keeps the original and result side by side. Images are processed locally. No account or API key required.

## Run locally

Requires Python 3.10+. On macOS or Linux:

```sh
git clone https://github.com/SummonLav/only-ink-stamp.git
cd only-ink-stamp

python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
.venv/bin/python scripts/studio.py
```

Open the `STAMP_STUDIO_URL` printed in the terminal. The server picks an available port and starts with a built-in sample. Use the image picker, drag in an image, or paste one to begin.

On Windows, create the environment with `py -m venv .venv` and replace `.venv/bin/python` with `.venv\Scripts\python.exe` in subsequent commands.

To start with your own image:

```sh
.venv/bin/python scripts/studio.py \
  --input /path/to/image.png \
  --output-dir ./stamp-outputs
```

The PNG export downloads a transparent image. Saving a bundle writes the transparent image, paper preview, and settings to the output directory. Images uploaded through the studio are also saved with the bundle so you can use them again.

The studio controls currently use Chinese labels. This documentation is available in English and Chinese.

## Recreate the example

Open the example in the studio:

```sh
.venv/bin/python scripts/studio.py \
  --input docs/images/source.jpg \
  --preset docs/examples/sept.json
```

Or render it from the command line:

```sh
.venv/bin/python scripts/stamp.py docs/images/source.jpg \
  --preset docs/examples/sept.json \
  --output stamp-outputs/sept.png
```

This writes `sept.png`, `sept-paper.png`, and `sept.json`. The same input, settings, output size, and random seed produce the same result.

## Use as a Codex skill

The repository includes a reusable skill named **`$ink-stamp`**. Clone it into your skills directory:

```sh
git clone https://github.com/SummonLav/only-ink-stamp.git ~/.codex/skills/ink-stamp
```

Then describe what you want:

> Use $ink-stamp to turn the flower in this image into a dark blue stamp, with a lighter center, darker patches along the edges, and a little wear.

See [SKILL.md](SKILL.md) for the full workflow and parameter reference.

## Images and exports

- Automatic extraction works well with artwork on a light background. Use color extraction for multicolor collages, or preserve the alpha channel of transparent artwork.
- Photos are converted using brightness or color. Semantic subject removal is not included; use the lasso for complex backgrounds.
- Export size refers to the longest edge of the selected artwork, with an additional 8% transparent margin on each side. Previews render at up to 900 px, so grain details may differ slightly in larger exports.
- Transparent PNGs can be reused in posters, collages, or other designs.

## Checks

```sh
.venv/bin/python scripts/check_engine.py
```

The checks cover transparency, negative space, selections, ink density, edge pooling, color, and reproducible texture.
