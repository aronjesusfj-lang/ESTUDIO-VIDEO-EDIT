import { spawn } from 'node:child_process'
import path from 'node:path'
import { effectiveCuts, keptRanges } from './cuts.mjs'
import { toAss } from './subtitles.mjs'

export function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let error = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { error += chunk })
    child.on('error', reject)
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(error || `${command} exited ${code}`)))
  })
}

export async function renderVideo({ input, output, trim, cuts = [], segments = [], style = {} }) {
  const probe = await new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', input], { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''; let err = ''
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8')
    child.stdout.on('data', (x) => { out += x }); child.stderr.on('data', (x) => { err += x })
    child.on('error', reject); child.on('close', (code) => code === 0 ? resolve(Number(out.trim())) : reject(new Error(err || 'ffprobe failed')))
  })
  if (!Number.isFinite(probe) || probe <= 0) throw new Error(`Could not read duration: ${input}`)
  const ranges = effectiveCuts({ trim, cuts }, probe)
  const keep = keptRanges(trim, cuts, probe)
  if (!keep.length) throw new Error('Trim and cuts remove the entire video')
  const args = ['-nostdin', '-v', 'error', '-y', '-i', input]
  const filters = []
  const videoLabels = []; const audioLabels = []
  keep.forEach((range, i) => {
    filters.push(`[0:v]trim=start=${range.start}:end=${range.end},setpts=PTS-STARTPTS[v${i}]`)
    filters.push(`[0:a]atrim=start=${range.start}:end=${range.end},asetpts=PTS-STARTPTS[a${i}]`)
    videoLabels.push(`[v${i}]`); audioLabels.push(`[a${i}]`)
  })
  filters.push(`${videoLabels.join('')}${audioLabels.join('')}concat=n=${keep.length}:v=1:a=1[vout][aout]`)
  let styleFile
  if (segments.length) {
    // Render subtitle timings against output time by accounting for every removed interval.
    let removed = 0
    const remapped = segments.filter((cue) => !ranges.some((cut) => cue.start >= cut.start && cue.end <= cut.end)).map((cue) => {
      let deltaStart = 0; let deltaEnd = 0
      for (const cut of ranges) {
        if (cut.end <= cue.start) deltaStart += cut.end - cut.start
        if (cut.end <= cue.end) deltaEnd += cut.end - cut.start
        else if (cut.start < cue.end) deltaEnd += cue.end - cut.start
      }
      return { ...cue, start: Math.max(0, cue.start - deltaStart), end: Math.max(0, cue.end - deltaEnd) }
    }).filter((cue) => cue.end > cue.start)
    styleFile = `${output}.ass`
    const { writeFile } = await import('node:fs/promises')
    await writeFile(styleFile, toAss(remapped, style))
    filters.push(`[vout]ass='${styleFile.replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'")}'[vstyled]`)
  }
  args.push('-filter_complex', filters.join(';'), '-map', styleFile ? '[vstyled]' : '[vout]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-movflags', '+faststart', output)
  try { await run('ffmpeg', args) } finally { if (styleFile) await import('node:fs/promises').then(({ rm }) => rm(styleFile, { force: true })) }
}
