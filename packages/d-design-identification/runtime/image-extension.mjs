/* Pure prepared-asset resolver. Does not call a model or fetch executable code. */
const hash=/^[a-f0-9]{64}$/;
const assetPath=value=>typeof value==='string'&&/^assets\/[A-Za-z0-9_./-]+\.png$/.test(value)&&!value.split('/').includes('..');
const sameAspect=(w,h,pair)=>Array.isArray(pair)&&pair.length===2&&pair.every(n=>Number.isFinite(n)&&n>0)&&Math.abs(w*pair[1]-h*pair[0])<=Math.max(w,h)*1e-6;
export function assertImageExtension(policy,catalog){
 if(policy?.id!=='d-design-image-region-extension'||policy.runtimePolicyVersion!==1||policy.defaultMode!=='extension'||policy.forbidFlatColorSuccess!==true)throw new Error('画面延展策略不兼容。');
 if(catalog?.id!=='d-design-approved-image-extensions'||!Array.isArray(catalog.assets)||catalog.assets.length>50)throw new Error('扩图素材索引不正确。');
 const ids=new Set();
 for(const a of catalog.assets){
  if(!a.id||ids.has(a.id)||!hash.test(a.source?.sha256||'')||!hash.test(a.sha256||'')||!assetPath(a.file)||!assetPath(a.source.file)||a.approval?.status!=='user-approved-demo'||!sameAspect(a.pixelSize?.width,a.pixelSize?.height,a.target?.imageAspect)||!['S','M','L','XL'].includes(a.target?.preset)||!Array.isArray(a.target?.canvasAspect)||a.target.canvasAspect.length!==2||!a.target.canvasAspect.every(n=>Number.isFinite(n)&&n>0))throw new Error('扩图素材绑定或比例不正确。');
  ids.add(a.id);
 }
 return true;
}
export function resolvePreparedExtension({sourceSha256,preset,canvas,imageRegion},policy,catalog){
 assertImageExtension(policy,catalog);
 if(![canvas?.w,canvas?.h,imageRegion?.w,imageRegion?.h].every(n=>Number.isFinite(n)&&n>0))return {status:'needs-extension',reason:'请先确定模板及实际图片区。'};
 const asset=catalog.assets.find(a=>a.source.sha256===sourceSha256&&a.target.preset===preset&&sameAspect(canvas.w,canvas.h,a.target.canvasAspect)&&sameAspect(imageRegion.w,imageRegion.h,a.target.imageAspect));
 return asset?{status:'prepared-demo',asset,automaticGeneration:false}:{status:'needs-extension',reason:'没有与原图、模板和图片区比例匹配的已确认扩图；请换用适配素材，或确认裁切。',automaticGeneration:false};
}
