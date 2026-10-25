import { DEFAULTS, validateSettings } from "./stamp-engine.js";

export const RATIOS = { "3:4": 3 / 4, "1:1": 1, "9:16": 9 / 16 };
export const clamp = (n, min = 0, max = 1) => Math.max(min, Math.min(max, n));
export const uid = () => crypto.randomUUID();
export const corners = ([x, y, w, h]) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
export function bounds(points) {
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]);
  const x = Math.min(...xs),
    y = Math.min(...ys);
  return [x, y, Math.max(...xs) - x, Math.max(...ys) - y];
}
export function validQuad(points, allowOutside = false) {
  if (
    points.length !== 4 ||
    points.some(
      (p) =>
        p.length !== 2 ||
        p.some(
          (n) => !Number.isFinite(n) || (!allowOutside && (n < 0 || n > 1)),
        ),
    )
  )
    return false;
  const crosses = points.map((a, i) => {
    const b = points[(i + 1) % 4],
      c = points[(i + 2) % 4];
    return (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
  });
  return (
    crosses.every((n) => n > 0.00001) &&
    bounds(points)
      .slice(2)
      .every((n) => n >= 0.005)
  );
}
export const normalizeAngle = (angle) =>
  Math.round((((((angle + 180) % 360) + 360) % 360) - 180) * 1e6) / 1e6;
export function dragAngle(start, current, original = 0, snap = false) {
  const angle = original + normalizeAngle(((current - start) * 180) / Math.PI);
  return normalizeAngle(
    snap ? Math.round(angle / 15) * 15 : Math.round(angle * 10) / 10,
  );
}
export function quadCenter(points) {
  return [0, 1].map(
    (axis) =>
      points.reduce((sum, point) => sum + point[axis], 0) / points.length,
  );
}
export function rotateQuad(points, degrees, width, height) {
  const [cx, cy] = quadCenter(points),
    angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  // Work in image pixels: normalized coordinates distort rotations on non-square photos.
  return points.map(([x, y]) => {
    const dx = (x - cx) * width,
      dy = (y - cy) * height;
    return [
      cx + (dx * cos - dy * sin) / width,
      cy + (dx * sin + dy * cos) / height,
    ];
  });
}
export function clippedSelection(quad) {
  let polygon = quad.map((point) => [...point]);
  for (const [axis, edge, sign] of [
    [0, 0, 1],
    [0, 1, -1],
    [1, 0, 1],
    [1, 1, -1],
  ]) {
    const input = polygon;
    polygon = [];
    input.forEach((point, index) => {
      const previous = input[(index + input.length - 1) % input.length];
      const inside = (point[axis] - edge) * sign >= 0;
      const wasInside = (previous[axis] - edge) * sign >= 0;
      if (inside !== wasInside) {
        const t = (edge - previous[axis]) / (point[axis] - previous[axis]);
        const hit = previous.map((value, i) => value + t * (point[i] - value));
        hit[axis] = edge;
        polygon.push(hit);
      }
      if (inside) polygon.push(point);
    });
  }
  polygon = polygon.map((point) => point.map((value) => clamp(value)));
  const area =
    Math.abs(
      polygon.reduce((sum, a, i) => {
        const b = polygon[(i + 1) % polygon.length];
        return sum + a[0] * b[1] - a[1] * b[0];
      }, 0),
    ) / 2;
  if (polygon.length < 3 || area < 0.000025) return null;
  return { region: bounds(polygon), polygon };
}
export function shaped(region, shape) {
  const [x, y, w, h] = region;
  if (shape === "trapezoid")
    return [
      [x + w * 0.2, y],
      [x + w * 0.8, y],
      [x + w, y + h],
      [x, y + h],
    ];
  if (shape === "slant")
    return [
      [x + w * 0.2, y],
      [x + w, y],
      [x + w * 0.8, y + h],
      [x, y + h],
    ];
  if (shape === "diamond")
    return [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
    ];
  return corners(region);
}
export function makeStamp(sourceId, settings = DEFAULTS, index = 0) {
  return {
    id: uid(),
    sourceId,
    settings: validateSettings(settings),
    x: 0.5 + ((index % 3) - 1) * 0.06,
    y: 0.38 + (index % 4) * 0.08,
    width: 0.6,
    rotation: 0,
  };
}
export function dimensions(ratio, longSide) {
  return { width: Math.round(longSide * RATIOS[ratio]), height: longSide };
}
export function placement(stamp, image, poster) {
  const width = stamp.width * poster.width;
  return {
    x: stamp.x * poster.width,
    y: stamp.y * poster.height,
    width,
    height: (width * image.height) / image.width,
    angle: (stamp.rotation * Math.PI) / 180,
  };
}
export function validateProject(raw, sourceIds) {
  if (
    !raw ||
    raw.version !== 1 ||
    !(raw.ratio in RATIOS) ||
    !/^#[0-9a-f]{6}$/i.test(raw.background) ||
    !Array.isArray(raw.stamps)
  )
    throw Error("本地 Poster 数据无法读取");
  const stamps = raw.stamps
    .filter((s) => sourceIds.has(s.sourceId))
    .map((s) => {
      if (
        typeof s.id !== "string" ||
        ![s.x, s.y, s.width, s.rotation].every(Number.isFinite) ||
        s.width < 0.05 ||
        s.width > 1.5 ||
        s.x < 0 ||
        s.x > 1 ||
        s.y < 0 ||
        s.y > 1 ||
        Math.abs(s.rotation) > 180
      )
        throw Error("本地印章位置无效");
      if (
        s.selectionQuad &&
        (!validQuad(s.selectionQuad, true) ||
          !clippedSelection(s.selectionQuad))
      )
        throw Error("本地旋转选区无效");
      const settings = validateSettings(
        s.selectionQuad
          ? { ...s.settings, ...clippedSelection(s.selectionQuad) }
          : s.settings,
      );
      return {
        ...s,
        ...(s.selectionQuad
          ? { selectionQuad: structuredClone(s.selectionQuad) }
          : {}),
        settings,
      };
    });
  if (new Set(stamps.map((s) => s.id)).size !== stamps.length)
    throw Error("本地印章标识重复");
  return { ...raw, stamps };
}
// Stamps and Gallery items share settings and the editable quad; equal keys mean the same impression.
export const recipeKey = (stamp) =>
  JSON.stringify([{ ...DEFAULTS, ...stamp.settings }, stamp.selectionQuad || null]);
export function validateGalleryItem(raw) {
  if (
    !raw ||
    typeof raw.id !== "string" ||
    typeof raw.sourceId !== "string" ||
    !(raw.png instanceof Blob) ||
    !(raw.thumbnail instanceof Blob) ||
    ![raw.width, raw.height, raw.createdAt, raw.updatedAt].every(
      Number.isFinite,
    ) ||
    (raw.selectionQuad &&
      (!validQuad(raw.selectionQuad, true) ||
        !clippedSelection(raw.selectionQuad)))
  )
    return null;
  try {
    return {
      ...raw,
      name: String(raw.name || "印章"),
      settings: validateSettings(raw.settings),
    };
  } catch {
    return null;
  }
}
