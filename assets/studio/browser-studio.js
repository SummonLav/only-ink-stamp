import { validateSettings } from './stamp-engine.js';
import { zip } from './zip.js';

let source,sourceURL,sourceName,revision=0,uploadId=0;
async function setSource(blob,name){
  const id=++uploadId;
  if(blob.size>20*1024*1024)throw Error('请使用小于 20 MB 的图片');
  let bitmap;
  try{bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{throw Error('图片无法读取，请选择 PNG、JPEG 或 WebP 图片');}
  const tooLarge=bitmap.width*bitmap.height>30000000;bitmap.close();
  if(tooLarge)throw Error('图片不能超过 3000 万像素');
  if(id!==uploadId)throw new DOMException('已载入另一张图片','AbortError');
  if(sourceURL)URL.revokeObjectURL(sourceURL);
  source=blob;sourceName=name;sourceURL=URL.createObjectURL(blob);revision++;
  return {rev:revision,name:sourceName};
}
function render(settings,rev,{signal,preview=false,bundle=false}={}){
  const valid=validateSettings(settings);
  if(rev!==revision)throw Error('原图已更换，请重新操作');
  if(signal?.aborted)return Promise.reject(new DOMException('已取消','AbortError'));
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./stamp-worker.js',import.meta.url),{type:'module'});
    const cleanup=()=>{worker.terminate();signal?.removeEventListener('abort',cancel);};
    const cancel=()=>{cleanup();reject(new DOMException('已取消','AbortError'));};
    signal?.addEventListener('abort',cancel,{once:true});
    worker.onmessage=({data})=>{cleanup();data.error?reject(Error(data.error)):resolve(data);};
    worker.onerror=()=>{cleanup();reject(Error('图片处理失败，请减小导出尺寸后重试'));};
    worker.postMessage({blob:source,settings:valid,preview,bundle});
  });
}
window.InkBrowser={
  sourceURL:()=>sourceURL,
  upload:setSource,
  async state(){
    if(!window.Worker||!window.OffscreenCanvas||!window.createImageBitmap)throw Error('请使用新版 Chrome、Edge、Firefox 或 Safari 打开工坊');
    const [image,recipe]=await Promise.all([fetch('/demo.png'),fetch('/demo.json')]);
    if(!image.ok||!recipe.ok)throw Error('示例载入失败，请刷新重试');
    const settings=validateSettings((await recipe.json()).settings);
    await setSource(await image.blob(),'source.png');
    return {settings,rev:revision,name:sourceName};
  },
  async request(path,{settings,rev},signal){
    const result=await render(settings,rev,{signal,preview:path==='/api/render'});
    return new Response(result.png,{headers:{'Content-Type':'image/png'}});
  },
  recipe(settings){return {version:1,renderer:'browser-v1',source:{name:sourceName},settings:validateSettings(settings)};},
  async bundle(settings,rev){
    const original=source,recipe=this.recipe(settings);
    const rendered=await render(recipe.settings,rev,{bundle:true});
    const sha=await crypto.subtle.digest('SHA-256',await original.arrayBuffer());
    const ext=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/bmp':'bmp'})[original.type]||'image';
    recipe.source={name:`source.${ext}`,original_name:recipe.source.name,sha256:[...new Uint8Array(sha)].map(n=>n.toString(16).padStart(2,'0')).join('')};
    return zip([['ink-stamp.png',rendered.png],['ink-stamp-paper.png',rendered.paper],['ink-stamp.json',new Blob([JSON.stringify(recipe,null,2)])],[recipe.source.name,original]]);
  }
};
await import('./app.js');
