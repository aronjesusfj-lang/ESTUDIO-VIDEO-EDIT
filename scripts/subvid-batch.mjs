#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readdir, stat, access } from 'node:fs/promises'
import { watch } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : fallback
}
const flag = (name) => args.includes(name)
const inputDir = path.resolve(option('--input', '.'))
const outputDir = path.resolve(option('--output', path.join(inputDir, 'subvid-output')))
const modelArg = option('--model', 'Xenova/whisper-tiny')
const model = ({ tiny: 'Xenova/whisper-tiny', base: 'Xenova/whisper-base', small: 'Xenova/whisper-small' })[modelArg] || modelArg
const language = option('--language', undefined)
const sourceLanguage = option('--source-language', language)
const translateTo = option('--translate-to', undefined)
const nllbLanguages = { en: 'eng_Latn', es: 'spa_Latn', fr: 'fra_Latn', de: 'deu_Latn', pt: 'por_Latn', it: 'ita_Latn', nl: 'nld_Latn', ru: 'rus_Cyrl', ja: 'jpn_Jpan', ko: 'kor_Hang', zh: 'zho_Hans', ar: 'arb_Arab', hi: 'hin_Deva', pl: 'pol_Latn', tr: 'tur_Latn' }
const supported = /\.(mp4|mov|webm|mkv|avi|m4v|ogv|wmv|mp3|wav|ogg|m4a|aac|flac|wma|opus)$/i
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function help() {
  console.log(`Subvid local batch transcriber\n\nUsage:\n  npm run batch -- --input ./videos --output ./subtitles [options]\n\nOptions:\n  --watch             Watch the input folder for new media\n  --model tiny|base|small  Whisper model (default: tiny)\n  --language es       Force an audio language (default: auto-detect)\n  --translate-to es   Translate subtitles with NLLB\n  --source-language es  Source language (default: auto-detected)\n  --help              Show this help\n\nRequires ffmpeg on PATH. Processing is local; model weights are downloaded once and cached.`)
}
if (flag('--help') || flag('-h')) { help(); process.exit(0) }

// The browser build selects ONNX Runtime Web/WASM and avoids requiring the
// native onnxruntime-node addon (which is not shipped for every Mac setup).
const { env, pipeline } = await import('../node_modules/@huggingface/transformers/dist/transformers.web.js')

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error || `${command} exited ${code}`)))
  })
}

async function waitUntilStable(file) {
  let lastSize = -1
  let stable = 0
  while (stable < 3) {
    await sleep(1000)
    const current = await stat(file).catch(() => null)
    if (!current || !current.isFile()) throw new Error('File disappeared before processing')
    stable = current.size === lastSize ? stable + 1 : 0
    lastSize = current.size
  }
}

async function availableOutput(file) {
  const stem = `${path.parse(file).name}${translateTo ? `.${translateTo}` : ''}`
  const base = path.join(outputDir, `${stem}.srt`)
  let candidate = base
  let suffix = 2
  while (await access(candidate).then(() => true, () => false)) {
    candidate = path.join(outputDir, `${stem}-${suffix++}.srt`)
  }
  return candidate
}

env.allowLocalModels = false
env.useFS = true
env.useFSCache = true
env.useBrowserCache = false
env.cacheDir = path.join(os.homedir(), '.cache', 'subvid', 'models')
if (translateTo && !nllbLanguages[translateTo]) {
  console.error(`Unsupported --translate-to language: ${translateTo}. Supported: ${Object.keys(nllbLanguages).join(', ')}`)
  process.exit(2)
}
if (sourceLanguage && sourceLanguage !== 'auto' && !nllbLanguages[sourceLanguage]) {
  console.error(`Unsupported --source-language: ${sourceLanguage}. Supported: auto, ${Object.keys(nllbLanguages).join(', ')}`)
  process.exit(2)
}
console.log(`Loading ${model} locally through Transformers.js…`)
const transcriber = await pipeline('automatic-speech-recognition', model, {
  dtype: 'q8',
  progress_callback: (progress) => {
    if (progress.status === 'progress') process.stdout.write(`\rModel download: ${Math.round(progress.progress || 0)}%`)
  },
})
console.log('\nModel ready.')
let translator
if (translateTo) {
  console.log('Loading NLLB translation model locally…')
  translator = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', { dtype: 'q8' })
  console.log('Translation model ready.')
}
await mkdir(inputDir, { recursive: true })
await mkdir(outputDir, { recursive: true })
const queued = new Set()
let stopping = false

async function processFile(file) {
  const key = path.resolve(file)
  if (queued.has(key) || !supported.test(file)) return
  queued.add(key)
  const temp = path.join(os.tmpdir(), `subvid-${process.pid}-${Date.now()}.f32le`)
  try {
    await waitUntilStable(file)
    console.log(`Transcribing ${path.basename(file)}…`)
    await run('ffmpeg', ['-nostdin', '-v', 'error', '-y', '-i', key, '-vn', '-ac', '1', '-ar', '16000', '-f', 'f32le', '-acodec', 'pcm_f32le', temp])
    const { readFile } = await import('node:fs/promises')
    const pcm = await readFile(temp)
    const audio = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 4))
    const result = await transcriber(audio, {
      ...(language ? { language } : {}),
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    })
    const chunks = (result.chunks || []).filter((chunk) => chunk.text?.trim() && Array.isArray(chunk.timestamp))
    if (!chunks.length && result.text?.trim()) throw new Error('Model returned no timestamps; no SRT was written')
    if (translator && chunks.length) {
      const src = sourceLanguage && sourceLanguage !== 'auto' ? sourceLanguage : (result.language || '').slice(0, 2).toLowerCase()
      const srcCode = nllbLanguages[src]
      if (!srcCode) throw new Error(`Could not determine a supported source language (Whisper detected: ${result.language || 'unknown'}); pass --source-language`)
      for (let start = 0; start < chunks.length; start += 8) {
        const group = chunks.slice(start, start + 8)
        const translated = await translator(group.map((chunk) => chunk.text.trim()), { src_lang: srcCode, tgt_lang: nllbLanguages[translateTo] })
        group.forEach((chunk, index) => { chunk.text = translated[index]?.translation_text || chunk.text })
      }
    }
    const target = await availableOutput(file)
    const stamp = (seconds) => {
      const ms = Math.max(0, Math.round((Number(seconds) || 0) * 1000))
      const hh = String(Math.floor(ms / 3600000)).padStart(2, '0')
      const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')
      const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')
      return `${hh}:${mm}:${ss},${String(ms % 1000).padStart(3, '0')}`
    }
    const srt = chunks.map((chunk, index) => `${index + 1}\n${stamp(chunk.timestamp[0])} --> ${stamp(chunk.timestamp[1])}\n${chunk.text.trim()}`).join('\n\n') + '\n'
    const { writeFile } = await import('node:fs/promises')
    await writeFile(target, srt, { flag: 'wx' })
    console.log(`Saved ${target}`)
  } catch (error) {
    queued.delete(key)
    console.error(`Failed ${path.basename(file)}: ${error.message}`)
  } finally {
    await import('node:fs/promises').then(({ rm }) => rm(temp, { force: true }))
  }
}

async function scan() {
  const files = (await readdir(inputDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && supported.test(entry.name))
    .map((entry) => path.join(inputDir, entry.name))
  for (const file of files) await processFile(file)
}

await scan()
if (flag('--watch')) {
  console.log(`Watching ${inputDir}. Press Ctrl+C to stop.`)
  const watcher = watch(inputDir, (_event, name) => {
    if (!name || stopping) return
    const file = path.join(inputDir, String(name))
    void processFile(file)
  })
  const stop = () => { stopping = true; watcher.close(); process.exit(0) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
