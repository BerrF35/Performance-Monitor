import type { PerformanceMonitorApi } from '@shared/models';

declare global {
  interface Window {
    performanceMonitor: PerformanceMonitorApi;
  }
}

export {};
