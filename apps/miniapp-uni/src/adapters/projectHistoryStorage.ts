import {
  restoreProjectHistory,
  storeProjectHistory,
  type RecentProjectRecord,
} from '@/services/projectHistory'

const PROJECT_HISTORY_STORAGE_KEY = 'pinbean:project-history:v1'

export function loadProjectHistory(): RecentProjectRecord[] {
  const stored = uni.getStorageSync(PROJECT_HISTORY_STORAGE_KEY) as unknown
  if (!stored) return []
  return restoreProjectHistory(stored)
}

export function saveProjectHistory(records: readonly RecentProjectRecord[]): void {
  uni.setStorageSync(PROJECT_HISTORY_STORAGE_KEY, storeProjectHistory(records))
}
