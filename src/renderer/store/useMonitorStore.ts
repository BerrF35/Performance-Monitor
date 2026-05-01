import { create } from 'zustand';
import type { DisplayOverviewCards, MonitorSettings, PerformanceSnapshot } from '@shared/models';
import type { TabId } from '@shared/navigation';

const visiblePanels = {
  cpu: true,
  gpu: true,
  gpus: true,
  ram: true,
  storage: true,
  network: true,
  powerBattery: true,
  thermalsFans: true,
  processes: true,
  topProcesses: true,
  systemHealth: true,
  trends: true,
  systemInformation: true,
  footer: true
} satisfies Record<keyof DisplayOverviewCards, boolean>;

let fetchInFlight = false;

interface MonitorState {
  selectedTab: TabId;
  snapshot: PerformanceSnapshot | null;
  settings: MonitorSettings;
  isRefreshing: boolean;
  error: string | null;
  setTab: (tab: TabId) => void;
  fetchSnapshot: (force?: boolean) => Promise<void>;
  setRefreshRate: (fastRefreshMs: number) => void;
  toggleTheme: () => void;
  setGraphWindow: (graphWindow: MonitorSettings['graphWindow']) => void;
  togglePanel: (panel: keyof DisplayOverviewCards) => void;
}

export const useMonitorStore = create<MonitorState>((set, get) => ({
  selectedTab: 'Overview',
  snapshot: null,
  settings: {
    theme: 'dark',
    graphWindow: '60s',
    fastRefreshMs: 1500,
    slowRefreshMs: 15000,
    visiblePanels
  },
  isRefreshing: false,
  error: null,
  setTab: (tab) => set({ selectedTab: tab }),
  fetchSnapshot: async (force = false) => {
    if (fetchInFlight || get().isRefreshing) {
      return;
    }

    fetchInFlight = true;
    try {
      const snapshot = force ? await window.performanceMonitor.forceSnapshot() : await window.performanceMonitor.getSnapshot();
      const current = get();
      if (current.snapshot && snapshot.version <= current.snapshot.version && current.error === null && !current.isRefreshing) {
        return;
      }

      set({ snapshot, isRefreshing: false, error: null });
    } catch (error) {
      set({
        isRefreshing: false,
        error: error instanceof Error ? error.message : 'Unable to refresh metrics'
      });
    } finally {
      fetchInFlight = false;
    }
  },
  setRefreshRate: (fastRefreshMs) =>
    set((state) => ({
      settings: {
        ...state.settings,
        fastRefreshMs
      }
    })),
  toggleTheme: () =>
    set((state) => ({
      settings: {
        ...state.settings,
        theme: state.settings.theme === 'dark' ? 'light' : 'dark'
      }
    })),
  setGraphWindow: (graphWindow) =>
    set((state) => ({
      settings: {
        ...state.settings,
        graphWindow
      }
    })),
  togglePanel: (panel) =>
    set((state) => ({
      settings: {
        ...state.settings,
        visiblePanels: {
          ...state.settings.visiblePanels,
          [panel]: !state.settings.visiblePanels[panel]
        }
      }
    }))
}));
