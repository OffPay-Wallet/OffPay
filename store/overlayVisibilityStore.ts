import { create } from 'zustand';

/**
 * Tracks full-screen overlays (bottom-sheet modals like Preferences /
 * Security) so chrome such as the floating tab bar can hide while a
 * sheet is open.
 *
 * Race-condition hygiene:
 *   - Overlays register by a stable string `id`, not a counter. Calling
 *     `showOverlay(id)` twice is idempotent and `hideOverlay(id)` only
 *     clears that id, so overlapping opens/closes (or a sheet that
 *     unmounts without a matching close) can never leave the tab bar
 *     stuck hidden or flicker it back early.
 *   - State updates are no-ops when the id set is unchanged, so React
 *     subscribers don't re-render on redundant calls.
 */
interface OverlayVisibilityState {
  /** Ids of overlays currently requesting chrome be hidden. */
  activeOverlayIds: readonly string[];
  /** True while at least one overlay is active. */
  isOverlayActive: boolean;
  showOverlay: (id: string) => void;
  hideOverlay: (id: string) => void;
}

export const useOverlayVisibilityStore = create<OverlayVisibilityState>((set) => ({
  activeOverlayIds: [],
  isOverlayActive: false,
  showOverlay: (id) =>
    set((state) => {
      if (state.activeOverlayIds.includes(id)) return state;
      const activeOverlayIds = [...state.activeOverlayIds, id];
      return { activeOverlayIds, isOverlayActive: true };
    }),
  hideOverlay: (id) =>
    set((state) => {
      if (!state.activeOverlayIds.includes(id)) return state;
      const activeOverlayIds = state.activeOverlayIds.filter((value) => value !== id);
      return { activeOverlayIds, isOverlayActive: activeOverlayIds.length > 0 };
    }),
}));
