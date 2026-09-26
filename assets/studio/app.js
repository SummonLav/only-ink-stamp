'use strict';
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const presets = {
  balanced: {density:.78,variation:.48,edge:.55,edge_variation:.72,grain:.30,wear:.18,bleed:.12},
  dry: {density:.67,variation:.77,edge:.48,edge_variation:.85,grain:.50,wear:.62,bleed:.04},
  rich: {density:.92,variation:.30,edge:.85,edge_variation:.58,grain:.18,wear:.07,bleed:.23}
};
let config, defaults, token, rev, sourceName, img = new Image(), tool = 'rect', drawing = false, picking = false;
let start, points = [], current, timer, requestId = 0, aborter, previewURL, lastRender = false, toastTimer;
const canvas = $('#source'), ctx = canvas.getContext('2d', {willReadFrequently:true});
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 6500); }
async function api(path, body, signal) {
  if (window.InkBrowser) return window.InkBrowser.request(path, body, signal);
  const res = await fetch(path, {method:'POST',headers:{'Content-Type':'application/json','X-Stamp-Token':token},body:JSON.stringify(body),signal});
  if (!res.ok) { const data = await res.json(); throw Error(data.error || '处理失败'); }
  return res;
}
function refreshControls() {
  $$('[data-param]').forEach(el => {
    const value = config[el.dataset.param];
    if (el.type === 'checkbox') el.checked = !!value; else el.value = value;
    if (el.type === 'range') { el.style.setProperty('--value', `${value*100}%`); const label = $(`label[for="${el.id}"]`); if (label?.querySelector('output')) label.querySelector('output').textContent = `${Math.round(value*100)}%`; }
  });
  $('#hex-label').textContent = config.color.toUpperCase();
  $$('.swatches button').forEach(b => {b.classList.toggle('active', b.dataset.color.toLowerCase() === config.color.toLowerCase()); b.setAttribute('aria-pressed', b.classList.contains('active'));});
  $('#color-extraction').hidden = config.mode !== 'color';
  $('#tone-extraction').hidden = ['color','alpha'].includes(config.mode);
  ['cx','cy','cw','ch'].forEach((id,i) => $('#'+id).value = +(config.region[i]*100).toFixed(1));
  $('#selection-info').textContent = `${config.polygon.length ? '套索选区' : '矩形选区'} · ${(config.region[2]*100).toFixed(1)}% × ${(config.region[3]*100).toFixed(1)}%`;
}
function schedule() { clearTimeout(timer); requestId++; lastRender=false; $('#preview-status').textContent='正在上墨…'; timer=setTimeout(renderPreview,180); }
async function renderPreview() {
  const id=requestId; aborter?.abort(); aborter=new AbortController();
  try {
    const res=await api('/api/render',{settings:config,rev},aborter.signal); const blob=await res.blob();
    if(id!==requestId) return;
    if(previewURL) URL.revokeObjectURL(previewURL); previewURL=URL.createObjectURL(blob); $('#preview').src=previewURL;
    $('#preview-status').textContent='已落印'; lastRender=true;
  } catch(e) { if(e.name!=='AbortError'&&id===requestId) {$('#preview-status').textContent='预览失败';toast(e.message);} }
}
function draw() {
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0,canvas.width,canvas.height);
  if(!config) return;
  const r = current || config.region, poly = drawing ? (tool==='lasso' ? points : []) : config.polygon;
  ctx.save();ctx.beginPath();ctx.rect(0,0,canvas.width,canvas.height);
  if(poly.length>=3) {ctx.moveTo(poly[0][0]*canvas.width,poly[0][1]*canvas.height);poly.slice(1).forEach(p=>ctx.lineTo(p[0]*canvas.width,p[1]*canvas.height));ctx.closePath();}
  else ctx.rect(r[0]*canvas.width,r[1]*canvas.height,r[2]*canvas.width,r[3]*canvas.height);
  ctx.fillStyle='rgba(0,0,0,.35)';ctx.fill('evenodd');
  ctx.beginPath();
  if(poly.length>=3) {ctx.moveTo(poly[0][0]*canvas.width,poly[0][1]*canvas.height);poly.slice(1).forEach(p=>ctx.lineTo(p[0]*canvas.width,p[1]*canvas.height));ctx.closePath();}
  else ctx.rect(r[0]*canvas.width,r[1]*canvas.height,r[2]*canvas.width,r[3]*canvas.height);
  ctx.strokeStyle='#fff';ctx.lineWidth=3;ctx.stroke();ctx.strokeStyle='#222222';ctx.lineWidth=1.5;ctx.setLineDash([7,5]);ctx.stroke();ctx.restore();
}
function point(e) {const r=canvas.getBoundingClientRect();return [Math.max(0,Math.min(1,(e.clientX-r.left)/r.width)),Math.max(0,Math.min(1,(e.clientY-r.top)/r.height))];}
function rectangle(a,b) {return [Math.min(a[0],b[0]),Math.min(a[1],b[1]),Math.abs(a[0]-b[0]),Math.abs(a[1]-b[1])];}
canvas.addEventListener('pointerdown',e=>{
  if(!config||!img.complete) return;
  const p=point(e);
  if(picking) {
    const sample=document.createElement('canvas'); sample.width=img.naturalWidth;sample.height=img.naturalHeight;const c=sample.getContext('2d');c.drawImage(img,0,0);
    const pixel=c.getImageData(Math.min(sample.width-1,Math.floor(p[0]*sample.width)),Math.min(sample.height-1,Math.floor(p[1]*sample.height)),1,1).data;
    config.source_color='#'+[...pixel].slice(0,3).map(n=>n.toString(16).padStart(2,'0')).join('');picking=false;$('#pick').textContent='吸色';refreshControls();schedule();return;
  }
  canvas.setPointerCapture(e.pointerId);drawing=true;start=p;points=[p];current=rectangle(p,p);draw();
});
canvas.addEventListener('pointermove',e=>{if(!drawing)return;const p=point(e);if(tool==='lasso'){if(points.length<1900&&Math.hypot(p[0]-points.at(-1)[0],p[1]-points.at(-1)[1])>.002)points.push(p);}else current=rectangle(start,p);draw();});
canvas.addEventListener('pointerup',e=>{
  if(!drawing)return;drawing=false;
  if(tool==='lasso'&&points.length>=3){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);current=[Math.min(...xs),Math.min(...ys),Math.max(...xs)-Math.min(...xs),Math.max(...ys)-Math.min(...ys)];}
  if(current&&current[2]>.003&&current[3]>.003){config.region=current;config.polygon=tool==='lasso'?points:[];refreshControls();schedule();}
  current=null;draw();
});
canvas.addEventListener('pointercancel',()=>{drawing=false;current=null;draw();});
$$('[data-tool]').forEach(b=>b.onclick=()=>{tool=b.dataset.tool;picking=false;$('#pick').textContent='吸色';$$('[data-tool]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b);});});
$('#all').onclick=()=>{config.region=[0,0,1,1];config.polygon=[];refreshControls();draw();schedule();};
$('#apply-region').onclick=()=>{const r=['cx','cy','cw','ch'].map(id=>Number($('#'+id).value)/100);if(r.some(n=>!Number.isFinite(n))||r[0]<0||r[1]<0||r[2]<=0||r[3]<=0||r[0]+r[2]>1.00001||r[1]+r[3]>1.00001)return toast('选区需要完整位于图片内');config.region=r;config.polygon=[];refreshControls();draw();schedule();};
$('#pick').onclick=()=>{picking=!picking;$('#pick').textContent=picking?'请点击原图中的颜色…':'吸色';};
$$('[data-param]').forEach(el=>el.addEventListener('input',()=>{
  config[el.dataset.param]=el.type==='checkbox'?el.checked:(el.type==='range'||el.id==='size'?Number(el.value):el.value);
  if(Object.keys(presets.balanced).includes(el.dataset.param))$$('[data-preset]').forEach(b=>{b.classList.remove('active');b.setAttribute('aria-pressed','false');});
  refreshControls();schedule();
}));
$$('[data-color]').forEach(b=>b.onclick=()=>{config.color=b.dataset.color;refreshControls();schedule();});
$$('[data-preset]').forEach(b=>b.onclick=()=>{Object.assign(config,presets[b.dataset.preset]);$$('[data-preset]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b);});refreshControls();schedule();});
$$('[data-bg]').forEach(b=>b.onclick=()=>{$('#preview-stage').classList.toggle('transparent',b.dataset.bg==='transparent');$$('[data-bg]').forEach(x=>{x.classList.toggle('active',x===b);x.setAttribute('aria-pressed',x===b);});});
$('#reset').onclick=()=>{Object.assign(config,presets.balanced,{color:defaults.color});refreshControls();$$('[data-preset]').forEach(b=>{b.classList.toggle('active',b.dataset.preset==='balanced');b.setAttribute('aria-pressed',b.dataset.preset==='balanced');});schedule();};
$('#reseed').onclick=()=>{config.seed=crypto.getRandomValues(new Uint32Array(1))[0];schedule();};
async function loadSource(){await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject(Error('图片读取失败'));img.src=window.InkBrowser ? window.InkBrowser.sourceURL() : '/api/source?v='+Date.now();});canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;draw();}
async function upload(file){
  if(!file)return;if(file.size>20*1024*1024)return toast('请使用小于 20 MB 的图片');
  try{const data=window.InkBrowser ? null : await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);});
    aborter?.abort();clearTimeout(timer);requestId++;const result=window.InkBrowser ? await window.InkBrowser.upload(file,file.name) : await (await api('/api/upload',{data,name:file.name})).json();rev=result.rev;sourceName=file.name;config.region=[0,0,1,1];config.polygon=[];
    await loadSource();refreshControls();schedule();toast('图片已载入，拖动选择一块图案');
  }catch(e){toast(e.message);}
}
$('#upload').onclick=()=>$('#file').click();$('#file').onchange=e=>{upload(e.target.files[0]);e.target.value='';};
const drop=$('#drop-zone');['dragenter','dragover'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.add('dragging');}));['dragleave','drop'].forEach(type=>drop.addEventListener(type,e=>{e.preventDefault();drop.classList.remove('dragging');}));drop.addEventListener('drop',e=>upload(e.dataTransfer.files[0]));
document.addEventListener('paste',e=>{const item=[...(e.clipboardData?.items||[])].find(i=>i.type.startsWith('image/'));if(item)upload(item.getAsFile());});
function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('#download').onclick=async()=>{const b=$('#download');b.disabled=true;try{const res=await api('/api/export',{settings:config,rev});download(await res.blob(),'ink-stamp.png');toast('透明 PNG 已导出');}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#save').onclick=async()=>{const b=$('#save');b.disabled=true;try{if(window.InkBrowser){download(await window.InkBrowser.bundle(config,rev),'ink-stamp.zip');toast('套装 ZIP 已下载');}else{const res=await api('/api/save',{settings:config,rev});const data=await res.json();toast('已保存透明图、纸张图和参数：'+data.path);}}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('#recipe').onclick=()=>download(new Blob([JSON.stringify(window.InkBrowser ? window.InkBrowser.recipe(config) : {version:1,source:{name:sourceName},settings:config},null,2)],{type:'application/json'}),'ink-stamp-recipe.json');
$('#import').onclick=()=>$('#recipe-file').click();$('#recipe-file').onchange=async e=>{try{const recipe=JSON.parse(await e.target.files[0].text());const candidate={...defaults,...(recipe.settings||recipe)};const res=await api('/api/render',{settings:candidate,rev});await res.blob();config=candidate;refreshControls();draw();schedule();toast('参数已恢复；选区按当前图片应用');}catch(e){toast('参数读取失败：'+e.message);}finally{e.target.value='';}};
async function boot(){try{let data;if(window.InkBrowser){data=await window.InkBrowser.state();}else{const res=await fetch('/api/state');if(!res.ok)throw Error('工坊连接失败');data=await res.json();}config=data.settings;defaults=structuredClone(config);token=data.token;rev=data.rev;sourceName=data.name;refreshControls();await loadSource();schedule();}catch(e){toast(e.message);$('#preview-status').textContent='连接失败';}}
boot();
