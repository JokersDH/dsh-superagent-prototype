import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
if (process.argv.length !== 3) throw new Error('Usage: node tools/bootstrap/probe-wave15-release-gate.mjs <E-root>')
const e = resolve(process.argv[2])
const { evaluateRelease } = await import(pathToFileURL(join(e, 'tests/product-acceptance/lib/release.mjs')).href)
const { TIERS } = await import(pathToFileURL(join(e, 'tests/product-acceptance/lib/release-requirements.mjs')).href)
const latest=JSON.parse(readFileSync(e+'/tests/product-acceptance/reports/latest.json')),original=JSON.parse(readFileSync(latest.runDirectory+'/report.json'))
const ids=['E4-INSTALL-ARTIFACT-IDENTITY','E6-ARTIFACT-CURRENT-SCOPE','E6-CURRENT-MAIN-INSTALL','E4-UPGRADE-FAULTS','E7-OWNERSHIP-COPY','E6-INSTALLED-CONTEXT']
const requirement={...TIERS['installed-alpha'],tier:'bounded-installed-evidence-audit',cases:TIERS['installed-alpha'].cases.filter(c=>ids.includes(c.id))}
const base=structuredClone(original);delete base.release;delete base.claim;base.cases=base.cases.filter(c=>ids.includes(c.id))
const get=(r,id)=>r.cases.find(c=>c.id===id)
const current=get(base,'E6-CURRENT-MAIN-INSTALL');current.status='PASS';current.assertions=[{id:'PROMOTED_LABEL_ONLY',ok:true}];delete current.reason
const check=fn=>{const r=structuredClone(base);fn(r);const v=evaluateRelease({report:r,requirement,expectedSource:r.source.commit,now:Date.parse(r.checkedAt)});return{accepted:v.ok,failures:v.failures.map(f=>({code:f.code,caseId:f.caseId}))}}
const out=[
{id:'ACTUAL_BLOCKED_PERSONAL_START_PROMOTED_PASS',...check(r=>{const current=get(r,'E6-CURRENT-MAIN-INSTALL').evidence.currentInstall;current.observed='BLOCKED';current.instanceMode=null;current.health=null;current.configuration=null})},
{id:'NESTED_FROZEN_SOURCE_FOREIGN',...check(r=>get(r,'E6-ARTIFACT-CURRENT-SCOPE').evidence.frozenScope.artifact.source='f'.repeat(40))},
{id:'TOP_LEVEL_SUBJECT_FOREIGN_CONTROL',...check(r=>{let a=get(r,'E6-ARTIFACT-CURRENT-SCOPE').evidence;a.subject={...a.frozenScope.artifact,source:'f'.repeat(40)}})},
{id:'COPY_EXIT_AND_CODE_MISSING',...check(r=>{let a=get(r,'E7-OWNERSHIP-COPY').evidence.ownershipCopy;delete a.status;delete a.code})},
{id:'FAULT_WINDOWS_ONLY_PASS_STEPS',...check(r=>{for(const w of Object.values(get(r,'E4-UPGRADE-FAULTS').evidence.upgradeFaults.windows)){w.probe={steps:['fault_observed','recover','recovered_health','data_kept'].map(id=>({id,status:'PASS'}))}}})},
{id:'CURRENT_OBSERVED_MODE_FIXTURE',...check(r=>get(r,'E6-CURRENT-MAIN-INSTALL').evidence.currentInstall.instanceMode='fixture')},
{id:'CURRENT_SUBJECT_FOREIGN_ABI_PLATFORM',...check(r=>{let a=get(r,'E6-CURRENT-MAIN-INSTALL').evidence.currentInstall.subject;a.abi='999';a.platform='linux';a.arch='x64'})},
]
const report={source:execFileSync('git',['rev-parse','HEAD'],{cwd:e,encoding:'utf8'}).trim(),reportSource:original.source,scope:'Actual installed-alpha entries and real existing evidence, canonical artifact case retained; isolated evidence audit, no whole-tier PASS claim',originalCurrent:original.cases.find(c=>c.id==='E6-CURRENT-MAIN-INSTALL').evidence.currentInstall,observations:out.map(value=>({...value,status:value.accepted?'FAIL':'PASS'})),modelSends:0,nativeTurns:0,
  baselineCaveat:'The original current-install evidence is BLOCKED. Do not credit later per-field rejection without a coherent passing control and focal failure reason.',
  passed:out.filter(value=>!value.accepted).length,failed:out.filter(value=>value.accepted).length}

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = process.env.PA_ADMISSION_REPORT ? resolve(process.env.PA_ADMISSION_REPORT) : join(repository, 'reports/releases/wave15-admission/release-gate.json')
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report,null,2))
process.exitCode=report.failed?1:0
