import { hashPattern, type BeadPattern } from '@pinbean/bead-core'

import {
  legacyProductionProgressStorageKey,
  productionProgressStorageKey,
} from '@/services/productionProgress'

// Embedded progress is authoritative, including an explicit empty reset.
// Independent storage keys are retained only for sidecar-less legacy projects.
export function loadProductionProgress(projectId: string, pattern: BeadPattern, embedded?: unknown): unknown | null {
  if (embedded !== undefined) return embedded
  const currentValue = uni.getStorageSync(productionProgressStorageKey(projectId, pattern))
  if (currentValue !== '' && currentValue !== undefined) return currentValue
  const legacyValue = uni.getStorageSync(legacyProductionProgressStorageKey(projectId, hashPattern(pattern)))
  return legacyValue === '' || legacyValue === undefined ? null : legacyValue
}
