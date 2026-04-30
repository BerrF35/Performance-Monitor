import type { OverviewCards, RawSnapshot, StatusChip, TimePoint } from '@shared/models';

const nowMinus = (now: number, index: number, stepMs: number): number => now - index * stepMs;

export const bytes = {
  mb: (value: number) => value * 1024 * 1024,
  gb: (value: number) => value * 1024 * 1024 * 1024,
  tb: (value: number) => value * 1024 * 1024 * 1024 * 1024
};

export function makeHistory(
  now: number,
  points: number,
  base: number,
  amplitude: number,
  stepMs = 1000,
  secondaryBase?: number
): TimePoint[] {
  return Array.from({ length: points }, (_, index) => {
    const reverseIndex = points - index - 1;
    const wave = Math.sin(index * 0.57) * amplitude;
    const ripple = Math.cos(index * 0.19) * amplitude * 0.48;
    const value = Math.max(0, Math.min(100, base + wave + ripple));

    return {
      timestamp: nowMinus(now, reverseIndex, stepMs),
      value,
      secondary:
        secondaryBase === undefined
          ? undefined
          : Math.max(0, Math.min(100, secondaryBase + Math.cos(index * 0.41) * amplitude))
    };
  });
}

export function createFallbackSnapshot(now = Date.now()): RawSnapshot {
  const cpuHistory = makeHistory(now, 60, 54, 14);
  const gpuHistory = makeHistory(now, 60, 18, 18);
  const ramHistory = makeHistory(now, 60, 58, 7, 60_000);
  const diskHistory = makeHistory(now, 60, 28, 22, 1000, 18);
  const netHistory = makeHistory(now, 60, 46, 14, 1000, 18);
  const powerHistory = makeHistory(now, 60, 42, 7);
  const noiseHistory = makeHistory(now, 60, 31, 2);

  const chips: StatusChip[] = [
      {
        id: 'health',
        label: 'System Health',
        value: 'Excellent',
        detail: 'All systems operating normally',
        tone: 'green'
      },
      {
        id: 'power',
        label: 'Power Mode',
        value: 'Balanced',
        detail: 'Optimal balance',
        tone: 'purple'
      },
      {
        id: 'profile',
        label: 'Active Profile',
        value: 'Default Profile',
        detail: 'Auto-selected',
        tone: 'purple'
      }
    ];
  const overview: OverviewCards = {
      cpu: {
        deviceLabel: 'Intel Core i7-12700H',
        utilizationPercent: 21,
        currentClockGhz: 3.45,
        packagePowerW: { value: 45, source: 'estimated', label: 'Estimated from load' },
        maxBoostGhz: 4.7,
        temperatureC: { value: 52, source: 'fallback', label: 'Thermal sensor unavailable' },
        perCoreUsage: [
          { id: 'p1', label: 'P1', type: 'P-Core', usage: 54 },
          { id: 'p2', label: 'P2', type: 'P-Core', usage: 78 },
          { id: 'p3', label: 'P3', type: 'P-Core', usage: 44 },
          { id: 'p4', label: 'P4', type: 'P-Core', usage: 39 },
          { id: 'p5', label: 'P5', type: 'P-Core', usage: 38 },
          { id: 'p6', label: 'P6', type: 'P-Core', usage: 69 },
          { id: 'e7', label: 'E7', type: 'E-Core', usage: 32 },
          { id: 'e8', label: 'E8', type: 'E-Core', usage: 43 },
          { id: 'e9', label: 'E9', type: 'E-Core', usage: 61 },
          { id: 'e10', label: 'E10', type: 'E-Core', usage: 40 },
          { id: 'e11', label: 'E11', type: 'E-Core', usage: 40 },
          { id: 'e12', label: 'E12', type: 'E-Core', usage: 51 },
          { id: 'e13', label: 'E13', type: 'E-Core', usage: 42 },
          { id: 'e14', label: 'E14', type: 'E-Core', usage: 44 }
        ],
        utilizationHistory: cpuHistory,
        status: 'No Throttling',
        loadPercent: 21,
        pCoreAverageGhz: 2.9,
        eCoreAverageGhz: 2.1,
        threads: 20,
        processes: 232
      },
      gpu: {
        deviceLabel: 'NVIDIA GeForce RTX 3060 Laptop GPU',
        utilizationPercent: { value: 34, source: 'fallback' },
        coreClockGhz: { value: 1.35, source: 'fallback' },
        memoryClockGhz: { value: 6, source: 'fallback' },
        powerDrawW: { value: 55, source: 'estimated' },
        temperatureC: { value: 48, source: 'fallback' },
        coreUsagePercent: 34,
        vramUsedBytes: { value: bytes.gb(3.2), source: 'fallback' },
        vramTotalBytes: { value: bytes.gb(6), source: 'fallback' },
        encoderUsagePercent: { value: 18, source: 'fallback' },
        frametimeHistory: gpuHistory,
        status: 'GPU waiting on CPU',
        topProcesses: [
          { name: 'RobloxPlayerBeta.exe', cpuPercent: 18, memoryBytes: bytes.gb(1.1), gpuPercent: 21 },
          { name: 'Discord.exe', cpuPercent: 7, memoryBytes: bytes.gb(1.2), gpuPercent: 7 },
          { name: 'chrome.exe', cpuPercent: 6, memoryBytes: bytes.gb(1), gpuPercent: 6 },
          { name: 'Others', cpuPercent: 0, memoryBytes: bytes.gb(5.2), gpuPercent: 0 }
        ]
      },
      ram: {
        inUsePercent: 58,
        usedBytes: bytes.gb(9.3),
        totalBytes: bytes.gb(16),
        cachedBytes: { value: bytes.gb(4.1), source: 'fallback' },
        freeBytes: bytes.gb(2.6),
        topProcesses: [
          { name: 'Chrome.exe', memoryBytes: bytes.gb(1.8) },
          { name: 'Discord.exe', memoryBytes: bytes.gb(1.2) },
          { name: 'RobloxPlayerBeta.exe', memoryBytes: bytes.gb(1.1) },
          { name: 'Others', memoryBytes: bytes.gb(5.2) }
        ],
        trendHistory: ramHistory,
        stabilityLabel: 'Stable'
      },
      storage: {
        deviceLabel: 'NVMe Samsung 970 EVO Plus 1TB',
        readBytesPerSec: { value: bytes.gb(1.2), source: 'fallback' },
        writeBytesPerSec: { value: bytes.mb(850), source: 'fallback' },
        healthPercent: { value: 98, source: 'fallback' },
        healthGrade: 'Excellent',
        latencyMs: { value: 0.12, source: 'fallback' },
        queueDepth: { value: 3, source: 'fallback' },
        temperatureC: { value: 46, source: 'fallback' },
        tbwBytes: { value: bytes.tb(2.1), source: 'fallback' },
        tbwLimitBytes: { value: bytes.tb(5), source: 'fallback' },
        powerOnHours: { value: 1280, source: 'fallback' },
        activityHistory: diskHistory,
        activeProcess: {
          name: 'chrome.exe (File: cache_f_0001)',
          readBytesPerSec: bytes.mb(320),
          writeBytesPerSec: bytes.mb(210)
        }
      },
      network: {
        adapterLabel: 'Wi-Fi (Intel Wi-Fi 6 AX201)',
        downloadBytesPerSec: bytes.mb(15.625),
        uploadBytesPerSec: bytes.mb(4),
        latencyMs: { value: 12, source: 'fallback' },
        jitterMs: { value: 3, source: 'fallback' },
        packetLossPercent: { value: 0, source: 'fallback' },
        signalDbm: { value: -58, source: 'fallback' },
        signalLabel: 'Excellent',
        topUsage: [
          { name: 'Discord.exe', bytesPerSec: bytes.mb(8.5) },
          { name: 'Steam.exe', bytesPerSec: bytes.mb(6.2) },
          { name: 'chrome.exe', bytesPerSec: bytes.mb(4.1) },
          { name: 'Others', bytesPerSec: bytes.mb(13.2) }
        ],
        history: netHistory,
        connections: { value: 42, source: 'fallback' },
        dns: { value: '1.1.1.1', source: 'fallback' },
        ipv4: { value: '192.168.1.10', source: 'fallback' },
        publicIp: { value: '103.21.244.18', source: 'fallback' }
      },
      powerBattery: {
        batteryLevelPercent: { value: 85, source: 'fallback' },
        batteryHealthPercent: { value: 92, source: 'fallback' },
        cycleCount: { value: 324, source: 'fallback' },
        fullChargeCapacityWh: { value: 64, source: 'fallback' },
        acConnected: { value: true, source: 'fallback' },
        totalSystemPowerW: { value: 42.6, source: 'estimated' },
        cpuPowerW: { value: 18.7, source: 'estimated' },
        gpuPowerW: { value: 15.4, source: 'estimated' },
        estimatedRemainingMinutes: { value: 155, source: 'fallback' },
        powerHistory
      },
      thermalsFans: {
        cpuTemperatureC: { value: 53, source: 'fallback' },
        gpuTemperatureC: { value: 48, source: 'fallback' },
        ssdTemperatureC: { value: 46, source: 'fallback' },
        cpuFanRpm: { value: 2200, source: 'fallback' },
        gpuFanRpm: { value: 1800, source: 'fallback' },
        coolingEfficiencyPercent: { value: 82, source: 'estimated' },
        coolingLabel: 'Good',
        noiseLevelDba: { value: 32, source: 'estimated' },
        noiseHistory
      },
      topProcesses: [
        { name: 'RobloxPlayerBeta.exe', cpuPercent: 18, memoryBytes: bytes.gb(1.1), gpuPercent: 21 },
        { name: 'Discord.exe', cpuPercent: 7, memoryBytes: bytes.gb(1.2), gpuPercent: 7 },
        { name: 'chrome.exe', cpuPercent: 6, memoryBytes: bytes.gb(1), gpuPercent: 6 },
        { name: 'obs64.exe', cpuPercent: 4, memoryBytes: bytes.mb(865), gpuPercent: 3 },
        { name: 'explorer.exe', cpuPercent: 2, memoryBytes: bytes.mb(150), gpuPercent: 0 }
      ],
      systemHealth: {
        overallStatus: 'Excellent',
        items: [
          { label: 'Overall Status', status: 'Excellent', tone: 'green' },
          { label: 'Thermal Status', status: 'Good', tone: 'green' },
          { label: 'Performance', status: 'Good', tone: 'green' },
          { label: 'Component Health', status: 'Excellent', tone: 'green' }
        ],
        recentAlerts: [
          {
            id: 'fallback-ok',
            title: 'No issues detected',
            detail: 'All systems are operating normally',
            severity: 'info',
            timestamp: now
          }
        ]
      },
      trends: {
        lines: [
          { label: 'CPU', valueLabel: '21%', tone: 'blue', history: makeHistory(now, 60, 21, 7, 60_000) },
          { label: 'GPU', valueLabel: '34%', tone: 'green', history: makeHistory(now, 60, 34, 8, 60_000) },
          { label: 'RAM', valueLabel: '58%', tone: 'purple', history: makeHistory(now, 60, 58, 2, 60_000) },
          { label: 'Disk', valueLabel: '12%', tone: 'blue', history: makeHistory(now, 60, 12, 2, 60_000) }
        ]
      },
      systemInformation: {
        deviceName: 'LAPTOP-7G3E8F',
        operatingSystem: 'Windows 11 Pro 64-bit',
        motherboard: { value: 'ASUSTeK ROG Strix G15', source: 'fallback' },
        biosVersion: { value: 'G513QM.308', source: 'fallback' },
        uptimeSeconds: 102_720,
        lastBootIso: new Date(now - 102_720_000).toISOString(),
        driversStatus: { value: 'All up to date', source: 'fallback' }
      },
      footer: {
        systemHealthy: true,
        statusLine: 'All systems normal',
        uptimeSeconds: 102_720,
        totalDataReadBytes: { value: bytes.tb(1.25), source: 'fallback' },
        totalDataWrittenBytes: { value: bytes.gb(890), source: 'fallback' },
        activityPercent: 72
      }
  };

  return {
    timestamp: now,
    chips,
    overview
  };
}
