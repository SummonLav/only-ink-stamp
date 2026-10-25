import { validateSettings } from "./stamp-engine.js";
import { dimensions, placement } from "./poster-model.js";

// Bound decoding and pixel processing when restoring a poster with many stamps.
const queue = [];
let active = 0;
function drain() {
  while (active < 2 && queue.length) {
    const job = queue.shift();
    job.signal?.removeEventListener("abort", job.cancel);
    active++;
    render(job.blob, job.settings, job.options)
      .then(job.resolve, job.reject)
      .finally(() => {
        active--;
        drain();
      });
  }
}
export function renderStamp(blob, settings, options = {}) {
  return new Promise((resolve, reject) => {
    const signal = options.signal;
    if (signal?.aborted)
      return reject(new DOMException("已取消", "AbortError"));
    const job = {
      blob,
      settings: validateSettings(settings),
      options,
      signal,
      resolve,
      reject,
    };
    job.cancel = () => {
      const index = queue.indexOf(job);
      if (index >= 0) {
        queue.splice(index, 1);
        reject(new DOMException("已取消", "AbortError"));
      }
    };
    signal?.addEventListener("abort", job.cancel, { once: true });
    queue.push(job);
    drain();
  });
}

function render(blob, settings, { preview = false, signal } = {}) {
  const valid = validateSettings(settings);
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(new DOMException("已取消", "AbortError"));
    const worker = new Worker(new URL("./stamp-worker.js", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
      clearTimeout(timeout);
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("已取消", "AbortError"));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(Error("渲染超时，请减小尺寸后重试"));
    }, 90000);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = ({ data }) => {
      cleanup();
      data.error ? reject(Error(data.error)) : resolve(data.png);
    };
    worker.onerror = () => {
      cleanup();
      reject(Error("图片处理失败，请重试"));
    };
    worker.postMessage({ blob, settings: valid, preview });
  });
}
export async function exportPoster(
  project,
  images,
  longSide,
  progress = () => {},
) {
  const size = dimensions(project.ratio, longSide);
  const canvas = document.createElement("canvas");
  Object.assign(canvas, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = project.background;
  ctx.fillRect(0, 0, size.width, size.height);
  ctx.imageSmoothingQuality = "high";
  for (const [index, stamp] of project.stamps.entries()) {
    const source = images.find((image) => image.id === stamp.sourceId);
    if (!source) throw Error("印章原图缺失，请重新载入图片");
    const [, , rw, rh] = stamp.settings.region;
    const aspect = (source.height * rh) / (source.width * rw);
    const needed = Math.ceil(stamp.width * size.width * Math.max(1, aspect));
    const blob = await renderStamp(source.blob, {
      ...stamp.settings,
      size: Math.max(64, Math.min(4096, needed)),
    });
    const bitmap = await createImageBitmap(blob);
    const p = placement(stamp, bitmap, size);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.angle);
    ctx.drawImage(bitmap, -p.width / 2, -p.height / 2, p.width, p.height);
    ctx.restore();
    bitmap.close();
    progress(index + 1, project.stamps.length);
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(Error("Poster 导出失败"))),
      "image/png",
    ),
  );
}
