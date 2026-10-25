// Independent fixture diagnostics and a strict retention gate for Stage 1.5.
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {boundaryMixModel} from '../src/engine/transitions.ts';
const gamma=[];
for(const name of ['edge-linear','edge-srgb']) {
 const data=await sharp(`tests/fixtures/coverage/${name}.png`).removeAlpha().raw().toBuffer();
 const freq=new Map();
 for(let i=0;i<data.length;i+=3){const k=[...data.subarray(i,i+3)].join(',');freq.set(k,(freq.get(k)||0)+1);}
 // These synthetic fixtures contain exactly two known uniform half-plane interiors.
 // This fixture-only palette extraction must not become global segmentation logic.
 const entries=[...freq].sort((a,b)=>b[1]-a[1]);
 const [a,b]=entries.slice(0,2).map(([k])=>k.split(',').map(x=>+x/255));
 const colors=entries.slice(2).flatMap(([k,n])=>Array(Math.min(n,32)).fill(k.split(',').map(x=>+x/255)));
 const selected=boundaryMixModel(colors,a,b);
 assert.equal(selected,name.slice(5));gamma.push({name,selected,transitionSamples:colors.length});
}
const measured=JSON.parse(await readFile('benchmark-results/stage15/evidence.json'));
const baseline={cubic:{mean:0.09176246475390709,max:1.5615131224253462},wave:{mean:0.07944779640807578,max:1}};
const geometry=[];
for(const [name,old] of Object.entries(baseline)) {
 const row=measured.find(x=>x.name===`curve-optimization/${name}-1024.png`);
 assert(row,'missing actual export evidence');const current=row.groundTruth[1];
 assert(current.mean<=old.mean+1e-6,`${name}: Stage 1.5 mean regression`);
 assert(current.max<=old.max+1e-6,`${name}: Stage 1.5 max regression`);
 geometry.push({name,baseline:old,current,target_1_16:current.max<=1/16,target_1_64:current.max<=1/64});
}
await mkdir('benchmark-results/stage16',{recursive:true});
const result={baselineCommit:'6084faffbd18313c80b7d4bc8bec349dd88b63c8',gamma,geometry,status:'PARTIAL: analytic primitives validated; end-to-end subpixel targets not established'};
await writeFile('benchmark-results/stage16/proof.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
