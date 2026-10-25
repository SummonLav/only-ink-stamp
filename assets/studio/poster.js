import { DEFAULTS, validateSettings } from "./stamp-engine.js";
import {
  RATIOS,
  clamp,
  uid,
  corners,
  bounds,
  validQuad,
  shaped,
  makeStamp,
  dimensions,
  quadCenter,
  rotateQuad,
  clippedSelection,
  dragAngle,
  normalizeAngle,
  recipeKey,
  validateGalleryItem,
} from "./poster-model.js";
import * as storage from "./poster-storage.js";
import { renderStamp, exportPoster } from "./poster-renderer.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const presets = {
  balanced: {
    density: 0.78,
    variation: 0.48,
    edge: 0.55,
    edge_variation: 0.72,
    grain: 0.3,
    wear: 0.18,
    bleed: 0.12,
  },
  dry: {
    density: 0.67,
    variation: 0.77,
    edge: 0.48,
    edge_variation: 0.85,
    grain: 0.5,
    wear: 0.62,
    bleed: 0.04,
  },
  rich: {
    density: 0.92,
    variation: 0.3,
    edge: 0.85,
    edge_variation: 0.58,
    grain: 0.18,
    wear: 0.07,
    bleed: 0.23,
  },
};
let project = {
  version: 1,
  ratio: "3:4",
  background: "#faf8f3",
  stamps: [],
  sourceId: null,
  selectedId: null,
};
let images = [],
  gallery = [],
  draft = structuredClone(DEFAULTS),
  ready = false,
  importing = false,
  picking = false,
  savingGallery = false,
  selectionMode = "edit";
let sourceImage,
  loadedSourceId,
  sourceRevision = 0,
  drawing,
  posterDrag,
  toastTimer;
let saveQueue = Promise.resolve(),
  saveRevision = 0;
const dirtyImages = new Map(),
  removedImages = new Set(),
  dirtyGallery = new Map(),
  removedGallery = new Set();
// Originals removed from the library stay stored while Gallery stamps still need them.
const archived = new Map();
const urls = new Map(),
  galleryURLs = new Map(),
  galleryKeys = new WeakMap(),
  previews = new Map(),
  renderJobs = new Map();
const sourceCanvas = $("#source"),
  ctx = sourceCanvas.getContext("2d");
const selected = () =>
  project.stamps.find((stamp) => stamp.id === project.selectedId);
const source = () => images.find((image) => image.id === project.sourceId);
const settings = () => selected()?.settings || draft;

function toast(message) {
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $("#toast").hidden = true;
  }, 5500);
}
function imageURL(image) {
  if (!urls.has(image.id))
    urls.set(image.id, URL.createObjectURL(image.thumbnail || image.blob));
  return urls.get(image.id);
}
function persist() {
  if (!ready) return;
  const snapshot = structuredClone(project),
    revision = ++saveRevision;
  const pending = [...dirtyImages.values()],
    removed = [...removedImages];
  const pendingGallery = [...dirtyGallery.values()],
    removedItems = [...removedGallery];
  $("#storage-status").textContent = "正在保存…";
  $("#retry-save").hidden = true;
  saveQueue = saveQueue
    .catch(() => {})
    .then(() =>
      storage.save(snapshot, pending, removed, {
        items: pendingGallery,
        removed: removedItems,
      }),
    )
    .then(() => {
      pending.forEach((image) => {
        if (dirtyImages.get(image.id) === image) dirtyImages.delete(image.id);
      });
      removed.forEach((id) => removedImages.delete(id));
      pendingGallery.forEach((item) => {
        if (dirtyGallery.get(item.id) === item) dirtyGallery.delete(item.id);
      });
      removedItems.forEach((id) => removedGallery.delete(id));
      if (revision === saveRevision)
        $("#storage-status").textContent = "已保存到本地";
    })
    .catch((error) => {
      if (revision !== saveRevision) return;
      $("#storage-status").textContent = "尚未保存";
      $("#retry-save").hidden = false;
      toast(
        error.name === "QuotaExceededError"
          ? "浏览器空间不足，请移除不需要的图片后重试。当前编辑仍保留在此页面。"
          : "本地保存失败，当前编辑仍保留在此页面。请重试保存。",
      );
    });
}
$("#retry-save").onclick = persist;
window.addEventListener("beforeunload", (event) => {
  if (ready && $("#storage-status").textContent !== "已保存到本地") {
    event.preventDefault();
    event.returnValue = "";
  }
});

function library() {
  $("#image-count").textContent = images.length;
  $("#image-list").replaceChildren(
    ...images.map((image) => {
      const button = document.createElement("button");
      button.className =
        "thumbnail" + (image.id === project.sourceId ? " active" : "");
      button.dataset.sourceId = image.id;
      button.setAttribute("aria-label", `编辑原图 ${image.name}`);
      button.setAttribute("aria-pressed", image.id === project.sourceId);
      const img = document.createElement("img");
      img.src = imageURL(image);
      img.alt = "";
      img.loading = "lazy";
      const name = document.createElement("span");
      name.textContent = image.name;
      const count = document.createElement("em");
      count.textContent = project.stamps.filter(
        (stamp) => stamp.sourceId === image.id,
      ).length;
      button.append(img, name, count);
      button.onclick = () => chooseSource(image.id);
      return button;
    }),
  );
}
async function loadSource() {
  const image = source(),
    revision = ++sourceRevision;
  loadedSourceId = null;
  sourceImage = null;
  sourceRotateHandles.forEach((handle) => {
    handle.hidden = true;
  });
  sourceCanvas.hidden = true;
  $("#source-empty").hidden = !!image;
  $("#source-name").textContent = image?.name || "";
  if (!image) return;
  const url = URL.createObjectURL(image.blob),
    img = new Image();
  try {
    img.src = url;
    await img.decode();
    if (revision !== sourceRevision) return;
    sourceImage = img;
    loadedSourceId = image.id;
    const scale = Math.min(
      1,
      1800 / Math.max(img.naturalWidth, img.naturalHeight),
    );
    sourceCanvas.width = Math.round(img.naturalWidth * scale);
    sourceCanvas.height = Math.round(img.naturalHeight * scale);
    sourceCanvas.hidden = false;
    drawSource();
  } catch {
    toast("这张原图无法读取，请重新上传");
  } finally {
    URL.revokeObjectURL(url);
  }
}
function chooseSource(id, stampId) {
  if (!ready) return;
  const previous = project.sourceId;
  project.sourceId = id;
  project.selectedId =
    stampId ||
    project.stamps.findLast((stamp) => stamp.sourceId === id)?.id ||
    null;
  if (!selected()) draft = structuredClone(DEFAULTS);
  picking = false;
  drawing = null;
  selectionMode = "edit";
  library();
  controls();
  poster();
  if (previous !== id || loadedSourceId !== id) loadSource();
  else drawSource();
  persist();
}
function selectStamp(id) {
  const stamp = project.stamps.find((item) => item.id === id);
  if (stamp) chooseSource(stamp.sourceId, id);
}
function commitSelection(region, polygon = [], quad = null) {
  if (!source()) return;
  selectionMode = "edit";
  let stamp = selected();
  if (!stamp) {
    stamp = makeStamp(project.sourceId, draft, project.stamps.length);
    project.stamps.push(stamp);
    project.selectedId = stamp.id;
  }
  stamp.settings.region = region;
  stamp.settings.polygon = polygon;
  if (quad) stamp.selectionQuad = structuredClone(quad);
  else delete stamp.selectionQuad;
  controls();
  drawSource();
  poster();
  library();
  queuePreview(stamp);
  persist();
}
function controls() {
  const config = settings(),
    stamp = selected(),
    hasSource = !!source();
  $("#ink-controls").disabled = !hasSource;
  ["all", "rect", "new-stamp", "remove-source"].forEach((id) => {
    $("#" + id).disabled = !hasSource;
  });
  $$("[data-shape]").forEach((button) => {
    button.disabled = !hasSource;
  });
  $$("[data-param]").forEach((el) => {
    const value = config[el.dataset.param];
    if (el.type === "checkbox") el.checked = value;
    else el.value = value;
    if (el.type === "range") {
      el.style.setProperty("--value", `${value * 100}%`);
      $(`label[for="${el.id}"] output`).textContent =
        `${Math.round(value * 100)}%`;
    }
  });
  $("#hex-label").textContent = config.color.toUpperCase();
  $$("[data-color]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.color === config.color);
  });
  $$("[data-preset]").forEach((button) => {
    button.setAttribute(
      "aria-pressed",
      Object.entries(presets[button.dataset.preset]).every(
        ([key, value]) => config[key] === value,
      ),
    );
  });
  $("#color-extraction").hidden = config.mode !== "color";
  $("#tone-extraction").hidden = ["color", "alpha"].includes(config.mode);
  ["cx", "cy", "cw", "ch"].forEach((id, i) => {
    $("#" + id).value = +(config.region[i] * 100).toFixed(1);
  });
  $("#selection-info").textContent =
    "角点外侧拖动旋转 · 角点变形 · Shift 按 15° 对齐";
  $("#editing-label").textContent = stamp
    ? `正在编辑印章 ${project.stamps.indexOf(stamp) + 1} · 再次框选会更新这一枚`
    : "新印章 · 框选或点击全图，自动加入 Poster";
  const isFull =
    !config.polygon.length &&
    config.region.every((v, i) => Math.abs(v - [0, 0, 1, 1][i]) < 0.0001);
  $("#all").setAttribute("aria-pressed", isFull && !!stamp);
  $("#rect").setAttribute("aria-pressed", !isFull || !stamp);
  $$("[data-shape]").forEach((button) => {
    const candidate =
      button.dataset.shape === "rect"
        ? []
        : shaped(config.region, button.dataset.shape);
    button.setAttribute(
      "aria-pressed",
      JSON.stringify(candidate) === JSON.stringify(config.polygon),
    );
  });
  [
    "stamp-scale",
    "stamp-rotation",
    "duplicate",
    "send-back",
    "bring-front",
    "delete-stamp",
    "download-stamp",
  ].forEach((id) => {
    $("#" + id).disabled = !stamp;
  });
  const match = stamp && galleryMatch(stamp),
    save = $("#save-gallery");
  save.disabled = !stamp || savingGallery || match.saved;
  save.textContent = savingGallery
    ? "正在存入…"
    : match?.saved
      ? "已在 Gallery ✓"
      : match?.item
        ? "更新 Gallery"
        : "存入 Gallery";
  save.title = match?.item && !match.saved
    ? "覆盖 Gallery 中的这一枚；想另存一枚可先「复制」"
    : "";
  $("#stamp-scale").value = stamp ? stamp.width * 100 : 60;
  $("#stamp-rotation").value = stamp?.rotation || 0;
  $("#scale-value").textContent = stamp
    ? `${Math.round(stamp.width * 100)}%`
    : "—";
  $("#rotation-value").textContent = stamp
    ? `${Math.round(stamp.rotation * 10) / 10}°`
    : "—";
}
const rotationIcon =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10a7 7 0 1 1 2 7M5 5v5h5"/></svg>';
const cornerNames = ["左上", "右上", "右下", "左下"];
function rotateHandle(label, corner) {
  const button = document.createElement("button");
  button.className = "rotate-handle";
  button.dataset.corner = corner;
  button.innerHTML = rotationIcon;
  button.setAttribute("aria-label", label);
  button.title = "拖动旋转 · Shift 按 15° 对齐";
  return button;
}
const sourceRotateHandles = cornerNames.map((name, corner) => {
  const handle = rotateHandle(`旋转原图选区（${name}角）`, corner);
  handle.classList.add("source-rotate-handle");
  handle.hidden = true;
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key) || !selected()) return;
    event.preventDefault();
    const angle =
      (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1);
    const quad = rotateQuad(
      selectionQuad(),
      angle,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    commitQuad(quad);
  });
  $("#drop-zone").append(handle);
  return handle;
});
function selectionQuad() {
  const config = settings();
  return (
    selected()?.selectionQuad ||
    (config.polygon.length === 4 ? config.polygon : corners(config.region))
  );
}
function commitQuad(quad) {
  const clipped = validQuad(quad, true) && clippedSelection(quad);
  if (clipped) commitSelection(clipped.region, clipped.polygon, quad);
}
function sourceCenter(quad, rect = sourceCanvas.getBoundingClientRect()) {
  const [cx, cy] = quadCenter(quad);
  return [rect.left + cx * rect.width, rect.top + cy * rect.height];
}
function pointerAngle(event, center) {
  return Math.atan2(event.clientY - center[1], event.clientX - center[0]);
}
function sourceHandles(poly) {
  const rect = sourceCanvas.getBoundingClientRect(),
    stage = $("#drop-zone").getBoundingClientRect();
  const center = sourceCenter(poly, rect);
  poly.forEach(([x, y], i) => {
    const px = rect.left + x * rect.width,
      py = rect.top + y * rect.height;
    const length = Math.hypot(px - center[0], py - center[1]) || 1;
    const handle = sourceRotateHandles[i];
    // Keep a corner reachable when a rotated selection extends beyond the source image.
    handle.style.left = `${clamp(px - stage.left + (26 * (px - center[0])) / length, 14, stage.width - 14)}px`;
    handle.style.top = `${clamp(py - stage.top + (26 * (py - center[1])) / length, 14, stage.height - 14)}px`;
    handle.hidden = false;
    handle.classList.toggle(
      "rotating",
      drawing?.mode === "rotate" && drawing.corner === i,
    );
  });
}
function drawSource() {
  if (!sourceImage || loadedSourceId !== project.sourceId) {
    sourceRotateHandles.forEach((handle) => {
      handle.hidden = true;
    });
    return;
  }
  const w = sourceCanvas.width,
    h = sourceCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(sourceImage, 0, 0, w, h);
  if (!selected() && !drawing) {
    sourceRotateHandles.forEach((handle) => {
      handle.hidden = true;
    });
    return;
  }
  const poly = drawing?.points || selectionQuad();
  sourceHandles(poly);
  const path = () => {
    poly.forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](x * w, y * h));
    ctx.closePath();
  };
  const factor = w / Math.max(1, sourceCanvas.getBoundingClientRect().width);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  path();
  ctx.fillStyle = "#00000066";
  ctx.fill("evenodd");
  ctx.beginPath();
  path();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2 * factor;
  ctx.stroke();
  ctx.setLineDash([5 * factor, 4 * factor]);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = factor;
  ctx.stroke();
  ctx.setLineDash([]);
  poly.forEach(([x, y]) => {
    ctx.beginPath();
    ctx.arc(x * w, y * h, 5 * factor, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 1.5 * factor;
    ctx.stroke();
  });
  ctx.restore();
}
function point(event) {
  const rect = sourceCanvas.getBoundingClientRect();
  return [
    clamp((event.clientX - rect.left) / rect.width),
    clamp((event.clientY - rect.top) / rect.height),
  ];
}
function inside(p, poly) {
  return poly.every((a, i) => {
    const b = poly[(i + 1) % 4];
    return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
  });
}
$("#drop-zone").addEventListener("pointerdown", (event) => {
  const rotationHandle = event.target.closest(".source-rotate-handle");
  if (event.target !== sourceCanvas && !rotationHandle) return;
  if (
    !ready ||
    drawing ||
    loadedSourceId !== project.sourceId ||
    event.button !== 0
  )
    return;
  const p = point(event);
  if (picking && !rotationHandle) {
    const sample = document.createElement("canvas");
    sample.width = sample.height = 1;
    const sampleCtx = sample.getContext("2d");
    sampleCtx.drawImage(
      sourceImage,
      p[0] * (sourceImage.naturalWidth - 1),
      p[1] * (sourceImage.naturalHeight - 1),
      1,
      1,
      0,
      0,
      1,
      1,
    );
    const rgb = [...sampleCtx.getImageData(0, 0, 1, 1).data].slice(0, 3);
    settings().source_color =
      "#" + rgb.map((value) => value.toString(16).padStart(2, "0")).join("");
    picking = false;
    updateInk();
    return;
  }
  const poly = selectionQuad();
  const box = sourceCanvas.getBoundingClientRect();
  const corner = rotationHandle
    ? Number(rotationHandle.dataset.corner)
    : selected()
      ? poly.findIndex(
          (q) =>
            Math.hypot((q[0] - p[0]) * box.width, (q[1] - p[1]) * box.height) <
            15,
        )
      : -1;
  const mode = rotationHandle
    ? "rotate"
    : corner >= 0
      ? "corner"
      : selected() &&
          selectionMode !== "rect" &&
          !event.shiftKey &&
          inside(p, poly)
        ? "move"
        : "rect";
  drawing = {
    mode,
    corner,
    pointerId: event.pointerId,
    start: p,
    original: structuredClone(poly),
    points:
      mode === "rect" ? corners([p[0], p[1], 0, 0]) : structuredClone(poly),
    moved: false,
    center: sourceCenter(poly, box),
    startAngle: pointerAngle(event, sourceCenter(poly, box)),
  };
  $("#drop-zone").setPointerCapture(event.pointerId);
  $("#drop-zone").classList.toggle("rotating", mode === "rotate");
  event.preventDefault();
});
$("#drop-zone").addEventListener("pointermove", (event) => {
  if (!drawing || event.pointerId !== drawing.pointerId) return;
  const p = point(event),
    d = drawing;
  if (d.mode === "rotate") {
    const angle = dragAngle(
      d.startAngle,
      pointerAngle(event, d.center),
      0,
      event.shiftKey,
    );
    const rotated = rotateQuad(
      d.original,
      angle,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    if (clippedSelection(rotated)) {
      d.points = rotated;
      d.moved = true;
    }
    drawSource();
    $("#selection-info").textContent = `旋转 ${angle}° · Shift 按 15° 对齐`;
    return;
  }
  if (Math.hypot(p[0] - d.start[0], p[1] - d.start[1]) < 0.003 && !d.moved)
    return;
  d.moved = true;
  if (d.mode === "rect")
    d.points = corners([
      Math.min(p[0], d.start[0]),
      Math.min(p[1], d.start[1]),
      Math.abs(p[0] - d.start[0]),
      Math.abs(p[1] - d.start[1]),
    ]);
  else if (d.mode === "corner") {
    const next = structuredClone(d.points);
    next[d.corner] = p;
    if (validQuad(next, true) && clippedSelection(next)) d.points = next;
  } else {
    const [x, y, w, h] = bounds(d.original);
    const [cx, cy] = quadCenter(d.original);
    const dx =
        w <= 1
          ? clamp(p[0] - d.start[0], -x, 1 - x - w)
          : clamp(p[0] - d.start[0], -cx, 1 - cx),
      dy =
        h <= 1
          ? clamp(p[1] - d.start[1], -y, 1 - y - h)
          : clamp(p[1] - d.start[1], -cy, 1 - cy);
    const moved = d.original.map(([px, py]) => [px + dx, py + dy]);
    if (clippedSelection(moved)) d.points = moved;
  }
  drawSource();
});
$("#drop-zone").addEventListener("pointerup", (event) => {
  if (!drawing || event.pointerId !== drawing.pointerId) return;
  const d = drawing;
  drawing = null;
  $("#drop-zone").classList.remove("rotating");
  if (d.moved && validQuad(d.points, true)) {
    if (d.mode === "rect") commitSelection(bounds(d.points));
    else commitQuad(d.points);
  } else drawSource();
});
$("#drop-zone").addEventListener("pointercancel", () => {
  drawing = null;
  $("#drop-zone").classList.remove("rotating");
  drawSource();
  controls();
});
$("#rect").onclick = () => {
  picking = false;
  selectionMode = "rect";
  $("#selection-info").textContent = "在原图上拖动，重新框选图案。";
};
$("#all").onclick = () => commitSelection([0, 0, 1, 1]);
$("#new-stamp").onclick = () => {
  draft = validateSettings({
    ...settings(),
    region: [0, 0, 1, 1],
    polygon: [],
    seed: Math.floor(Math.random() * 4294967296),
  });
  project.selectedId = null;
  controls();
  drawSource();
  poster();
  persist();
};
$$("[data-shape]").forEach((button) => {
  button.onclick = () => {
    const region = settings().region,
      shape = button.dataset.shape;
    commitSelection(region, shape === "rect" ? [] : shaped(region, shape));
  };
});
$("#apply-region").onclick = () => {
  try {
    const region = ["cx", "cy", "cw", "ch"].map(
      (id) => Number($("#" + id).value) / 100,
    );
    const valid = validateSettings({ ...settings(), region, polygon: [] });
    commitSelection(valid.region);
  } catch (error) {
    toast(error.message);
    controls();
  }
};

function updateInk() {
  controls();
  if (selected()) {
    queuePreview(selected());
    persist();
  }
}
$$("[data-param]").forEach((el) => {
  el.addEventListener("input", () => {
    settings()[el.dataset.param] =
      el.type === "checkbox"
        ? el.checked
        : el.type === "range"
          ? Number(el.value)
          : el.value;
    updateInk();
  });
});
$$("[data-preset]").forEach((button) => {
  button.onclick = () => {
    Object.assign(settings(), presets[button.dataset.preset]);
    updateInk();
  };
});
$$("[data-color]").forEach((button) => {
  button.onclick = () => {
    settings().color = button.dataset.color;
    updateInk();
  };
});
$("#reset").onclick = () => {
  const config = settings();
  Object.assign(config, structuredClone(DEFAULTS), {
    region: config.region,
    polygon: config.polygon,
  });
  updateInk();
};
$("#reseed").onclick = () => {
  settings().seed = Math.floor(Math.random() * 4294967296);
  updateInk();
};
$("#pick").onclick = () => {
  picking = true;
  toast("点击原图中的颜色");
};

function poster() {
  const paper = $("#poster-paper"),
    ratio = RATIOS[project.ratio];
  paper.style.aspectRatio = String(ratio);
  paper.style.backgroundColor = project.background;
  $("#paper-color").value = project.background;
  $$("[data-ratio]").forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset.ratio === project.ratio);
  });
  $("#stamp-count").textContent = `${project.stamps.length} 枚印章`;
  $("#poster-empty").hidden = !!project.stamps.length;
  $("#export-poster").disabled = !ready || exporting || !project.stamps.length;
  const size = dimensions(project.ratio, Number($("#export-size").value));
  $("#poster-dimensions").textContent = `${size.width} × ${size.height} px`;
  const container = $("#poster-items");
  const ids = new Set(project.stamps.map((stamp) => stamp.id));
  [...container.children].forEach((el) => {
    if (!ids.has(el.dataset.id)) el.remove();
  });
  project.stamps.forEach((stamp, index) => {
    let item = [...container.children].find((el) => el.dataset.id === stamp.id);
    if (!item) {
      item = document.createElement("div");
      item.className = "poster-stamp";
      item.dataset.id = stamp.id;
      const button = document.createElement("button");
      button.className = "stamp-hit";
      const img = document.createElement("img");
      img.draggable = false;
      img.alt = "";
      button.append(img);
      button.onclick = () => {
        if (!posterDrag) selectStamp(stamp.id);
      };
      button.addEventListener("keydown", (event) => {
        const step = event.shiftKey ? 0.02 : 0.005;
        if (
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          )
        )
          return;
        event.preventDefault();
        stamp.x = clamp(
          stamp.x +
            (event.key === "ArrowRight"
              ? step
              : event.key === "ArrowLeft"
                ? -step
                : 0),
        );
        stamp.y = clamp(
          stamp.y +
            (event.key === "ArrowDown"
              ? step
              : event.key === "ArrowUp"
                ? -step
                : 0),
        );
        position(item, stamp);
        persist();
      });
      const resize = document.createElement("button");
      resize.className = "resize-handle";
      resize.title = "拖动缩放";
      resize.setAttribute("aria-label", "缩放此印章");
      resize.onclick = () => {
        selectStamp(stamp.id);
        $("#stamp-scale").focus();
      };
      item.append(button, resize);
      cornerNames.forEach((name, corner) => {
        const handle = rotateHandle(`旋转印章（${name}角）`, corner);
        handle.addEventListener("keydown", (event) => {
          if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
          event.preventDefault();
          selectStamp(stamp.id);
          stamp.rotation = normalizeAngle(
            stamp.rotation +
              (event.key === "ArrowLeft" ? -1 : 1) * (event.shiftKey ? 15 : 1),
          );
          position(item, stamp);
          controls();
          persist();
        });
        item.append(handle);
      });
      container.append(item);
    }
    item.style.zIndex = index + 1;
    item.classList.toggle("selected", stamp.id === project.selectedId);
    item
      .querySelector(".stamp-hit")
      .setAttribute(
        "aria-label",
        `编辑印章 ${index + 1}，来自 ${images.find((image) => image.id === stamp.sourceId)?.name || "原图"}`,
      );
    item
      .querySelectorAll(".resize-handle, .rotate-handle")
      .forEach((handle) => {
        handle.tabIndex = stamp.id === project.selectedId ? 0 : -1;
      });
    const preview = previews.get(stamp.id),
      img = item.querySelector("img");
    if (preview && img.getAttribute("src") !== preview.url)
      img.src = preview.url;
    item.classList.toggle("pending", !preview);
    const sourceImage = images.find((image) => image.id === stamp.sourceId),
      [, , rw, rh] = stamp.settings.region;
    item.style.aspectRatio = preview
      ? `${preview.width} / ${preview.height}`
      : `${sourceImage.width * rw} / ${sourceImage.height * rh}`;
    position(item, stamp);
  });
  fitPaper();
}
function position(item, stamp) {
  item.style.left = `${stamp.x * 100}%`;
  item.style.top = `${stamp.y * 100}%`;
  item.style.width = `${stamp.width * 100}%`;
  item.style.transform = `translate(-50%, -50%) rotate(${stamp.rotation}deg)`;
}
function fitPaper() {
  const stage = $("#poster-stage"),
    ratio = RATIOS[project.ratio];
  const padding = parseFloat(getComputedStyle(stage).paddingLeft) * 2;
  $("#poster-paper").style.width =
    `${Math.max(1, Math.min(stage.clientWidth - padding, (stage.clientHeight - padding) * ratio))}px`;
}
new ResizeObserver(() => {
  fitPaper();
  drawSource();
}).observe($("#poster-stage"));
new ResizeObserver(drawSource).observe($("#drop-zone"));

function stopRender(id) {
  const job = renderJobs.get(id);
  if (job) {
    clearTimeout(job.timer);
    job.controller.abort();
    renderJobs.delete(id);
  }
}
function previewStatus() {
  $("#preview-status").textContent = renderJobs.size
    ? "正在上墨…"
    : "预览已更新";
}
function queuePreview(stamp, delay = 140) {
  stopRender(stamp.id);
  const job = { controller: new AbortController() };
  renderJobs.set(stamp.id, job);
  previewStatus();
  job.timer = setTimeout(async () => {
    try {
      const image = images.find((image) => image.id === stamp.sourceId);
      const blob = await renderStamp(image.blob, stamp.settings, {
        preview: true,
        signal: job.controller.signal,
      });
      const bitmap = await createImageBitmap(blob);
      if (renderJobs.get(stamp.id) !== job) {
        bitmap.close();
        return;
      }
      const previous = previews.get(stamp.id);
      previews.set(stamp.id, {
        url: URL.createObjectURL(blob),
        width: bitmap.width,
        height: bitmap.height,
      });
      bitmap.close();
      if (previous) URL.revokeObjectURL(previous.url);
      renderJobs.delete(stamp.id);
      poster();
      previewStatus();
    } catch (error) {
      if (error.name !== "AbortError" && renderJobs.get(stamp.id) === job) {
        renderJobs.delete(stamp.id);
        $("#preview-status").textContent = "部分预览失败";
        toast(error.message);
      }
    }
  }, delay);
}
$("#poster-items").addEventListener("pointerdown", (event) => {
  const item = event.target.closest(".poster-stamp");
  if (!item || !ready || posterDrag || event.button !== 0) return;
  selectStamp(item.dataset.id);
  const stamp = selected(),
    rect = $("#poster-paper").getBoundingClientRect();
  const center = [
    rect.left + stamp.x * rect.width,
    rect.top + stamp.y * rect.height,
  ];
  const mode = event.target.closest(".rotate-handle")
    ? "rotate"
    : event.target.closest(".resize-handle")
      ? "resize"
      : "move";
  posterDrag = {
    id: stamp.id,
    item,
    pointerId: event.pointerId,
    mode,
    center,
    startAngle: pointerAngle(event, center),
    x: event.clientX,
    y: event.clientY,
    original: { ...stamp },
    rect,
  };
  item.classList.toggle("rotating", mode === "rotate");
  item.setPointerCapture(event.pointerId);
  event.preventDefault();
});
$("#poster-items").addEventListener("pointermove", (event) => {
  const d = posterDrag;
  if (!d || d.pointerId !== event.pointerId) return;
  const stamp = project.stamps.find((item) => item.id === d.id);
  const dx = event.clientX - d.x,
    dy = event.clientY - d.y;
  if (d.mode === "move") {
    stamp.x = clamp(d.original.x + dx / d.rect.width);
    stamp.y = clamp(d.original.y + dy / d.rect.height);
  } else if (d.mode === "rotate") {
    stamp.rotation = dragAngle(
      d.startAngle,
      pointerAngle(event, d.center),
      d.original.rotation,
      event.shiftKey,
    );
  } else {
    const angle = (d.original.rotation * Math.PI) / 180;
    stamp.width = clamp(
      d.original.width +
        (2 * (dx * Math.cos(angle) + dy * Math.sin(angle))) / d.rect.width,
      0.05,
      1.5,
    );
  }
  position(d.item, stamp);
  controls();
});
function endPosterDrag(event) {
  if (!posterDrag || posterDrag.pointerId !== event.pointerId) return;
  if (event.type === "pointercancel") {
    const stamp = project.stamps.find((item) => item.id === posterDrag.id);
    Object.assign(stamp, posterDrag.original);
    position(posterDrag.item, stamp);
    controls();
  }
  posterDrag.item.classList.remove("rotating");
  posterDrag = null;
  persist();
}
$("#poster-items").addEventListener("pointerup", endPosterDrag);
$("#poster-items").addEventListener("pointercancel", endPosterDrag);
$("#stamp-scale").oninput = (event) => {
  if (selected()) {
    selected().width = Number(event.target.value) / 100;
    poster();
    controls();
    persist();
  }
};
$("#stamp-rotation").oninput = (event) => {
  if (selected()) {
    selected().rotation = Number(event.target.value);
    poster();
    controls();
    persist();
  }
};
$$("[data-ratio]").forEach((button) => {
  button.onclick = () => {
    project.ratio = button.dataset.ratio;
    poster();
    persist();
  };
});
$("#paper-color").oninput = (event) => {
  project.background = event.target.value;
  poster();
  persist();
};
$("#export-size").onchange = poster;
$("#duplicate").onclick = () => {
  if (!selected()) return;
  const copy = structuredClone(selected());
  copy.id = uid();
  delete copy.galleryId;
  copy.x = clamp(copy.x + 0.06);
  copy.y = clamp(copy.y + 0.06);
  project.stamps.push(copy);
  project.selectedId = copy.id;
  controls();
  poster();
  library();
  queuePreview(copy);
  persist();
};
function reorder(front) {
  const stamp = selected();
  if (!stamp) return;
  project.stamps = project.stamps.filter((item) => item.id !== stamp.id);
  project.stamps[front ? "push" : "unshift"](stamp);
  controls();
  poster();
  persist();
}
$("#bring-front").onclick = () => reorder(true);
$("#send-back").onclick = () => reorder(false);
function removeStamp(id) {
  stopRender(id);
  const preview = previews.get(id);
  if (preview) URL.revokeObjectURL(preview.url);
  previews.delete(id);
  project.stamps = project.stamps.filter((stamp) => stamp.id !== id);
}
$("#delete-stamp").onclick = () => {
  if (!selected()) return;
  removeStamp(project.selectedId);
  project.selectedId = null;
  controls();
  poster();
  library();
  drawSource();
  previewStatus();
  persist();
};
$("#remove-source").onclick = () => {
  const image = source();
  if (!image) return;
  const stamps = project.stamps.filter((stamp) => stamp.sourceId === image.id);
  if (
    stamps.length &&
    !confirm(
      `移除「${image.name}」及 Poster 中关联的 ${stamps.length} 枚印章？原始文件不会被删除。`,
    )
  )
    return;
  stamps.forEach((stamp) => removeStamp(stamp.id));
  images = images.filter((item) => item.id !== image.id);
  if (gallery.some((item) => item.sourceId === image.id)) {
    const hidden = { ...image, hidden: true };
    archived.set(image.id, hidden);
    dirtyImages.set(image.id, hidden);
    toast("已从图片库移除；Gallery 中的印章仍保留这张原图，可继续重新编辑");
  } else {
    dirtyImages.delete(image.id);
    removedImages.add(image.id);
  }
  URL.revokeObjectURL(urls.get(image.id));
  urls.delete(image.id);
  project.sourceId = images[0]?.id || null;
  project.selectedId =
    project.stamps.find((stamp) => stamp.sourceId === project.sourceId)?.id ||
    null;
  draft = structuredClone(DEFAULTS);
  library();
  controls();
  poster();
  loadSource();
  previewStatus();
  persist();
};

function thumbnailBlob(bitmap, longSide) {
  const scale = Math.min(1, longSide / Math.max(bitmap.width, bitmap.height));
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(bitmap.width * scale)),
    Math.max(1, Math.round(bitmap.height * scale)),
  );
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.convertToBlob({ type: "image/png" });
}
async function readImage(file, name = file.name) {
  if (file.size > 40 * 1024 * 1024) throw Error("每张图片请小于 40 MB");
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw Error("无法读取，请使用 PNG、JPEG 或 WebP 图片");
  }
  try {
    if (bitmap.width * bitmap.height > 40000000)
      throw Error("每张图片不能超过 4000 万像素");
    return {
      id: uid(),
      name: name || "粘贴的图片.png",
      blob: file,
      thumbnail: await thumbnailBlob(bitmap, 200),
      width: bitmap.width,
      height: bitmap.height,
      createdAt: Date.now(),
    };
  } finally {
    bitmap.close();
  }
}
async function upload(files) {
  if (!ready || importing || !files.length) return;
  importing = true;
  $("#upload").disabled = true;
  $("#upload").textContent = "正在导入…";
  const added = [],
    failures = [];
  try {
    for (const file of files) {
      try {
        const image = await readImage(file);
        images.push(image);
        dirtyImages.set(image.id, image);
        added.push(image);
      } catch (error) {
        failures.push(`${file.name || "图片"}：${error.message}`);
      }
    }
    if (added.length) {
      if (location.hash === "#gallery") location.hash = "#studio";
      chooseSource(added[0].id);
      toast(`已加入 ${added.length} 张图片，框选或点击全图开始制作`);
    }
    if (failures.length) toast(failures.join("；"));
  } finally {
    importing = false;
    $("#upload").disabled = false;
    $("#upload").textContent = "＋ 上传图片";
  }
}
["upload", "add-images", "empty-upload"].forEach((id) => {
  $("#" + id).onclick = () => $("#file").click();
});
$("#file").onchange = (event) => {
  upload([...event.target.files]);
  event.target.value = "";
};
const drop = $("#drop-zone");
["dragenter", "dragover"].forEach((type) =>
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("dragging");
  }),
);
["dragleave", "drop"].forEach((type) =>
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("dragging");
  }),
);
drop.addEventListener("drop", (event) => upload([...event.dataTransfer.files]));
document.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.type.startsWith("image/"))
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length) {
    event.preventDefault();
    upload(files);
  }
});
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
let exporting = false;
$("#export-poster").onclick = async () => {
  if (exporting || !project.stamps.length) return;
  exporting = true;
  const button = $("#export-poster");
  button.disabled = true;
  button.textContent = "正在导出…";
  const snapshot = structuredClone(project),
    sources = [...images];
  try {
    const blob = await exportPoster(
      snapshot,
      sources,
      Number($("#export-size").value),
      (done, total) => {
        button.textContent = `正在导出 ${done}/${total}`;
      },
    );
    download(blob, `ink-poster-${snapshot.ratio.replace(":", "x")}.png`);
    toast("完整 Poster 已导出为 PNG");
  } catch (error) {
    toast(error.message);
  } finally {
    exporting = false;
    button.innerHTML = "导出 Poster <span>↗</span>";
    poster();
  }
};
$("#download-stamp").onclick = async () => {
  const stamp = selected(),
    image = source();
  if (!stamp || !image) return;
  const button = $("#download-stamp");
  button.disabled = true;
  try {
    download(
      await renderStamp(image.blob, structuredClone(stamp.settings)),
      "ink-stamp.png",
    );
  } catch (error) {
    toast(error.message);
  } finally {
    controls();
  }
};

function galleryKey(item) {
  if (!galleryKeys.has(item)) galleryKeys.set(item, recipeKey(item));
  return galleryKeys.get(item);
}
// A stamp re-opened from the Gallery updates its item; an unlinked twin counts as already saved.
function galleryMatch(stamp) {
  const key = recipeKey(stamp),
    linked = gallery.find((item) => item.id === stamp.galleryId);
  if (linked) return { item: linked, saved: galleryKey(linked) === key };
  const twin = gallery.find(
    (item) => item.sourceId === stamp.sourceId && galleryKey(item) === key,
  );
  return { item: twin, saved: !!twin };
}
function galleryURL(item) {
  const cached = galleryURLs.get(item.id);
  if (cached?.blob === item.thumbnail) return cached.url;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(item.thumbnail);
  galleryURLs.set(item.id, { blob: item.thumbnail, url });
  return url;
}
function restoreSource(id) {
  const image = archived.get(id);
  if (!image) return images.some((item) => item.id === id);
  const visible = { ...image };
  delete visible.hidden;
  archived.delete(id);
  images.push(visible);
  dirtyImages.set(id, visible);
  return true;
}
function stampFromGallery(item, linked) {
  const stamp = makeStamp(item.sourceId, item.settings, project.stamps.length);
  if (item.selectionQuad)
    stamp.selectionQuad = structuredClone(item.selectionQuad);
  if (linked) stamp.galleryId = item.id;
  return stamp;
}
function editGalleryItem(item) {
  if (!restoreSource(item.sourceId))
    return toast("原图已不在此浏览器，无法重新编辑");
  let stamp = project.stamps.find((s) => s.galleryId === item.id);
  if (!stamp) {
    stamp = stampFromGallery(item, true);
    project.stamps.push(stamp);
    queuePreview(stamp);
  }
  location.hash = "#studio";
  chooseSource(item.sourceId, stamp.id);
}
function placeGalleryItem(item) {
  if (!restoreSource(item.sourceId))
    return toast("原图已不在此浏览器，无法放到 Poster");
  const stamp = stampFromGallery(item, false);
  project.stamps.push(stamp);
  queuePreview(stamp);
  chooseSource(item.sourceId, stamp.id);
  toast(`已放到 Poster（共 ${project.stamps.length} 枚），回到工坊调整位置`);
}
function deleteGalleryItem(item) {
  if (!confirm(`从 Gallery 删除「${item.name}」这枚印章？Poster 中已摆放的印章不受影响。`))
    return;
  gallery = gallery.filter((other) => other.id !== item.id);
  dirtyGallery.delete(item.id);
  removedGallery.add(item.id);
  URL.revokeObjectURL(galleryURLs.get(item.id)?.url);
  galleryURLs.delete(item.id);
  const image = archived.get(item.sourceId);
  if (image && !gallery.some((other) => other.sourceId === image.id)) {
    archived.delete(image.id);
    dirtyImages.delete(image.id);
    removedImages.add(image.id);
  }
  renderGallery();
  controls();
  persist();
}
function renderGallery() {
  $("#gallery-count").textContent = gallery.length;
  $("#gallery-total").textContent = `${gallery.length} 枚印章`;
  $("#gallery-empty").hidden = !!gallery.length;
  $("#gallery-grid").replaceChildren(
    ...gallery.map((item) => {
      const card = document.createElement("article"),
        name = item.name.replace(/\.[a-z0-9]+$/i, "");
      card.className = "gallery-card";
      const art = document.createElement("div");
      art.className = "gallery-art";
      const img = document.createElement("img");
      img.src = galleryURL(item);
      img.alt = `${name} 印章`;
      img.loading = "lazy";
      art.append(img);
      const meta = document.createElement("div");
      meta.className = "gallery-meta";
      const swatch = document.createElement("span");
      swatch.className = "gallery-swatch";
      swatch.style.setProperty("--swatch", item.settings.color);
      const label = document.createElement("span");
      label.className = "gallery-name";
      label.textContent = name;
      label.title = item.name;
      const time = document.createElement("time");
      time.dateTime = new Date(item.updatedAt).toISOString();
      time.textContent = new Date(item.updatedAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      meta.append(swatch, label, time);
      const actions = document.createElement("div");
      actions.className = "gallery-actions";
      const available =
        archived.has(item.sourceId) ||
        images.some((image) => image.id === item.sourceId);
      [
        ["重新编辑", "重新编辑", () => editGalleryItem(item), true],
        ["放到 Poster", "放到 Poster", () => placeGalleryItem(item), true],
        ["PNG ↗", "下载 PNG", () => download(item.png, `${name}-stamp.png`)],
        ["删除", "删除", () => deleteGalleryItem(item)],
      ].forEach(([text, label, action, needsSource]) => {
        const button = document.createElement("button");
        button.className = "text-button";
        button.textContent = text;
        button.setAttribute("aria-label", `${label}：${name}`);
        button.onclick = action;
        if (needsSource && !available) {
          button.disabled = true;
          button.title = "原图已不在此浏览器";
        }
        actions.append(button);
      });
      card.append(art, meta, actions);
      return card;
    }),
  );
}
$("#save-gallery").onclick = async () => {
  const stamp = selected(),
    image = source();
  if (!stamp || !image || savingGallery) return;
  const match = galleryMatch(stamp);
  if (match.saved) return;
  const settings = validateSettings(stamp.settings),
    selectionQuad = stamp.selectionQuad && structuredClone(stamp.selectionQuad);
  savingGallery = true;
  controls();
  try {
    const png = await renderStamp(image.blob, settings);
    const bitmap = await createImageBitmap(png);
    let thumbnail;
    const { width, height } = bitmap;
    try {
      thumbnail = await thumbnailBlob(bitmap, 480);
    } finally {
      bitmap.close();
    }
    // The linked item may have been deleted while this stamp was rendering.
    const existing = gallery.find((item) => item.id === match.item?.id),
      now = Date.now();
    const item = {
      id: existing?.id || uid(),
      sourceId: image.id,
      name: image.name,
      settings,
      ...(selectionQuad ? { selectionQuad } : {}),
      png,
      thumbnail,
      width,
      height,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (existing) gallery[gallery.indexOf(existing)] = item;
    else gallery.unshift(item);
    stamp.galleryId = item.id;
    dirtyGallery.set(item.id, item);
    navigator.storage?.persist?.().catch(() => {});
    toast(existing ? "已更新 Gallery 中的这枚印章" : "已存入 Gallery");
    renderGallery();
    persist();
  } catch (error) {
    toast(error.message);
  } finally {
    savingGallery = false;
    controls();
  }
};
function showView() {
  const isGallery = location.hash === "#gallery";
  $(".workbench").hidden = isGallery;
  $("#gallery").hidden = !isGallery;
  [
    ["#tab-studio", !isGallery],
    ["#tab-gallery", isGallery],
  ].forEach(([id, active]) => {
    if (active) $(id).setAttribute("aria-current", "page");
    else $(id).removeAttribute("aria-current");
  });
}
window.addEventListener("hashchange", showView);

async function boot() {
  showView();
  try {
    if (!window.Worker || !window.OffscreenCanvas || !window.createImageBitmap)
      throw Error("请使用新版 Chrome、Edge、Firefox 或 Safari");
    let stored;
    try {
      stored = await storage.restore();
    } catch {
      toast("此浏览器暂时无法使用本地存储，编辑可继续，关闭页面前请先导出。");
    }
    if (stored) {
      stored.images
        .filter((image) => image.hidden)
        .forEach((image) => archived.set(image.id, image));
      stored.images = stored.images.filter((image) => !image.hidden);
      gallery = stored.gallery.map(validateGalleryItem).filter(Boolean);
      if (gallery.length < stored.gallery.length)
        toast(
          `有 ${stored.gallery.length - gallery.length} 枚 Gallery 印章无法读取，已跳过`,
        );
    }
    if (stored?.project) {
      images = stored.images;
      const { validateProject } = await import("./poster-model.js");
      project = validateProject(
        stored.project,
        new Set(images.map((image) => image.id)),
      );
      if (!images.some((image) => image.id === project.sourceId))
        project.sourceId = images[0]?.id || null;
      if (!selected()) project.selectedId = null;
      if (selected()) project.sourceId = selected().sourceId;
    } else if (stored?.images?.length) {
      images = stored.images;
      project.sourceId = images[0].id;
    } else {
      try {
        const [response, recipe] = await Promise.all([
          fetch("/demo.png"),
          fetch("/demo.json"),
        ]);
        if (!response.ok || !recipe.ok) throw Error("示例载入失败");
        const image = await readImage(
          await response.blob(),
          "MetroCard · 示例",
        );
        images.push(image);
        dirtyImages.set(image.id, image);
        project.sourceId = image.id;
        const stamp = makeStamp(image.id, (await recipe.json()).settings);
        stamp.x = 0.5;
        stamp.y = 0.45;
        stamp.width = 0.76;
        project.stamps.push(stamp);
        project.selectedId = stamp.id;
      } catch (error) {
        toast(error.message + "，可直接上传自己的图片");
      }
    }
    ready = true;
    $(".workbench").setAttribute("aria-busy", "false");
    library();
    controls();
    poster();
    renderGallery();
    await loadSource();
    project.stamps.forEach((stamp, i) => queuePreview(stamp, i * 120));
    persist();
  } catch (error) {
    $("#storage-status").textContent = "恢复失败";
    toast(error.message);
    controls();
  }
}
boot();
