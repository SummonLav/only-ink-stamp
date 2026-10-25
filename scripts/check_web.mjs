import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, renderPixels, validateSettings } from '../assets/studio/stamp-engine.js';
import { zip } from '../assets/studio/zip.js';
import { bounds, corners, validQuad, shaped, dimensions, placement, validateProject, quadCenter, rotateQuad, clippedSelection, dragAngle, normalizeAngle, recipeKey, validateGalleryItem } from '../assets/studio/poster-model.js';

const w=96,h=64;
const pixels=new Uint8ClampedArray(w*h*4);
for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
  const i=(y*w+x)*4,value=x>12&&x<84&&y>10&&y<54 ? 0 : 255;
  pixels.set([value,value,value,255],i);
}
const settings={...DEFAULTS,size:96};
const render=(s={},mask)=>renderPixels(pixels,w,h,{...settings,...s},mask);
const alphaSum=data=>data.reduce((sum,n,i)=>sum+(i%4===3?n:0),0);

test('transparent negative space, zero ink, and color channels',()=>{
  const result=render({color:'#d6538e',bleed:0});
  assert.equal(result[3],0);
  assert.ok(alphaSum(result)>0);
  assert.equal(alphaSum(render({density:0})),0);
  for(let i=0;i<result.length;i+=4)if(result[i+3])assert.ok(result[i]>result[i+2]&&result[i+2]>result[i+1]);
});
test('seed is reproducible, density and texture controls affect the image',()=>{
  assert.deepEqual(render(),render());
  assert.notDeepEqual(render(),render({seed:27}));
  assert.ok(alphaSum(render({density:.2}))<alphaSum(render({density:.9})));
  for(const key of ['variation','edge','edge_variation','grain','wear','bleed'])assert.notDeepEqual(render({[key]:0}),render({[key]:1}),key);
});
test('lasso remains transparent outside its mask, including bleed',()=>{
  const mask=Float32Array.from({length:w*h},(_,i)=>i%w<w/2?1:0),result=render({bleed:1},mask);
  for(let i=0;i<mask.length;i++)if(!mask[i])assert.equal(result[i*4+3],0);
});
test('alpha and inverted extraction preserve existing transparent pixels',()=>{
  const rgba=new Uint8ClampedArray([0,0,0,0,255,255,255,255]);
  for(const mode of ['alpha','auto','luminance','color']){
    const result=renderPixels(rgba,2,1,{...settings,mode,invert:true,bleed:0});
    assert.equal(result[3],0);
  }
});
test('recipe validation rejects invalid dimensions and selections',()=>{
  for(const change of [{size:Infinity},{size:4097},{seed:-1},{region:[.8,0,.5,1]},{polygon:[[0,0]]},{color:'pink'},{density:NaN},{invert:'false'}])assert.throws(()=>validateSettings(change));
});
test('ZIP contains file headers, CRC32, and a complete central directory',async()=>{
  const data=new Uint8Array(await (await zip([['test.txt',new Blob(['123456789'])]])).arrayBuffer()),v=new DataView(data.buffer);
  assert.equal(v.getUint32(0,true),0x04034b50);
  assert.equal(v.getUint32(14,true),0xcbf43926);
  assert.equal(v.getUint32(data.length-22,true),0x06054b50);
  const central=v.getUint32(data.length-6,true);
  assert.equal(v.getUint32(central,true),0x02014b50);
});

test('editable quadrilaterals reject crossings, inversion, and collapsed selections', () => {
  const rectangle = corners([.1, .2, .6, .5]);
  assert.ok(validQuad(rectangle));
  assert.ok(validQuad([[.2, .3], [.7, .2], [.7, .7], [.1, .7]]));
  assert.equal(validQuad([rectangle[0], rectangle[2], rectangle[1], rectangle[3]]), false);
  assert.equal(validQuad([...rectangle].reverse()), false);
  assert.equal(validQuad(corners([0, 0, .0001, .4])), false);
  assert.equal(validQuad([[-.1, 0], [.5, 0], [.5, 1], [0, 1]]), false);
  for (const shape of ['rect', 'trapezoid', 'slant', 'diamond']) {
    const points = shaped([.1, .2, .6, .5], shape);
    assert.ok(validQuad(points), shape);
    bounds(points).forEach((n, i) => assert.ok(Math.abs(n - [.1, .2, .6, .5][i]) < 1e-9));
  }
});

test('poster ratios and rotated image placement preserve the complete composition', () => {
  assert.deepEqual(dimensions('3:4', 2400), { width: 1800, height: 2400 });
  assert.deepEqual(dimensions('1:1', 2400), { width: 2400, height: 2400 });
  assert.deepEqual(dimensions('9:16', 3200), { width: 1800, height: 3200 });
  const p = placement({ x: .25, y: .8, width: .5, rotation: 90 }, { width: 600, height: 300 }, { width: 1800, height: 2400 });
  assert.deepEqual(p, { x: 450, y: 1920, width: 900, height: 450, angle: Math.PI / 2 });
});

test('restoration keeps stamp links and independent settings while excluding orphaned stamps', () => {
  const stamp = { id: 'stamp-a', sourceId: 'source-a', x: .5, y: .5, width: .6, rotation: 12, settings: { ...DEFAULTS, polygon: shaped([0, 0, 1, 1], 'trapezoid') } };
  const input = { version: 1, ratio: '3:4', background: '#faf8f3', stamps: [stamp, { ...stamp, id: 'orphan', sourceId: 'missing' }] };
  const result = validateProject(input, new Set(['source-a']));
  assert.equal(result.stamps.length, 1);
  assert.deepEqual(result.stamps[0], stamp);
  result.stamps[0].settings.polygon[0][0] = .4;
  assert.equal(stamp.settings.polygon[0][0], .2);
  assert.throws(() => validateProject({ ...input, ratio: '2:3' }, new Set(['source-a'])));
  assert.throws(() => validateProject({ ...input, stamps: [{ ...stamp, width: NaN }] }, new Set(['source-a'])));
  assert.throws(() => validateProject({ ...input, stamps: [stamp, stamp] }, new Set(['source-a'])));
});

test('selection rotation preserves pixel geometry on portrait and landscape originals', () => {
  const quad = shaped([.25, .3, .4, .3], 'trapezoid');
  for (const [width, height] of [[400, 1600], [1600, 400]]) {
    const rotated = rotateQuad(quad, 73, width, height);
    const restored = rotateQuad(rotated, -73, width, height);
    const length = (points, i) => Math.hypot((points[i][0] - points[(i + 1) % 4][0]) * width, (points[i][1] - points[(i + 1) % 4][1]) * height);
    quad.forEach((point, i) => {
      assert.ok(Math.abs(length(rotated, i) - length(quad, i)) < 1e-8);
      point.forEach((value, axis) => assert.ok(Math.abs(restored[i][axis] - value) < 1e-10));
    });
    quadCenter(quad).forEach((value, i) => assert.ok(Math.abs(quadCenter(rotated)[i] - value) < 1e-10));
  }
});

test('edge-crossing rotation clips only the render mask and preserves the editable quad', () => {
  const quad = rotateQuad(corners([0, 0, 1, 1]), 45, 800, 800);
  assert.ok(validQuad(quad, true));
  const clipped = clippedSelection(quad);
  assert.equal(clipped.polygon.length, 8);
  assert.deepEqual(clipped.region, [0, 0, 1, 1]);
  assert.doesNotThrow(() => validateSettings({ ...DEFAULTS, ...clipped }));
  const stamp = { id: 'rotated', sourceId: 'source', x: .5, y: .5, width: .7, rotation: -35, selectionQuad: quad, settings: { ...DEFAULTS, ...clipped } };
  const result = validateProject({ version: 1, ratio: '3:4', background: '#ffffff', stamps: [stamp] }, new Set(['source']));
  assert.deepEqual(result.stamps[0].selectionQuad, quad);
  result.stamps[0].selectionQuad[0][0] = 0;
  assert.notEqual(quad[0][0], 0);
  assert.equal(clippedSelection(corners([2, 2, 1, 1])), null);
});

test('corner rotation crosses the angle seam smoothly and Shift snaps to 15 degrees', () => {
  const rad = angle => angle * Math.PI / 180;
  assert.equal(dragAngle(rad(179), rad(-179)), 2);
  assert.equal(dragAngle(rad(-179), rad(179)), -2);
  assert.equal(dragAngle(rad(20), rad(52), 0, true), 30);
  assert.equal(dragAngle(rad(20), rad(53), 23, true), 60);
  assert.equal(normalizeAngle(370), 10);
  assert.equal(normalizeAngle(-370), -10);
  assert.equal(dragAngle(0, rad(30.1)), 30.1);
});

test('gallery items keep their recipe and skip unreadable records', () => {
  const quad = rotateQuad(corners([.2, .2, .5, .4]), 30, 800, 600);
  const settings = validateSettings({ ...DEFAULTS, ...clippedSelection(quad), color: '#bf4f8b' });
  const blob = new Blob(['png'], { type: 'image/png' });
  const item = { id: 'item', sourceId: 'source', name: 'card.png', settings, selectionQuad: quad, png: blob, thumbnail: blob, width: 640, height: 480, createdAt: 1, updatedAt: 2 };
  const result = validateGalleryItem(item);
  assert.deepEqual(result.settings, settings);
  assert.equal(recipeKey(result), recipeKey({ settings: { ...settings }, selectionQuad: quad }));
  assert.notEqual(recipeKey(result), recipeKey({ settings: { ...settings, seed: 27 }, selectionQuad: quad }));
  assert.notEqual(recipeKey(result), recipeKey({ settings }));
  assert.equal(validateGalleryItem({ ...item, png: 'data:' }), null);
  assert.equal(validateGalleryItem({ ...item, settings: { ...settings, density: 2 } }), null);
  assert.equal(validateGalleryItem({ ...item, selectionQuad: [[0, 0], [1, 0]] }), null);
  assert.equal(validateGalleryItem({ ...item, name: undefined }).name, '印章');
});
