---
name: ink-stamp
description: 从输入图片的矩形或自由套索选区制作油墨印章，支持可调深浅、局部边缘积墨、颗粒露白、自选颜色与透明 PNG 导出。用于橡皮章、手工盖印、复古印刷质感，不用于公章真伪鉴定。
---

# 印记 · Ink Stamp

将用户图案变成单色、带透明度的油墨印章，保留原有轮廓、文字和比例。使用随附的确定性渲染器处理现有图案；无需重新生成图片。效果以不均匀按压、局部积墨和细小露白为主，不自动添加外框、文字或阴影。

## 运行

以下 `<skill-dir>` 指本文件所在目录，`<python>` 指已安装 `scripts/requirements.txt` 的 Python。优先复用已有且能导入 `PIL`、`numpy` 的解释器。若缺失，在技能目录创建 `.venv`，安装随附 requirements；不硬编码某台电脑的解释器路径。

```sh
python3 -m venv <skill-dir>/.venv
<skill-dir>/.venv/bin/python -m pip install -r <skill-dir>/scripts/requirements.txt
```

用户要自己选择区域或调整效果时，启动本地工坊并打开打印的 `STAMP_STUDIO_URL`：

```sh
<python> <skill-dir>/scripts/studio.py --input /absolute/input.png --output-dir /absolute/output-folder
```

服务器默认选用空闲端口，保留运行进程供用户操作。它只监听本机，图片不上传到外部服务。没有输入图片时使用内置图案演示；不要把演示当成用户图片已处理。可以用 `--preset recipe.json` 恢复已保存参数。若用户仅说“参考这个风格”，不要擅自把参考图中的具体文字当作用户必须采用的图案。

工坊支持矩形拖选、自由套索、百分比精确选区、吸色提取、实时预览、导出透明 PNG、保存套装和参数导入。套装包含透明图、纸张预览图及 JSON；通过浏览器上传的原图也会在用户点击“保存套装”时保存，方便重做。

## 直接出图

区域、颜色等已明确时直接执行，无需让用户再手动拖选。选区使用按 EXIF 方向校正后的原图归一化坐标 `[x,y,width,height]`，不是屏幕坐标。框选不清楚且会切掉主体时先打开工坊选择；不要猜测关键裁剪。

```sh
<python> <skill-dir>/scripts/stamp.py /absolute/input.png \
  --output /absolute/outputs/stamp.png \
  --region 0.15,0.20,0.60,0.45 --color '#217451' \
  --density 0.78 --variation 0.48 --edge 0.55 --edge-variation 0.72
```

重做同一次落印：

```sh
<python> <skill-dir>/scripts/stamp.py /absolute/input.png \
  --preset /absolute/outputs/stamp.json --output /absolute/outputs/stamp-v2.png
```

命令行总是写出 `stamp.png`、`stamp-paper.png` 和 `stamp.json`。JSON 中记录输入文件名、SHA-256、完整参数和随机种子；原文件不被修改。`--region` 覆盖参数文件时会清除旧套索。自由套索通过参数文件中的 `polygon: [[x,y],...]` 设置，坐标同样相对于整张原图，`region` 为套索外接矩形。

## 调节语义

所有质感滑杆为 0–1，可独立调节：

| 参数 | 含义 |
|---|---|
| `color` | 输出印色，`#RRGGBB`；与原图提取颜色互相独立 |
| `density` | 整体油墨深浅；0 完全透明，1 最浓 |
| `variation` | 大块深浅起伏；0 无按压起伏 |
| `edge` | 图案轮廓内部的积墨强度；0 关闭 |
| `edge_variation` | 积墨在边缘上的不均匀程度；0 均匀，1 局部分布 |
| `grain` | 细颗粒，避免大块均匀噪点 |
| `wear` | 露白磨损；0 不额外挖空 |
| `bleed` | 轻微向外洇墨 |
| `threshold` / `softness` | 去浅底强度 / 明暗灰阶过渡 |
| `seed` | 随机种子；调参数时保留，用户要另一枚落印时更换 |

提取模式：白底线稿、标志用 `auto`；黑白摄影用 `luminance`，适当增大 `softness` 保留灰阶；彩色拼贴用 `color` 配合 `source_color` 和 `tolerance` 单独取一种印色；已抠好的透明图用 `alpha`。纯白不透明底不能用 `alpha` 去底。`invert` 反转形状与留白，原有透明区域仍保持透明。

照片通过亮度或颜色变成印章，不提供语义主体抠图；复杂背景先套索、调阈值或请用户提供已抠图版本。查看预览后再选择模式，不宣称任意照片都能自动干净抠出人物。

`size` 是选区内容长边（64–4096），默认 1600；四边额外增加长边 8% 透明留白。预览以最多 900 px 计算，导出按指定尺寸重新渲染；高分辨率颗粒细节会略有差异。同一输入、参数、尺寸和种子的结果可复现。

## 交付检查

检查选区未截断主体、白底已正确移除、图案细节仍可辨认。透明图应为 RGBA；深浅和局部积墨要实际可见。提供透明 PNG、纸张预览与参数路径。仅创建或改动脚本时运行 `scripts/check_engine.py` 验证复现、透明度、选区、颜色和独立参数影响；改动工坊后实际操作选区与导出。
