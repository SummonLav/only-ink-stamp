# Only Ink Stamp

[English](README.md) · **简体中文**

only-xxx 系列第一作：把你喜欢的图片变成油墨印章。

## 直接用 Skill 开始

**1. 安装一次。** 把下面这句话发给 Codex：

```text
安装这个仓库里的 Codex Skill：https://github.com/SummonLav/only-ink-stamp。
```

**2. 上传图片，直接调用。** 以下面的图片为例：

```text
使用 $ink-stamp，把这张图右上角的 MetroCard 按明暗提取，做成粉色油墨印章。保留清晰的文字，让油墨有深浅变化，部分边缘更深。
```

想自己选择区域、调节效果时，让 `$ink-stamp` 打开工坊即可。Skill 会处理依赖安装并启动本地工具，不需要手动运行服务命令。需要 Python 3.10+。

<details>
<summary>手动安装 Skill</summary>

```sh
git clone https://github.com/SummonLav/only-ink-stamp.git ~/.codex/skills/ink-stamp
```

完整的工作流程和参数说明见 [SKILL.md](SKILL.md)。

</details>

## 直接在浏览器里玩

在线工坊完全在浏览器内运行：选择图片、框选图案、调节油墨，然后下载结果。无需安装 Python、登录账号或上传图片。「保存套装」会下载 ZIP，包含透明 PNG、纸张预览、原图与参数。

### 部署到 Vercel

导入本仓库，**Root Directory 留空**，**Framework Preset 选择 Other**，使用随附的 `vercel.json`。构建后的静态页面位于 `dist`；不要把 `scripts` 设为项目根目录。默认示例为按明暗提取的粉色 MetroCard。

在本地构建并预览同一在线版本（需要 Node.js 20+）：

```sh
npm run build
python3 -m http.server 8080 --directory dist
```

用新版浏览器打开 `http://localhost:8080`。载入的图片仅保存在当前标签页中，关闭前请下载套装。浏览器版和 Python 版共用参数格式，但采用不同的纹理生成器；要复现同一次落印，需要使用相同渲染器、原图、尺寸、参数和种子。

## 原图 → 印章

![原图与印章效果对比：左侧标出原图右上角的 MetroCard 选区，右侧为粉色油墨印章](docs/images/comparison.png)

左侧框线标出原图右上角的 MetroCard；右侧是从该区域按明暗提取的粉色印章。油墨深浅、局部边缘积墨和露白都可以调整。

[查看原图](docs/images/source.png) · [下载透明印章 PNG](docs/images/stamp.png) · [示例参数](docs/examples/metrocard.json)

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
  --input docs/images/source.png \
  --preset docs/examples/metrocard.json
```

或直接通过命令行生成：

```sh
.venv/bin/python scripts/stamp.py docs/images/source.png \
  --preset docs/examples/metrocard.json \
  --output stamp-outputs/metrocard.png
```

输出 `metrocard.png`、`metrocard-paper.png` 和 `metrocard.json`。同一张输入、同一组参数、相同尺寸和随机种子会生成相同结果。

## 关于图片与导出

- 白底图案适合自动去底；多色拼贴可用指定颜色提取；透明素材可直接沿用透明度。
- 照片按明暗或颜色转换，不包含语义主体抠图；复杂背景可先用套索选择。
- 导出尺寸指图案长边，四周另加 8% 透明留白。预览最多按 900 px 计算，高分辨率导出的颗粒细节可能略有差异。
- PNG 保留透明度，方便继续用于海报、拼贴或其他设计。

## 检查

```sh
npm test
.venv/bin/python scripts/check_engine.py
```

检查覆盖透明背景、负形、选区、油墨深浅、边缘积墨、颜色与随机种子的可复现性。
