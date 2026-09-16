import type { ProjectType } from '@/services/publishing'
import {
  formatPublishReviewMetrics,
  restorePublishReview,
  type PublishReview,
} from '@/services/publishReview'

export const PROJECT_HISTORY_FORMAT_VERSION = 2
export const PROJECT_HISTORY_LIMIT = 8

export interface RecentProjectRecord {
  boardPercent: number
  colorCount: number
  colorPercent: number
  difficulty: string
  formatVersion: typeof PROJECT_HISTORY_FORMAT_VERSION
  height: number
  patternHash: string
  projectId: string
  projectName: string
  projectType: ProjectType
  publishReview?: PublishReview
  totalBeads: number
  updatedAt: number
  width: number
}

export interface StoredProjectHistory {
  formatVersion: typeof PROJECT_HISTORY_FORMAT_VERSION
  records: RecentProjectRecord[]
}

function assertInteger(value: unknown, label: string, minimum = 0): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum) {
    throw new RangeError(`${label} must be a safe integer >= ${minimum}`)
  }
}

function assertPercent(value: unknown, label: string): asserts value is number {
  assertInteger(value, label)
  if (Number(value) > 100) throw new RangeError(`${label} must be <= 100`)
}

export function restoreRecentProjectRecord(input: unknown): RecentProjectRecord {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('recent project record must be an object')
  }
  const value = input as Record<string, unknown>
  if (value.formatVersion !== 1 && value.formatVersion !== PROJECT_HISTORY_FORMAT_VERSION) {
    throw new Error(`unsupported recent project record format: ${String(value.formatVersion)}`)
  }
  for (const key of ['difficulty', 'patternHash', 'projectId', 'projectName', 'projectType'] as const) {
    if (typeof value[key] !== 'string' || !value[key]) throw new TypeError(`${key} is required`)
  }
  if (!['charm', 'gift', 'photo', 'poster'].includes(value.projectType as string)) {
    throw new Error(`unsupported project type: ${String(value.projectType)}`)
  }
  assertInteger(value.colorCount, 'color count')
  assertPercent(value.colorPercent, 'color percent')
  assertPercent(value.boardPercent, 'board percent')
  assertInteger(value.height, 'height', 1)
  assertInteger(value.totalBeads, 'total beads')
  assertInteger(value.updatedAt, 'updated at')
  assertInteger(value.width, 'width', 1)
  return {
    boardPercent: value.boardPercent,
    colorCount: value.colorCount,
    colorPercent: value.colorPercent,
    difficulty: value.difficulty as string,
    formatVersion: PROJECT_HISTORY_FORMAT_VERSION,
    height: value.height,
    patternHash: value.patternHash as string,
    projectId: value.projectId as string,
    projectName: value.projectName as string,
    projectType: value.projectType as ProjectType,
    ...(value.publishReview === undefined ? {} : { publishReview: restorePublishReview(value.publishReview) }),
    totalBeads: value.totalBeads,
    updatedAt: value.updatedAt,
    width: value.width,
  }
}

export function mergeRecentProjectHistory(
  history: readonly RecentProjectRecord[],
  record: RecentProjectRecord,
  limit = PROJECT_HISTORY_LIMIT,
): RecentProjectRecord[] {
  if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('history limit must be a positive integer')
  const restored = restoreRecentProjectRecord(record)
  return [restored, ...history
    .map(item => restoreRecentProjectRecord(item))
    .filter(item => item.projectId !== restored.projectId)]
    .slice(0, limit)
}

export function storeProjectHistory(records: readonly RecentProjectRecord[]): StoredProjectHistory {
  return {
    formatVersion: PROJECT_HISTORY_FORMAT_VERSION,
    records: records.slice(0, PROJECT_HISTORY_LIMIT).map(record => restoreRecentProjectRecord(record)),
  }
}

export function restoreProjectHistory(input: unknown): RecentProjectRecord[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('project history must be an object')
  }
  const value = input as Record<string, unknown>
  if (value.formatVersion !== 1 && value.formatVersion !== PROJECT_HISTORY_FORMAT_VERSION) {
    throw new Error(`unsupported project history format: ${String(value.formatVersion)}`)
  }
  if (!Array.isArray(value.records)) throw new TypeError('project history records must be an array')
  const records = value.records.map(record => restoreRecentProjectRecord(record))
  const projectIds = records.map(record => record.projectId)
  if (new Set(projectIds).size !== projectIds.length) {
    throw new Error('project history contains duplicate project ids')
  }
  return records.slice(0, PROJECT_HISTORY_LIMIT)
}

export function buildRecentProjectSummary(record: RecentProjectRecord): string {
  const restored = restoreRecentProjectRecord(record)
  return [
    `PinBean 最近制作｜${restored.projectName}`,
    `${restored.width}×${restored.height}｜${restored.totalBeads} 颗｜${restored.colorCount} 色｜${restored.difficulty}`,
    `色号进度 ${restored.colorPercent}%｜分板进度 ${restored.boardPercent}%`,
    restored.publishReview ? `发布复盘｜${formatPublishReviewMetrics(restored.publishReview)}` : '',
  ].filter(Boolean).join('\n')
}
