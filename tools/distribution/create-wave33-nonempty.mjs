#!/usr/bin/env node
/** Create genuine nonempty ordinary state through the original controlled Product/Application runtime. Zero vendor/model/native. */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { ProductStore } from '../../packages/storage/dist/index.js'
import { createControlledProduct, FIXTURE_CHECK } from '../../apps/coordinator/product/runtime.ts'
const out=resolve(process.argv[2]??'/tmp/w33-nonempty'); mkdirSync(out,{recursive:true}); mkdirSync(join(out,'state')); mkdirSync(join(out,'project','src'),{recursive:true});
const git=a=>execFileSync('git',a,{cwd:join(out,'project'),stdio:'pipe'}); git(['init','-q']); writeFileSync(join(out,'project','src','.gitkeep'),''); git(['add','src/.gitkeep']); git(['-c','user.name=Wave33','-c','user.email=wave33@localhost','commit','-qm','Wave33 fixture base']);
const store=new ProductStore({path:join(out,'state','state.sqlite')}); const principal={userId:'wave33-d-user',authorityRef:'wave33-d-authority'}; const actor={...principal,source:'local_cli'};
const scope={projectId:'project-wave33',allowedPaths:['src/'],excludedPaths:[],externalActions:[]}; const criteria=[{id:'criterion-output',kind:'machine',required:true,description:'Fixed output matches',checkDefinitionRef:FIXTURE_CHECK},{id:'criterion-human',kind:'human',required:true,description:'Review generated patch'}];
let product=createControlledProduct({store,principal,projects:[{id:scope.projectId,scope}],actionSecret:Buffer.alloc(32,1),stateRoot:join(out,'state'),scratchProject:join(out,'project')}); product.start();
let seq=0; const command=v=>product.application.dispatch({commandId:`wave33-${++seq}`,conversationId:'wave33-conversation',...v},actor);
const until=async(pred)=>{const end=Date.now()+15000;let v;while(Date.now()<end){v=await pred();if(v)return v;await new Promise(r=>setTimeout(r,25))}throw new Error('timeout '+JSON.stringify(v))};
try{
 const created=await command({kind:'create_work',projectId:scope.projectId,goal:'Produce wave33 nonempty artifact',profileId:'profile-fixture-question',scope,criteria}); if(created.status!=='recorded')throw new Error(JSON.stringify(created));
 const q=await until(async()=>{const s=await product.application.inspect({});return s.questions[0]});
 const answer=await command({kind:'answer_question',questionId:q.id,expectedVersion:q.version,answer:{kind:'choices',optionIds:['allow']}}); if(answer.status!=='recorded')throw new Error(JSON.stringify(answer));
 const view=await until(async()=>{const s=await product.application.inspect({});const w=s.works.find(w=>w.work?.id===created.workId||w.workId===created.workId||w.id===created.workId);return w?.actions?.available?.includes('accept_candidate')?w:null});
 const accepted=await command({kind:'accept_candidate',candidate:view.actions.currentCandidate}); if(accepted.status!=='recorded')throw new Error(JSON.stringify(accepted));
 const delivered=(await product.application.inspect({})).works.find(w=>w.work?.id===created.workId||w.workId===created.workId||w.id===created.workId); const artifacts=[];
 for(const id of delivered.artifactIds??[]){const a=await product.read.artifact(id); if(a?.body){const chunks=[];for await(const c of a.body)chunks.push(Buffer.from(c));const bytes=Buffer.concat(chunks);artifacts.push({id,sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,name:a.name??a.kind??null});}}
 const location=await product.read.workLocation(created.workId); const eventSeq=store.events.cursor();
 const evidence={protocol:'wave33-nonempty-recipe/1',source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dataRoot:join(out,'state'),workId:created.workId,questionId:q.id,deliveryStatus:'native_applied',candidateGeneration:view.actions.currentCandidate?.candidateGeneration??null,acceptedEventSeq:eventSeq,artifactIds:delivered.artifactIds,artifacts,workspacePath:location.workspacePath??null,projectPath:location.projectPath??null,realVendorTurns:0,realModelTurns:0,realNativeTurns:0};
 writeFileSync(join(out,'recipe.json'),JSON.stringify(evidence,null,2)+'\n'); console.log(JSON.stringify(evidence,null,2));
}finally{await product.close();store.close()}
