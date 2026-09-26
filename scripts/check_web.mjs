import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, renderPixels, validateSettings } from '../assets/studio/stamp-engine.js';
import { zip } from '../assets/studio/zip.js';

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
