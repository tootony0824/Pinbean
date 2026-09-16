export function createProjectTransaction() {
  let running = false
  return async function run<Snapshot>(steps: {
    capture: () => Snapshot
    activate: () => void | Promise<void>
    render: () => Promise<void>
    save: () => void | Promise<void>
    restore: (snapshot: Snapshot) => void | Promise<void>
    afterCommit: () => void
    warn: (error: unknown) => void
  }): Promise<void> {
    if (running) throw new Error("Project transaction already running")
    running = true
    try {
      const snapshot = steps.capture()
      try {
        await steps.activate()
        await steps.render()
        await steps.save()
      } catch (error) {
        await steps.restore(snapshot)
        throw error
      }
      // The main project is committed; derived summaries cannot undo it.
      try { steps.afterCommit() } catch (error) { steps.warn(error) }
    } finally {
      running = false
    }
  }
}

export function commitCandidate<T>(candidate: T, save: (value: T) => void, publish: (value: T) => void): void {
  save(candidate)
  publish(candidate)
}
