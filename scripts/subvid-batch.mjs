#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, access, readFile, writeFile, rm } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { parseTime, parseTimeRange, effectiveCuts, segmentsThroughCuts } from './lib/cuts.mjs'
import { loadManifest } from './lib/manifest.mjs'
import { renderVideo } from './lib/media.mjs'
import { toSrt } from './lib/subtitles.mjs'

const argv = process.argv.slice(2)
const opt = (key, fallback) => { const i = argv.indexOf(key); return i >= 0 ? argv[i + 1] : fallback }
const opts = (key) => argv.flatMap((value, index) => value === key && argv[index + 1] ? [argv[index + 1]] : [])
const has = (key) => argv.includes(key)
const supported = /\.(mp4|mov|webm|mkv|avi|m4v|ogv|wmv|mp3|wav|ogg|m4a|aac|flac|wma|opus)$/i
const modelArg = opt('--model', 'tiny')
const model = ({ tiny: 'Xenova/whisper-tiny', base: 'Xenova/whisper-base', small: 'Xenova/whisper-small' })[modelArg] || modelArg
const translateTo = opt('--translate-to')
const sourceLanguage = opt('--source-language', opt('--language'))
const language = opt('--language')
const nllb = { en:'eng_Latn',es:'spa_Latn',fr:'fra_Latn',de:'deu_Latn',pt:'por_Latn',it:'ita_Latn',nl:'nld_Latn',ru:'rus_Cyrl',ja:'jpn_Jpan',ko:'kor_Hang',zh:'zho_Hans',ar:'arb_Arab',hi:'hin_Deva',pl:'pol_Latn',tr:'tur_Latn' }
function help() {
  console.log(`Subvid local batch transcriber and renderer\n\nUsage:\n  npm run batch -- --input ./videos --output ./out [options]\n  npm run batch -- --manifest ./project.json --output ./out [options]\n\nOptions:\n  --manifest file       Process a shared Subvid manifest v1\n  --input dir           Process every supported media file in a directory\n  --watch               Watch an input directory for new media\n  --model tiny|base|small Whisper model (default: tiny)\n  --language es         Force audio language (default: auto)\n  --translate-to es     Translate subtitles with NLLB\n  --source-language en  Translation source language\n  --trim START-END      Shared trim window, e.g. 00:05-01:20\n  --cut START-END       Add a cut; repeat for multiple cuts\n  --style file.json     Generic caption style JSON\n  --render-video        Render MP4 with cuts and styled burned-in captions\n  --help                Show this help\n\nManifest: {"version":1,"videos":[{"file":"clip.mp4","trim":{"start":2,"end":30},"cuts":[{"start":8,"end":10}],"style":{"fontSize":42,"color":"#ffffff"}}]}. Manifest paths are relative to the manifest.\nRequires ffmpeg and ffprobe. All processing is local.`)
}
if (has('--help') || has('-h')) { help(); process.exit(0) }
const inputDir = path.resolve(opt('--input', '.'))
const outputDir = path.resolve(opt('--output', path.join(inputDir, 'subvid-output')))
const cliTrim = opt('--trim') ? parseTimeRange(opt('--trim')) : undefined
const cliCuts = opts('--cut').map(parseTimeRange)
let cliStyle = {}
if (opt('--style')) cliStyle = JSON.parse(await readFile(path.resolve(opt('--style')), 'utf8'))
if (translateTo && !nllb[translateTo]) throw new Error(`Unsupported translation language: ${translateTo}`)
if (sourceLanguage && sourceLanguage !== 'auto' && !nllb[sourceLanguage]) throw new Error(`Unsupported source language: ${sourceLanguage}`)

const transformer = await import('../node_modules/@huggingface/transformers/dist/transformers.web.js')
const { env, pipeline } = transformer
env.allowLocalModels = false; env.useFS = true; env.useFSCache = true; env.useBrowserCache = false
env.cacheDir = path.join(os.homedir(), '.cache', 'subvid', 'models')
const recognizer = await pipeline('automatic-speech-recognition', model, { dtype:'q8', progress_callback: (p) => { if (p.status === 'progress') process.stdout.write(`\rModel download: ${Math.round(p.progress || 0)}%`) } })
let translator
if (translateTo) translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', { dtype:'q8' })
await mkdir(outputDir, { recursive:true })

function run(command, args) { return new Promise((resolve,reject) => { const p=spawn(command,args,{stdio:['ignore','ignore','pipe']});let err='';p.stderr.setEncoding('utf8');p.stderr.on('data',x=>err+=x);p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error(err||`${command} exited ${c}`))) }) }
async function stable(file) { let size=-1, n=0;while(n<3){await new Promise(r=>setTimeout(r,1000));const s=await stat(file);n=s.size===size?n+1:0;size=s.size} }
async function outputPath(file, extension) { const base=path.join(outputDir,`${path.parse(file).name}${translateTo?'.'+translateTo:''}${extension}`);let candidate=base,i=2;while(await access(candidate).then(()=>true,()=>false))candidate=path.join(outputDir,`${path.parse(file).name}${translateTo?'.'+translateTo:''}-${i++}${extension}`);return candidate }
const pending = new Set()
async function processVideo(item) {
  const file=path.resolve(item.file); if(pending.has(file)||!supported.test(file)) return
  pending.add(file);const temp=path.join(os.tmpdir(),`subvid-${process.pid}-${Date.now()}.f32le`)
  try {
    await stable(file); console.log(`Transcribing ${path.basename(file)}…`)
    await run('ffmpeg',['-nostdin','-v','error','-y','-i',file,'-vn','-ac','1','-ar','16000','-f','f32le','-acodec','pcm_f32le',temp])
    const pcm=await readFile(temp);const audio=new Float32Array(pcm.buffer,pcm.byteOffset,Math.floor(pcm.byteLength/4))
    const result=await recognizer(audio,{...(item.language||language?{language:item.language||language}:{}),chunk_length_s:30,stride_length_s:5,return_timestamps:true})
    let chunks=(result.chunks||[]).filter(c=>c.text?.trim()&&Array.isArray(c.timestamp)).map(c=>({start:c.timestamp[0],end:c.timestamp[1],text:c.text.trim()}))
    if(!chunks.length&&result.text?.trim())throw new Error('Model returned no timestamps')
    if(translator&&chunks.length){const src=item.sourceLanguage||sourceLanguage||(result.language||'').slice(0,2).toLowerCase();if(!nllb[src])throw new Error(`Unknown source language ${src}; pass --source-language`);for(let i=0;i<chunks.length;i+=8){const group=chunks.slice(i,i+8);const translated=await translator(group.map(c=>c.text),{src_lang:nllb[src],tgt_lang:nllb[translateTo]});group.forEach((c,j)=>c.text=translated[j]?.translation_text||c.text)}}
    let duration=Number((await new Promise((resolve,reject)=>{const p=spawn('ffprobe',['-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1',file],{stdio:['ignore','pipe','pipe']});let o='';p.stdout.on('data',x=>o+=x);p.on('error',reject);p.on('close',c=>c===0?resolve(o):reject(new Error('ffprobe failed')))})).trim())
    const trim=item.trim||cliTrim, cuts=[...(item.cuts||[]),...cliCuts];const sourceChunks=chunks;const removed=effectiveCuts({trim,cuts},duration);chunks=segmentsThroughCuts(chunks,removed)
    const srt=toSrt(chunks);const target=item.output?path.resolve(outputDir,item.output):await outputPath(file,'.srt');await writeFile(target,srt,{flag:'wx'});console.log(`Saved ${target}`)
    if(has('--render-video')||item.renderVideo){const rendered=item.videoOutput?path.resolve(outputDir,item.videoOutput):await outputPath(file,'-subtitled.mp4');await renderVideo({input:file,output:rendered,trim,cuts,segments:sourceChunks,style:{...cliStyle,...(item.style||{})}});console.log(`Rendered ${rendered}`)}
  } catch(e){console.error(`Failed ${path.basename(file)}: ${e.message}`)} finally {pending.delete(file);await rm(temp,{force:true})}
}

if(opt('--manifest')) { const manifest=await loadManifest(path.resolve(opt('--manifest')));for(const item of manifest.videos)await processVideo(item) }
else {
  await mkdir(inputDir,{recursive:true})
  const scan=async()=>{const files=(await readdir(inputDir,{withFileTypes:true})).filter(e=>e.isFile()&&supported.test(e.name)).map(e=>({file:path.join(inputDir,e.name)}));for(const item of files)await processVideo(item)}
  await scan()
  if(has('--watch')){console.log(`Watching ${inputDir}; Ctrl+C stops the queue.`);const watcher=watch(inputDir,(_,name)=>{if(name)void processVideo({file:path.join(inputDir,String(name))})});process.once('SIGINT',()=>watcher.close());process.once('SIGTERM',()=>watcher.close());await new Promise(()=>{})}
}
