// Browser renderer v1. Settings match the Python engine; each engine has its own seeded texture.
export const DEFAULTS = {
  color:'#217451', density:.78, variation:.48, edge:.55, edge_variation:.72,
  grain:.30, wear:.18, bleed:.12, threshold:.18, softness:.20, tolerance:.30,
  mode:'auto', source_color:'#217451', invert:false, seed:26,
  region:[0,0,1,1], polygon:[], padding:.08, size:1600
};
const clamp = n => Math.max(0, Math.min(1, n));
export function validateSettings(input) {
  const s = {...DEFAULTS, ...input};
  for (const key of ['density','variation','edge','edge_variation','grain','wear','bleed','threshold','softness','tolerance']) {
    if (!Number.isFinite(s[key]) || s[key] < 0 || s[key] > 1) throw Error(`${key} 必须在 0–1 之间`);
  }
  for (const key of ['color','source_color']) if (!/^#[0-9a-f]{6}$/i.test(s[key])) throw Error('颜色格式应为 #RRGGBB');
  if (!['auto','luminance','color','alpha'].includes(s.mode)) throw Error('未知提取模式');
  if (typeof s.invert !== 'boolean') throw Error('反转参数必须为布尔值');
  if (!Number.isInteger(s.size) || s.size < 64 || s.size > 4096) throw Error('尺寸必须在 64–4096 之间');
  if (!Number.isInteger(s.seed) || s.seed < 0 || s.seed > 4294967295) throw Error('随机种子无效');
  if (!Number.isFinite(s.padding) || s.padding < 0 || s.padding > .3) throw Error('留白必须在 0–0.3 之间');
  const r = s.region;
  if (!Array.isArray(r) || r.length !== 4 || r.some(n => !Number.isFinite(n) || n < 0 || n > 1) ||
      r[2] <= 0 || r[3] <= 0 || r[0]+r[2] > 1.00001 || r[1]+r[3] > 1.00001) throw Error('选区需要完整位于图片内');
  if (!Array.isArray(s.polygon) || (s.polygon.length && s.polygon.length < 3) || s.polygon.length > 2000 ||
      s.polygon.some(p => !Array.isArray(p) || p.length !== 2 || p.some(n => !Number.isFinite(n) || n < 0 || n > 1))) throw Error('套索选区无效');
  return structuredClone(s);
}
function random(seed) {
  return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function field(w, h, cells, rng) {
  const gw = Math.max(2, Math.round(cells*w/Math.max(w,h))), gh = Math.max(2, Math.round(cells*h/Math.max(w,h)));
  const grid = Float32Array.from({length:gw*gh}, rng);
  return (x,y) => {
    const u=x/Math.max(1,w-1)*(gw-1), v=y/Math.max(1,h-1)*(gh-1), a=Math.floor(u), b=Math.floor(v);
    const tx=(u-a)**2*(3-2*(u-a)), ty=(v-b)**2*(3-2*(v-b));
    const right=Math.min(a+1,gw-1), bottom=Math.min(b+1,gh-1);
    return (grid[b*gw+a]*(1-tx)+grid[b*gw+right]*tx)*(1-ty) + (grid[bottom*gw+a]*(1-tx)+grid[bottom*gw+right]*tx)*ty;
  };
}
// Separable box blur gives bounded work even for the largest export.
function blur(src, w, h, radius) {
  const r=Math.max(1,Math.round(radius)), span=r*2+1, tmp=new Float32Array(src.length), out=new Float32Array(src.length);
  for(let y=0;y<h;y++) {
    const row=y*w; let sum=0;
    for(let k=-r;k<=r;k++) sum+=src[row+Math.max(0,Math.min(w-1,k))];
    for(let x=0;x<w;x++) {tmp[row+x]=sum/span;sum+=src[row+Math.min(w-1,x+r+1)]-src[row+Math.max(0,x-r)];}
  }
  for(let x=0;x<w;x++) {
    let sum=0;for(let k=-r;k<=r;k++)sum+=tmp[Math.max(0,Math.min(h-1,k))*w+x];
    for(let y=0;y<h;y++){out[y*w+x]=sum/span;sum+=tmp[Math.min(h-1,y+r+1)*w+x]-tmp[Math.max(0,y-r)*w+x];}
  }
  return out;
}
const rgb = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16));
export function renderPixels(data, w, h, input, selection) {
  const s=validateSettings(input), length=w*h, mask=new Float32Array(length), target=rgb(s.source_color).map(n=>n/255);
  for(let i=0;i<length;i++) {
    const j=i*4,r=data[j]/255,g=data[j+1]/255,b=data[j+2]/255;
    let strength;
    if(s.mode==='alpha') strength=1;
    else if(s.mode==='color') strength=clamp((s.tolerance-Math.hypot(r-target[0],g-target[1],b-target[2])/Math.sqrt(3))/Math.max(.025,s.softness*.25));
    else {
      strength=1-(r*.2126+g*.7152+b*.0722);
      if(s.mode==='auto') strength=Math.max(strength,(Math.max(r,g,b)-Math.min(r,g,b))*.94);
      strength=clamp((strength-s.threshold)/Math.max(.01,s.softness));
    }
    if(s.invert) strength=1-strength;
    mask[i]=strength*data[j+3]/255*(selection ? selection[i] : 1);
  }
  const soft=blur(mask,w,h,Math.max(.7,Math.max(w,h)*.0035)), rng=random(s.seed);
  const coarse=field(w,h,7,rng), medium=field(w,h,27,rng), fine=field(w,h,Math.max(60,Math.floor(s.size/3)),rng);
  const patches=field(w,h,12,rng), dry=field(w,h,Math.max(40,Math.floor(s.size/7)),rng);
  const color=rgb(s.color), out=new Uint8ClampedArray(length*4), ink=new Float32Array(length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const i=y*w+x,j=i*4,pressure=.7*coarse(x,y)+.3*medium(x,y);
    const rim=clamp((mask[i]-soft[i])*2.9), local=(1-s.edge_variation)+s.edge_variation*clamp((patches(x,y)-.28)*2.1), pool=rim*s.edge*local;
    let opacity=clamp(s.density*(1-s.variation*1.4*(1-pressure)));
    opacity+=(1-opacity)*pool*.94;
    opacity*=1-s.grain*(.16+.62*(.62*fine(x,y)+.38*rng()));
    opacity*=1-clamp((dry(x,y)-(1-s.wear*.58))*16)*.96;
    ink[i]=mask[i]*clamp(opacity);
    for(let c=0;c<3;c++)out[j+c]=Math.floor(color[c]*(1-pool*.2));
  }
  const spread=s.bleed ? blur(ink,w,h,Math.max(.4,s.size*.0009)) : null;
  for(let i=0;i<length;i++) {
    let alpha=spread ? Math.max(ink[i],spread[i]*s.bleed*.32) : ink[i];
    if(selection) alpha*=selection[i];
    out[i*4+3]=Math.floor(clamp(alpha*Math.min(1,s.density*12))*255);
  }
  return out;
}
