import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildPublishReviewSummary,
  createPublishReview,
  formatPublishReviewMetrics,
  restorePublishReview,
} from '../src/services/publishReview.ts'

test('publish review keeps topic, time, metrics and note in a versioned record', () => {
  const review = createPublishReview({
    comments: 12,
    conversions: 3,
    favorites: 48,
    likes: 126,
    note: '收藏高于评论，下次继续做教程型内容',
    publishedAt: 1_756_704_600_000,
    topic: '照片转拼豆教程',
    updatedAt: 1_756_708_200_000,
  })
  assert.deepEqual(restorePublishReview(JSON.parse(JSON.stringify(review))), review)
  assert.equal(formatPublishReviewMetrics(review), '赞 126 · 藏 48 · 评 12 · 转化 3')
  const summary = buildPublishReviewSummary('测试作品', review)
  assert.match(summary, /主题：照片转拼豆教程/)
  assert.match(summary, /互动数据：赞 126 · 藏 48 · 评 12 · 转化 3/)
  assert.match(summary, /复盘备注：收藏高于评论/)
})

test('publish review rejects invalid versions, negative metrics and time reversal', () => {
  const input = {
    comments: 0,
    conversions: 0,
    favorites: 0,
    likes: 0,
    note: '',
    publishedAt: 200,
    topic: '测试主题',
    updatedAt: 300,
  }
  const review = createPublishReview(input)
  assert.throws(() => restorePublishReview({ ...review, formatVersion: 2 }), /unsupported publish review format/)
  assert.throws(() => createPublishReview({ ...input, likes: -1 }), /likes/)
  assert.throws(() => createPublishReview({ ...input, updatedAt: 100 }), /earlier/)
  assert.throws(() => createPublishReview({ ...input, topic: '  ' }), /required/)
})
