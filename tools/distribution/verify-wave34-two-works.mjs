#!/usr/bin/env node
/** Read two original Works, contracts, acceptances and all artifact bytes from one restored state. */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { ProductStore } from '../../packages/storage/dist/index.js'
const { values } = parseArgs({ options: { state: { type: 'string' }, recipe1: { type: 'string' }, recipe2: { type: 'string' } } })
if (!values.state || !values.recipe1 || !values.recipe2) throw new Error('usage: ... --state --recipe1 --recipe2')
const recipes=[JSON.parse(readFileSync(values.recipe1,'utf8')),JSON.parse(readFileSync(values.recipe2,'utf8'))]; let report=null; try{report=JSON.parse(readFileSync(join(values.state,'restore-report.json'),'utf8'))}catch{}
const store=new ProductStore({path:join(values.state,'state.sqlite')})
try{const works=[];for(const r of recipes){const w=store.product.works.get(r.workId);if(!w)throw new Error('missing Work '+r.workId);const contracts=Number(store.db.prepare('select count(*) n from contract_revisions where work_id=?').get(w.id).n);const accepted=store.events.after(0,100000).filter(e=>e.topic==='application.candidate.accepted'&&e.entityRef===w.id);if(contracts<1||accepted.length!==1)throw new Error('contracts/acceptance mismatch '+w.id);const arts=[];for(const a of r.artifacts){const rec=store.artifacts.get(a.id);if(!rec)throw new Error('artifact missing '+a.id);const b=readFileSync(rec.absolutePath);const sha=createHash('sha256').update(b).digest('hex');if(sha!==a.sha256||b.length!==a.bytes)throw new Error('artifact bytes mismatch '+a.id);arts.push({id:a.id,bytes:b.length,sha256:sha})}works.push({id:w.id,projectId:w.projectId,contracts,acceptedEventSeq:accepted[0].seq,artifacts:arts})}
const totalArtifacts=Number(store.db.prepare('select count(*) n from completion_acceptances').get().n);const result={protocol:'wave34-two-works-read/1',status:'PASS',target:values.state,report:report?{eventSeq:report.database.eventSeq,integrity:report.database.integrity,schema:report.database.productSchema}:null,works,completionAcceptances:totalArtifacts,realVendorTurns:0,realModelTurns:0,realNativeTurns:0};console.log(JSON.stringify(result,null,2))}finally{store.close()}
