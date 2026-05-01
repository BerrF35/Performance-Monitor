import { contextBridge, ipcRenderer } from 'electron';
import type { PerformanceMonitorApi, WindowAction } from '@shared/models';

const api: PerformanceMonitorApi = {
  getSnapshot: () => ipcRenderer.invoke('metrics:get-snapshot'),
  forceSnapshot: () => ipcRenderer.invoke('metrics:force-snapshot'),
  windowAction: (action: WindowAction) => ipcRenderer.invoke('window:action', action)
};

contextBridge.exposeInMainWorld('performanceMonitor', api);
