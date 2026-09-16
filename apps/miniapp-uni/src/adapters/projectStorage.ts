import type { StoredPatternProject } from '@/services/projectPersistence'

export const LAST_PROJECT_STORAGE_KEY = 'pinbean:last-project:v1'

export function loadLastProject(): unknown | null {
  const value = uni.getStorageSync(LAST_PROJECT_STORAGE_KEY)
  return value === '' || value === undefined ? null : value
}

export function saveLastProject(project: StoredPatternProject): void {
  uni.setStorageSync(LAST_PROJECT_STORAGE_KEY, project)
}
