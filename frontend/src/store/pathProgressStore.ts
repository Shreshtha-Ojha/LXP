import { create } from 'zustand'

// TODO: coin balance and path completion should come from a rewards/progress
// API once the gamification backend lands (CLAUDE.md Rule 1 — no business
// state hardcoded long-term). For the demo, the balance starts at 150 (the
// "2 nodes completed" seed in SYSTEM_DESIGN_PATH) and updates locally as the
// learner completes nodes — see components/path/types.ts.
const DEMO_STARTING_COINS = 150

interface PathProgressState {
  /** Coin balance shown in the navbar, dashboard, and path header. */
  coinTotal: number
  /** Node ids completed during this session, beyond the path's seed data. */
  completedNodeIds: string[]
  /** Id of the node most recently completed — drives the one-shot coin float animation. */
  justCompletedNodeId: string | null
  /** Marks a node complete, adds its coin reward, and flags it for the completion animation. */
  completeNode: (nodeId: string, coins: number) => void
  /** Clears the completion flag once the coin float animation has played. */
  clearJustCompleted: () => void
}

export const usePathProgressStore = create<PathProgressState>((set) => ({
  coinTotal: DEMO_STARTING_COINS,
  completedNodeIds: [],
  justCompletedNodeId: null,

  completeNode: (nodeId, coins) =>
    set((state) => ({
      coinTotal: state.coinTotal + coins,
      completedNodeIds: state.completedNodeIds.includes(nodeId)
        ? state.completedNodeIds
        : [...state.completedNodeIds, nodeId],
      justCompletedNodeId: nodeId,
    })),

  clearJustCompleted: () => set({ justCompletedNodeId: null }),
}))
