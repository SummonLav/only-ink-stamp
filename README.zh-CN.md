# Only Ink Stamp

[English](README.md) · **简体中文**

把图片里喜欢的一块，变成一枚有深浅、有颗粒的油墨印章。

**Only Ink Stamp 属于 Only 系列。** Only 是一组小而好玩、每个只专注一件事的工具：把一个简单的想法做成可以随手打开、动手调节、带走结果的小玩具。这一件，只玩印章。

## 原图 → 印章

![原图与印章效果对比：左侧标出海报中的 SEPT. 选区，右侧为绿色油墨印章](docs/images/comparison.png)

左侧是原图，框线标出选区；右侧是从该区域提取的印章。油墨颜色、深浅起伏、局部边缘积墨和露白都可以调整。

[查看原图](docs/images/source.jpg) · [下载透明印章 PNG](docs/images/stamp.png) · [示例参数](docs/examples/sept.json)

## 可以怎么玩

- **选一块图案**：矩形框选、自由套索，或输入精确选区。
- **选一种印色**：预设颜色、自选颜色，也能从原图吸色提取单一颜色。
- **调落印轻重**：整体深浅、局部深浅起伏分别调节。
- **让边缘积墨**：边缘加深强度和局部分布独立控制。
- **留一点不完美**：颗粒、露白磨损、轻微洇墨，以及随机换一次落印。
- **带走结果**：透明 PNG、纸张预览和可再次载入的 JSON 参数。

界面采用黑白配色，原图与结果并排显示。图片处理在本机完成，无需账号或 API Key。

## 本地运行

需要 Python 3.10+。下面的命令适用于 macOS / Linux：

```sh
git clone https://github.com/SummonLav/only-ink-stamp.git
cd only-ink-stamp

python3 -m venv .venv
.venv/bin/python -m pip install -r scripts/requirements.txt
.venv/bin/python scripts/studio.py
```

在浏览器中打开终端输出的 `STAMP_STUDIO_URL`。程序会自动选择空闲端口，默认载入内置演示图；点击「更换图片」、拖入图片或直接粘贴即可开始。

Windows 下使用 `py -m venv .venv` 创建环境，并把后续的 `.venv/bin/python` 替换为 `.venv\Scripts\python.exe`。

也可以直接载入自己的图片：

```sh
.venv/bin/python scripts/studio.py \
  --input /path/to/image.png \
  --output-dir ./stamp-outputs
```

「导出 PNG」下载透明图片；「保存套装」将透明图、纸张预览和参数文件写入输出目录。通过页面上传的原图也会随套装保存，便于下次继续制作。

## 复现上面的印章

在工坊中打开示例：

```sh
.venv/bin/python scripts/studio.py \
  --input docs/images/source.jpg \
  --preset docs/examples/sept.json
```

或直接通过命令行生成：

```sh
.venv/bin/python scripts/stamp.py docs/images/source.jpg \
  --preset docs/examples/sept.json \
  --output stamp-outputs/sept.png
```

输出 `sept.png`、`sept-paper.png` 和 `sept.json`。同一张输入、同一组参数、相同尺寸和随机种子会生成相同结果。

## 作为 Codex Skill 使用

这个工具也附带一个可复用的 Skill，调用名为 **`$ink-stamp`**。将仓库克隆到技能目录即可：

```sh
git clone https://github.com/SummonLav/only-ink-stamp.git ~/.codex/skills/ink-stamp
```

然后可以这样描述需求：

> 使用 $ink-stamp，把这张图里的花做成深蓝色印章，中心轻一点，部分边缘更深，保留少量露白。

完整的运行方式和参数说明见 [SKILL.md](SKILL.md)。

## 关于图片与导出

- 白底图案适合自动去底；多色拼贴可用指定颜色提取；透明素材可直接沿用透明度。
- 照片按明暗或颜色转换，不包含语义主体抠图；复杂背景可先用套索选择。
- 导出尺寸指图案长边，四周另加 8% 透明留白。预览最多按 900 px 计算，高分辨率导出的颗粒细节可能略有差异。
- PNG 保留透明度，方便继续用于海报、拼贴或其他设计。

## 检查

```sh
.venv/bin/python scripts/check_engine.py
```

检查覆盖透明背景、负形、选区、油墨深浅、边缘积墨、颜色与随机种子的可复现性。
