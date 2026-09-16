import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
import { createProjectTransaction, commitCandidate } from "../src/services/projectTransaction"
import { createProgressCache } from "../src/services/progressCache"
import { loadProductionProgress } from "../src/adapters/progressStorage"
import { createCellProgress, createGrid, calculateStatistics, CURRENT_ALGORITHM_VERSION, hashPatternContent } from "@pinbean/bead-core"
import { createPinia, setActivePinia } from "pinia"
import { usePatternStore } from "../src/stores/pattern"

for (const failure of ["canvas", "main", "summary", "rollback"] as const) {
  test(`activation fault injection: ${failure}`, async () => {
    const old = { grid: [1], undo: ["paint"], redo: ["erase"], size: 29, mode: "cartoon", brand: "MARD", draft: "unsaved", width: 29 }
    let state = old
    let disk = "old"
    let warning = ""
    const run = createProjectTransaction()
    const operation = run({
      capture: () => state,
      activate: () => { state = { ...old, grid: [2], undo: [], redo: [], size: 50, mode: "realistic", brand: "COCO", draft: "new", width: 50 } },
      render: async () => { if (failure === "canvas" || failure === "rollback") throw new Error("canvas") },
      save: () => { if (failure === "main") throw new Error("main"); disk = "new" },
      restore: async snapshot => {
        state = snapshot
        try { if (failure === "rollback") throw new Error("repaint") } catch { warning = "preview unavailable" }
      },
      afterCommit: () => { if (failure === "summary") throw new Error("summary") },
      warn: () => { warning = "summary" },
    })
    if (failure === "summary") {
      await operation
      assert.equal(disk, "new")
      assert.equal(state.size, 50)
      assert.equal(warning, "summary")
    } else {
      await assert.rejects(operation)
      assert.deepEqual(state, old)
      assert.equal(disk, "old")
      if (failure === "rollback") assert.equal(warning, "preview unavailable")
    }
  })
}

test("async activation refuses reentry until rendering finishes", async () => {
  const run = createProjectTransaction()
  let release = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  const steps = { capture: () => 1, activate: () => {}, render: () => pending, save: () => {}, restore: () => {}, afterCommit: () => {}, warn: () => {} }
  const first = run(steps)
  await assert.rejects(run(steps), /already running/)
  release()
  await first
  await run(steps)
})

test("candidate save failure never publishes and reset commits explicit empty progress", () => {
  let ui = ["red"]
  assert.throws(() => commitCandidate([], () => { throw new Error("quota") }, value => { ui = value }))
  assert.deepEqual(ui, ["red"])
  let disk: string[] | undefined
  commitCandidate<string[]>([], value => { disk = value }, value => { assert.deepEqual(disk, []); ui = value })
  assert.deepEqual(ui, [])
})

test("progress cache isolates projects, copies values and evicts the least recent of 32", () => {
  const cache = createProgressCache()
  const progress = { formatVersion: 1 as const, patternHash: "A", completedColorIds: ["red"], completedBoardIds: [], updatedAt: 1 }
  cache.set("one", progress)
  progress.completedColorIds.push("blue")
  assert.deepEqual(cache.get("one", "A")?.completedColorIds, ["red"])
  assert.equal(cache.get("two", "A"), undefined)
  for (let index = 0; index < 31; index++) cache.set("one", { ...progress, patternHash: String(index) })
  assert.ok(cache.get("one", "A"))
  cache.set("one", { ...progress, patternHash: "B" })
  assert.equal(cache.get("one", "0"), undefined)
  assert.ok(cache.get("one", "A"))
})

test("page uses coordinator and legacy progress adapter has no writes or deletes", () => {
  const page = readFileSync(new URL("../src/pages/index/index.vue", import.meta.url), "utf8")
  const adapter = readFileSync(new URL("../src/adapters/progressStorage.ts", import.meta.url), "utf8")
  assert.match(page, /await runProjectTransaction\(/)
  assert.match(page, /commitCandidate\(candidate/)
  const capture = page.slice(page.indexOf("function capturePageState"), page.indexOf("async function restorePageState"))
  const restore = page.slice(page.indexOf("async function restorePageState"), page.indexOf("const modeLabel"))
  for (const field of ["cellProgress", "gridSize", "similarityThreshold", "mode", "projectType", "selectedColorSystem",
    "publishReviewDraft", "previewCanvasWidth", "previewCanvasHeight", "savedProjectLabel", "restorableProject", "persistenceWarning",
    "activePatternColorSystem", "isEditing", "productionProgress", "projectNameDraft", "publishReview", "selectedColorId",
    "selectedPaletteIndex", "sourceCanvasHeight", "sourceCanvasWidth", "sourceImage"]) {
    assert.ok(capture.includes(`${field}: ${field}.value`) || capture.includes(`${field}: { ...${field}.value`), `capture ${field}`)
    assert.ok(restore.includes(`${field}.value = snapshot.${field}`), `restore ${field}`)
  }
  for (const field of ["activeProjectIdentity", "decodedImage"]) {
    assert.match(capture, new RegExp(`\n    ${field},`))
    assert.ok(restore.includes(`${field} = snapshot.${field}`))
  }
  assert.match(capture, /store: patternStore.snapshot\(\)/)
  assert.match(restore, /patternStore.restore\(snapshot.store\)/)
  assert.match(restore, /previewWarning.value = .原项目数据已恢复，但预览不可用/)
  assert.match(page, /activateProject\(restored, false\)/)
  assert.doesNotMatch(adapter, /setStorage|removeStorage/)
  const initialization = page.slice(page.indexOf("function initializeProductionProgress"), page.indexOf("function persistProductionProgress"))
  assert.doesNotMatch(initialization, /saveLastProject|saveProductionProgress|\.set\(/)
})

test("embedded reset wins over conflicting independent records without reading storage", () => {
  const original = globalThis.uni
  let reads = 0
  const records = ["current legacy", "older legacy"]
  globalThis.uni = { getStorageSync: () => { reads++; return records.shift() ?? "" } } as unknown as typeof uni
  try {
    const pattern = fixturePattern()
    const reset = { completedColorIds: [], completedBoardIds: [] }
    assert.equal(loadProductionProgress("one", pattern, reset), reset)
    assert.equal(reads, 0)
    assert.equal(loadProductionProgress("one", pattern), "current legacy")
    assert.equal(reads, 1)
    records.unshift("")
    assert.equal(loadProductionProgress("one", pattern), "older legacy")
    assert.equal(reads, 3)
  } finally { globalThis.uni = original }
})

function fixturePattern() {
  return {
    grid: createGrid(2, 1, [1, 1]), paletteId: "test", paletteVersion: "v1", paletteTable: ["", "red"],
    sourceGeneration: null,
    generationConfig: { algorithmVersion: CURRENT_ALGORITHM_VERSION, alphaThreshold: 128, mode: "cartoon" as const,
      paletteId: "test", paletteVersion: "v1", sampling: { scale: 4 }, similarityMerge: { enabled: false, threshold: 0 },
      targetGrid: { axis: "width" as const, size: 2 } },
  }
}

test("store rollback retains unknown generation, history and cached partial cell progress", async () => {
  setActivePinia(createPinia())
  const store = usePatternStore()
  const pattern = fixturePattern()
  const palette = { id: "test", version: "v1", colors: [{ id: "red", code: "R", name: "Red", hex: "#FF0000", rgb: { r: 255, g: 0, b: 0 } }] }
  store.setGeneratedResult(pattern, palette, calculateStatistics(pattern.grid, 1))
  store.erase(1)
  store.undo()
  const snapshot = store.snapshot()
  const cache = createProgressCache()
  const cellProgress = createCellProgress("one", pattern, [0], 1)
  cache.set("one", { formatVersion: 1, patternHash: hashPatternContent(pattern), completedColorIds: [], completedBoardIds: [], updatedAt: 1, cellProgress })
  cellProgress.completedCellIndices.push(1)
  const run = createProjectTransaction()
  await assert.rejects(run({ capture: () => snapshot, activate: () => { store.erase(0) }, render: async () => {},
    save: () => { throw new Error("quota") }, restore: state => store.restore(state), afterCommit: () => {}, warn: () => {} }))
  assert.deepEqual(store.snapshot(), snapshot)
  assert.equal(store.pattern?.sourceGeneration, null)
  assert.equal(store.history?.redoStack.length, 1)
  assert.deepEqual(cache.get("one", hashPatternContent(pattern))?.cellProgress?.completedCellIndices, [0])
})
