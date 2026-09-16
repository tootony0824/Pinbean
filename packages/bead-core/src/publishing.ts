import type { GenerationConfig } from './types.js'
import type { CraftAssessment, ProductionProgressSummary } from './production.js'
type PatternMode = GenerationConfig['mode']

export const PROJECT_WORKFLOW_FORMAT_VERSION = 1

export const PROJECT_TYPE_OPTIONS = [
  { description: '单板快做', gridSize: 29, label: '挂件', mode: 'cartoon', value: 'charm' },
  { description: '主体清晰', gridSize: 50, label: '礼物', mode: 'cartoon', value: 'gift' },
  { description: '保留层次', gridSize: 58, label: '照片', mode: 'realistic', value: 'photo' },
  { description: '分板制作', gridSize: 75, label: '大图', mode: 'cartoon', value: 'poster' },
] as const

export type ProjectType = typeof PROJECT_TYPE_OPTIONS[number]['value']
export type PublishTone = 'challenge' | 'showcase' | 'tutorial'

export interface ProjectWorkflow {
  formatVersion: typeof PROJECT_WORKFLOW_FORMAT_VERSION
  projectType: ProjectType
}

export interface PublishKit {
  body: string
  checklist: string[]
  coverSuggestion: string
  tags: string
  text: string
  title: string
}

const PROJECT_TYPE_COPY: Record<ProjectType, {
  coverSuggestion: string
  name: string
  tags: string[]
  titleSuffix: string
}> = {
  charm: {
    coverSuggestion: '首图放成品或图纸，突出“小尺寸、快完成、适合做钥匙扣”。',
    name: '挂件',
    tags: ['拼豆挂件', '钥匙扣挂件', '手工小礼物'],
    titleSuffix: '小挂件',
  },
  gift: {
    coverSuggestion: '首图放成品或图纸预览，旁边摆上备料清单，突出“亲手制作、适合送人”。',
    name: '礼物',
    tags: ['亲手做礼物', '手工礼物', '拼豆图纸'],
    titleSuffix: '手作礼物',
  },
  photo: {
    coverSuggestion: '首图用原图对比图纸，突出“照片变拼豆”和颜色层次。',
    name: '照片',
    tags: ['照片转拼豆', '定制拼豆', '像素画'],
    titleSuffix: '照片拼豆',
  },
  poster: {
    coverSuggestion: '首图放分板合集，第二张放备料清单，突出“分板挑战”。',
    name: '大图',
    tags: ['拼豆挑战', '分板图纸', '手工过程'],
    titleSuffix: '分板大图',
  },
}

export function isProjectType(value: unknown): value is ProjectType {
  return PROJECT_TYPE_OPTIONS.some(option => option.value === value)
}

export function createProjectWorkflow(projectType: ProjectType): ProjectWorkflow {
  return {
    formatVersion: PROJECT_WORKFLOW_FORMAT_VERSION,
    projectType,
  }
}

export function restoreProjectWorkflow(input: unknown): ProjectWorkflow {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('project workflow must be an object')
  }
  const stored = input as Record<string, unknown>
  if (stored.formatVersion !== PROJECT_WORKFLOW_FORMAT_VERSION) {
    throw new Error(`unsupported project workflow format: ${String(stored.formatVersion)}`)
  }
  if (!isProjectType(stored.projectType)) {
    throw new Error(`unsupported project type: ${String(stored.projectType)}`)
  }
  return createProjectWorkflow(stored.projectType)
}

export function inferProjectType(gridSize: number, mode: PatternMode): ProjectType {
  if (!Number.isSafeInteger(gridSize) || gridSize < 1) throw new RangeError('图纸尺寸必须是正整数')
  if (mode === 'realistic') return 'photo'
  if (gridSize <= 29) return 'charm'
  if (gridSize >= 75) return 'poster'
  return 'gift'
}

function baseFacts(assessment: CraftAssessment): string {
  return `${assessment.sizeText}，${assessment.beadText}，${assessment.colorText}，${assessment.boardText}`
}

function stepText(assessment: CraftAssessment): string {
  return assessment.workSteps
    .map(step => `${step.index}. ${step.title}：${step.detail}`)
    .join('\n')
}

export function buildPublishPost(assessment: CraftAssessment, tone: PublishTone): string {
  const facts = baseFacts(assessment)
  const hashtags = '#拼豆 #拼豆图纸 #手工DIY #亲手做礼物 #PinBean'
  if (tone === 'tutorial') {
    return [
      `这张拼豆图纸参数：${facts}`,
      `难度：${assessment.level}，粗略摆豆时间：${assessment.timeText}`,
      '',
      '我的制作顺序：',
      stepText(assessment),
      '',
      assessment.suggestion,
      hashtags,
    ].join('\n')
  }
  if (tone === 'challenge') {
    return [
      `给自己开了一个拼豆挑战：${facts}`,
      `难度评估是「${assessment.level}」，粗略摆豆时间：${assessment.timeText}。`,
      assessment.hasMultipleBoards
        ? `这次要分成 ${assessment.boardCount} 块板做，边缘对齐是重点。`
        : '这次一块板就能完成，适合放松试拼。',
      '',
      assessment.suggestion,
      hashtags,
    ].join('\n')
  }
  return [
    `做了一张拼豆图纸，参数是 ${facts}。`,
    `${assessment.level}，粗略摆豆时间：${assessment.timeText}。`,
    assessment.suggestion,
    '',
    hashtags,
  ].join('\n')
}

function publishTitle(assessment: CraftAssessment, projectName: string, projectType: ProjectType): string {
  const meta = PROJECT_TYPE_COPY[projectType]
  const normalizedName = projectName.trim()
  const title = normalizedName
    ? `${normalizedName.endsWith('拼豆') ? normalizedName : `${normalizedName}拼豆`}${meta.titleSuffix}`
    : assessment.hasMultipleBoards
      ? `${assessment.sizeText}拼豆${meta.titleSuffix}`
      : `一板完成的拼豆${meta.titleSuffix}`
  return title.slice(0, 20)
}

function progressText(progress?: ProductionProgressSummary): string {
  if (!progress) return '还没开始记录'
  return `${progress.completedColors}/${progress.totalColors} 色 · ${progress.completedBeads}/${progress.totalBeads} 颗 · ${progress.colorPercent}%`
}

export function buildPublishKit(params: {
  assessment: CraftAssessment
  progress?: ProductionProgressSummary
  projectName: string
  projectType: ProjectType
}): PublishKit {
  const { assessment, progress, projectName, projectType } = params
  const meta = PROJECT_TYPE_COPY[projectType]
  const title = publishTitle(assessment, projectName, projectType)
  const boardProgress = progress
    ? `${progress.completedBoards}/${progress.totalBoards} 板 · ${progress.boardPercent}%`
    : assessment.hasMultipleBoards ? `0/${assessment.boardCount} 板 · 0%` : '单板作品'
  const tags = ['#拼豆', '#拼豆图纸', '#手工DIY']
    .concat(meta.tags.map(tag => `#${tag}`))
    .concat('#PinBean')
    .join(' ')
  const body = [
    `${meta.name}方向的拼豆记录：${baseFacts(assessment)}`,
    `难度：${assessment.level}，粗略摆豆 ${assessment.timeText}`,
    `当前进度：${progressText(progress)}`,
    `分板进度：${boardProgress}`,
    '',
    '制作顺序：',
    stepText(assessment),
    '',
    assessment.suggestion,
    '',
    tags,
  ].join('\n')
  const checklist = [
    '首图：清晰展示成品、图纸或分板合集',
    '第二张：备料清单或颜色消耗',
    assessment.hasMultipleBoards ? '第三张：分板合集或未完成分板进度' : '第三张：制作过程或局部细节',
    '正文：写清尺寸、颗数、颜色数和粗略摆豆时间',
  ]
  return {
    body,
    checklist,
    coverSuggestion: meta.coverSuggestion,
    tags,
    text: [
      `标题：${title}`,
      '',
      `首图建议：${meta.coverSuggestion}`,
      '',
      '正文：',
      body,
      '',
      '发布前检查：',
      ...checklist.map(item => `- ${item}`),
    ].join('\n'),
    title,
  }
}
