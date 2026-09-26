import { renderPixels, validateSettings } from './stamp-engine.js';

self.onmessage = async ({data:{blob,settings,preview,bundle}}) => {
  let bitmap;
  try {
    const s=validateSettings(settings);
    if(preview) s.size=Math.min(900,s.size);
    bitmap=await createImageBitmap(blob,{imageOrientation:'from-image'});
    const [x,y,rw,rh]=s.region, sx=Math.round(x*bitmap.width),sy=Math.round(y*bitmap.height);
    const sw=Math.max(1,Math.min(bitmap.width-sx,Math.round((x+rw)*bitmap.width)-sx));
    const sh=Math.max(1,Math.min(bitmap.height-sy,Math.round((y+rh)*bitmap.height)-sy));
    if(sx>=bitmap.width||sy>=bitmap.height) throw Error('选区小于一个像素');
    const w=Math.max(1,Math.round(sw/Math.max(sw,sh)*s.size)),h=Math.max(1,Math.round(sh/Math.max(sw,sh)*s.size));
    const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.imageSmoothingQuality='high';ctx.drawImage(bitmap,sx,sy,sw,sh,0,0,w,h);bitmap.close();bitmap=null;
    const pixels=ctx.getImageData(0,0,w,h).data;
    let selection;
    if(s.polygon.length) {
      ctx.clearRect(0,0,w,h);ctx.beginPath();
      s.polygon.forEach(([px,py],i)=>ctx[i?'lineTo':'moveTo']((px-x)/rw*w,(py-y)/rh*h));
      ctx.closePath();ctx.fillStyle='#fff';ctx.fill();
      const mask=ctx.getImageData(0,0,w,h).data;selection=new Float32Array(w*h);
      for(let i=0;i<selection.length;i++)selection[i]=mask[i*4+3]/255;
    }
    const rendered=renderPixels(pixels,w,h,s,selection);
    ctx.putImageData(new ImageData(rendered,w,h),0,0);
    const pad=Math.round(s.size*s.padding),output=new OffscreenCanvas(w+pad*2,h+pad*2),out=output.getContext('2d');
    out.drawImage(canvas,pad,pad);
    const png=await output.convertToBlob({type:'image/png'});
    let paper;
    if(bundle){out.globalCompositeOperation='destination-over';out.fillStyle='#f6f3eb';out.fillRect(0,0,output.width,output.height);paper=await output.convertToBlob({type:'image/png'});}
    self.postMessage({png,paper});
  }catch(error){self.postMessage({error:error.message});}
  finally{bitmap?.close();}
};
