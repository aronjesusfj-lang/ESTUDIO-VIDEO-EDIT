import test from 'node:test'
import assert from 'node:assert/strict'
import { parseTime, parseTimeRange, effectiveCuts, keptRanges, segmentsThroughCuts } from '../lib/cuts.mjs'
import { toSrt, toAss } from '../lib/subtitles.mjs'

test('time parser accepts seconds and clock formats', () => {
  assert.equal(parseTime('1:02:03.5'), 3723.5)
  assert.deepEqual(parseTimeRange('00:10-00:40'), { start:10, end:40 })
  assert.throws(() => parseTimeRange('40-10'), /end must be greater/)
})

test('trim, manual cuts and subtitles share the effective output timeline', () => {
  const cuts = effectiveCuts({ trim:{start:5,end:50}, cuts:[{start:20,end:25},{start:24,end:30}] }, 60)
  assert.deepEqual(cuts, [{start:0,end:5},{start:20,end:30},{start:50,end:60}])
  assert.deepEqual(keptRanges({start:5,end:50},[{start:20,end:30}],60),[{start:5,end:20},{start:30,end:50}])
  assert.deepEqual(segmentsThroughCuts([{start:10,end:12,text:'hi'}],cuts)[0],{start:5,end:7,text:'hi',words:undefined})
})

test('SRT and styled ASS serialization are deterministic', () => {
  assert.match(toSrt([{start:1.25,end:2,text:'Hello'}]), /00:00:01,250 --> 00:00:02,000/)
  assert.match(toAss([{start:1,end:2,text:'{hello}'}],{fontSize:36}), /Fontsize, PrimaryColour/)
  assert.match(toAss([{start:1,end:2,text:'{hello}'}]), /\\\{hello\\\}/)
})
