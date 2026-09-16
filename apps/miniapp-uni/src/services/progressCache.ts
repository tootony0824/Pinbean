import type { ProductionProgress } from '@/services/productionProgress'
import type { CellProgress } from '@pinbean/bead-core'

export type CachedProgress = ProductionProgress & { cellProgress?: CellProgress }

function copy(progress: CachedProgress): CachedProgress {
  return { ...progress, completedColorIds: [...progress.completedColorIds], completedBoardIds: [...progress.completedBoardIds],
    ...(progress.cellProgress ? { cellProgress: { ...progress.cellProgress, completedCellIndices: [...progress.cellProgress.completedCellIndices] } } : {}),
  }
}

export function createProgressCache() {
  const entries = new Map<string, CachedProgress>()
  const key = (projectId: string, hash: string): string => JSON.stringify([projectId, hash])
  return {
    get(projectId: string, hash: string): CachedProgress | undefined {
      const id = key(projectId, hash)
      const value = entries.get(id)
      if (!value) return undefined
      entries.delete(id)
      entries.set(id, value)
      return copy(value)
    },
    set(projectId: string, progress: CachedProgress): void {
      const id = key(projectId, progress.patternHash)
      entries.delete(id)
      entries.set(id, copy(progress))
      if (entries.size > 32) {
        const oldest = entries.keys().next().value
        if (oldest !== undefined) entries.delete(oldest)
      }
    },
  }
}
