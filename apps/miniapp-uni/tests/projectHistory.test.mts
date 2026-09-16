import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildRecentProjectSummary,
  mergeRecentProjectHistory,
  restoreProjectHistory,
  storeProjectHistory,
  type RecentProjectRecord,
} from '../src/services/projectHistory.ts'
import { createPublishReview } from '../src/services/publishReview.ts'

function record(projectId: string, patternHash: string, updatedAt: number): RecentProjectRecord {
  return {
    boardPercent: 25,
    colorCount: 2,
    colorPercent: 93,
    difficulty: '舒适可做',
    formatVersion: 2,
    height: 50,
    patternHash,
    projectId,
    projectName: `作品 ${projectId}`,
    projectType: 'gift',
    totalBeads: 2500,
    updatedAt,
    width: 50,
  }
}

test('history replaces one project across pattern revisions without merging different projects', () => {
  const first = record('project-1', 'hash-a', 100)
  const edited = record('project-1', 'hash-b', 200)
  const samePatternOtherProject = record('project-2', 'hash-b', 300)
  let history = mergeRecentProjectHistory([], first)
  history = mergeRecentProjectHistory(history, edited)
  assert.equal(history.length, 1)
  assert.equal(history[0]?.patternHash, 'hash-b')
  history = mergeRecentProjectHistory(history, samePatternOtherProject)
  assert.deepEqual(history.map(item => item.projectId), ['project-2', 'project-1'])
})

test('history round-trip rejects duplicates and malformed progress', () => {
  const first = record('project-1', 'hash-a', 100)
  const second = record('project-2', 'hash-b', 200)
  const stored = storeProjectHistory([first, second])
  assert.deepEqual(restoreProjectHistory(JSON.parse(JSON.stringify(stored))), [first, second])
  assert.throws(
    () => restoreProjectHistory({ ...stored, records: [first, { ...first, patternHash: 'other' }] }),
    /duplicate project ids/,
  )
  assert.throws(
    () => restoreProjectHistory({ ...stored, records: [{ ...first, colorPercent: 101 }] }),
    /must be <= 100/,
  )
})

test('history migrates V1 records and carries the current publish review in V2', () => {
  const legacy = {
    formatVersion: 1,
    records: [{ ...record('project-1', 'hash-a', 100), formatVersion: 1 }],
  }
  const migrated = restoreProjectHistory(legacy)
  assert.equal(migrated[0]?.formatVersion, 2)
  assert.equal(migrated[0]?.publishReview, undefined)

  const publishReview = createPublishReview({
    comments: 2,
    favorites: 10,
    likes: 30,
    publishedAt: 100,
    topic: '礼物制作教程',
    updatedAt: 200,
  })
  const withReview = mergeRecentProjectHistory(migrated, {
    ...record('project-1', 'hash-b', 200),
    publishReview,
  })
  const latest = withReview[0]
  assert.ok(latest)
  assert.deepEqual(latest.publishReview, publishReview)
  assert.match(buildRecentProjectSummary(latest), /发布复盘｜赞 30 · 藏 10 · 评 2 · 转化 0/)
})

test('recent-project summary carries identity-independent production facts', () => {
  const text = buildRecentProjectSummary(record('project-1', 'hash-a', 100))
  assert.match(text, /PinBean 最近制作｜作品 project-1/)
  assert.match(text, /50×50｜2500 颗｜2 色｜舒适可做/)
  assert.match(text, /色号进度 93%｜分板进度 25%/)
  assert.doesNotMatch(text, /hash-a/)
})
