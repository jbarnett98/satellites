/**
 * Everything the UI needs to know about the satellite catalogue: how loading is going,
 * what is loaded, which object is under the pointer or selected, and how the propagation
 * worker is doing. The heavy objects (the catalogue itself) are held raw — they never
 * change in place, they get replaced when a new snapshot arrives.
 */

import type { LoadPhase, LoadTimings } from '../orbits/loadOrbitSnapshot';
import type { SatelliteCatalog } from '../orbits/SatelliteCatalog';
import type { SelectedReadout } from '../globe/Globe';
import type { SatelliteLayerStatus } from '../globe/satellites';

export type CatalogPhase = 'idle' | LoadPhase | 'init' | 'ready' | 'error';

export interface CatalogTimings extends LoadTimings {
  /** json2satrec for every object, inside the worker. */
  workerInitMs: number;
  /** From the first request to the first positions on screen. */
  firstFrameMs: number;
  /** Wall time from starting the load to the first positions on screen. */
  totalMs: number;
}

class CatalogState {
  phase = $state<CatalogPhase>('idle');
  loadedBytes = $state(0);
  totalBytes = $state(0);
  error = $state<string | null>(null);

  catalog = $state.raw<SatelliteCatalog | null>(null);
  timings = $state.raw<CatalogTimings | null>(null);

  hovered = $state(-1);
  selected = $state(-1);
  selectedReadout = $state.raw<SelectedReadout | null>(null);
  /** Pointer position (CSS px in the canvas) for the hover label. */
  pointer = $state({ x: 0, y: 0 });

  propagation = $state.raw<SatelliteLayerStatus | null>(null);

  get ready(): boolean {
    return this.phase === 'ready' && this.catalog !== null;
  }

  get count(): number {
    return this.catalog?.count ?? 0;
  }

  select(index: number): void {
    this.selected = index;
  }

  clearSelection(): void {
    this.selected = -1;
    this.selectedReadout = null;
  }
}

export const catalog = new CatalogState();
