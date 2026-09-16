export interface CanvasPointer { pointerId: number; pointerType: string; clientX: number; clientY: number; button: number }

/** One input owner at a time. Touch contacts interrupted by a pen stay blocked until lifted. */
export class CanvasPointerInput {
  private owner: { id: number; type: string; x: number; y: number } | null = null;
  private blocked = new Set<number>();
  down(p: CanvasPointer): 'draw' | 'pan' | 'ignore' {
    if (p.button !== 0) return 'ignore';
    if (this.owner) {
      if (p.pointerType === 'pen' && this.owner.type === 'touch') {
        this.blocked.add(this.owner.id);
      } else {
        this.blocked.add(p.pointerId);
        return 'ignore';
      }
    }
    if (this.blocked.has(p.pointerId)) return 'ignore';
    this.owner = { id: p.pointerId, type: p.pointerType, x: p.clientX, y: p.clientY };
    return p.pointerType === 'touch' ? 'pan' : 'draw';
  }
  move(p: CanvasPointer): { type: 'draw' | 'pan'; dx: number; dy: number } | null {
    if (!this.owner || this.owner.id !== p.pointerId) return null;
    const result = { type: this.owner.type === 'touch' ? 'pan' as const : 'draw' as const,
      dx: p.clientX - this.owner.x, dy: p.clientY - this.owner.y };
    this.owner.x = p.clientX; this.owner.y = p.clientY;
    return result;
  }
  end(id: number): boolean {
    this.blocked.delete(id);
    if (this.owner?.id !== id) return false;
    this.owner = null;
    return true;
  }
  reset() { this.owner = null; this.blocked.clear(); }
}

// Sample a screen-space segment at less than half a displayed cell to avoid skipped cells.
export function sampleCanvasSegment(from: { x: number; y: number }, to: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number }, columns: number, rows: number): number[] {
  if (rect.width <= 0 || rect.height <= 0) return [];
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(to.x - from.x) / (rect.width / columns),
    Math.abs(to.y - from.y) / (rect.height / rows)) * 2));
  const indexes = new Set<number>();
  for (let step = 0; step <= steps; step++) {
    const x = Math.floor((from.x + (to.x - from.x) * step / steps - rect.left) / rect.width * columns);
    const y = Math.floor((from.y + (to.y - from.y) * step / steps - rect.top) / rect.height * rows);
    if (x >= 0 && x < columns && y >= 0 && y < rows) indexes.add(y * columns + x);
  }
  return [...indexes];
}
