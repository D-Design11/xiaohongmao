import test from 'node:test';
import assert from 'node:assert/strict';
import {loadBundle} from '../../runtime/load-rules.mjs';
import {assertImageExtension,resolvePreparedExtension} from '../../runtime/image-extension.mjs';
const b=await loadBundle(),p=b.imageExtension,c=b.approvedImageExtensions;
const request={sourceSha256:c.assets[0].source.sha256,preset:'M',canvas:{w:500,h:3000},imageRegion:{w:500,h:1500}};
test('prepared extension matches original digest and actual image area, not whole canvas',()=>{
 const r=resolvePreparedExtension(request,p,c);assert.equal(r.status,'prepared-demo');assert.equal(r.automaticGeneration,false);assert.equal(r.asset.pixelSize.height,3*r.asset.pixelSize.width);
});
test('changed source, preset, canvas or image ratio cannot reuse the approved sample',()=>{
 for(const change of [{sourceSha256:'a'.repeat(64)},{preset:'S'},{canvas:{w:600,h:3000}},{imageRegion:{w:500,h:3000}}])assert.equal(resolvePreparedExtension({...request,...change},p,c).status,'needs-extension');
});
test('approval and immutable file metadata are required; unsafe asset paths are rejected',()=>{
 for(const change of [{file:'assets/../../bad.png'},{sha256:'invalid'},{pixelSize:{width:1,height:2}},{approval:{status:'pending'}}]){const changed=structuredClone(c);Object.assign(changed.assets[0],change);assert.throws(()=>assertImageExtension(p,changed));}
});
