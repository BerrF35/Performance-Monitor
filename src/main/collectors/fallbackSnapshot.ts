import type { MetricValue, OverviewCards, RawSnapshot, StatusChip, TimePoint } from '@shared/models';

const UNAVAILABLE = '—';
const emptyHistory: TimePoint[] = [];

export const bytes = {
  mb: (value: number) => value * 1024 * 1024,
  gb: (value: number) => value * 1024 * 1024 * 1024,
  tb: (value: number) => value * 1024 * 1024 * 1024 * 1024
};

const unavailableMetric = <T>(value: T): MetricValue<T> => ({
  value,
  source: 'unavailable'
});

export function createFallbackSnapshot(now = Date.now()): RawSnapshot {
  const chips: StatusChip[] = [
    {
      id: 'health',
      label: 'System Health',
      value: UNAVAILABLE,
      detail: 'Telemetry unavailable',
      tone: 'slate'
    },
    {
      id: 'power',
      label: 'Power Mode',
      value: UNAVAILABLE,
      detail: 'Telemetry unavailable',
      tone: 'slate'
    },
    {
      id: 'profile',
      label: 'Active Profile',
      value: 'Default Profile',
      detail: 'Local profile',
      tone: 'purple'
    }
  ];

  const overview: OverviewCards = {
    cpu: {
      deviceLabel: UNAVAILABLE,
      utilizationPercent: 0,
      currentClockGhz: 0,
      packagePowerW: unavailableMetric(0),
      maxBoostGhz: 0,
      temperatureC: unavailableMetric<number | null>(null),
      perCoreUsage: [],
      utilizationHistory: emptyHistory,
      status: UNAVAILABLE,
      loadPercent: 0,
      pCoreAverageGhz: 0,
      eCoreAverageGhz: 0,
      threads: 0,
      processes: 0
    },
    gpu: {
      deviceLabel: UNAVAILABLE,
      utilizationPercent: unavailableMetric(0),
      coreClockGhz: unavailableMetric(0),
      memoryClockGhz: unavailableMetric(0),
      powerDrawW: unavailableMetric(0),
      temperatureC: unavailableMetric<number | null>(null),
      coreUsagePercent: 0,
      vramUsedBytes: unavailableMetric(0),
      vramTotalBytes: unavailableMetric(0),
      encoderUsagePercent: unavailableMetric(0),
      frametimeHistory: emptyHistory,
      status: UNAVAILABLE,
      topProcesses: []
    },
    ram: {
      inUsePercent: 0,
      usedBytes: 0,
      totalBytes: 0,
      cachedBytes: unavailableMetric(0),
      freeBytes: 0,
      topProcesses: [],
      trendHistory: emptyHistory,
      stabilityLabel: UNAVAILABLE
    },
    storage: {
      deviceLabel: UNAVAILABLE,
      readBytesPerSec: unavailableMetric(0),
      writeBytesPerSec: unavailableMetric(0),
      healthPercent: unavailableMetric(0),
      healthGrade: UNAVAILABLE,
      latencyMs: unavailableMetric(0),
      queueDepth: unavailableMetric(0),
      temperatureC: unavailableMetric<number | null>(null),
      tbwBytes: unavailableMetric(0),
      tbwLimitBytes: unavailableMetric(0),
      powerOnHours: unavailableMetric(0),
      activityHistory: emptyHistory,
      activeProcess: null
    },
    network: {
      adapterLabel: UNAVAILABLE,
      downloadBytesPerSec: 0,
      uploadBytesPerSec: 0,
      latencyMs: unavailableMetric(0),
      jitterMs: unavailableMetric(0),
      packetLossPercent: unavailableMetric(0),
      signalDbm: unavailableMetric<number | null>(null),
      signalLabel: UNAVAILABLE,
      topUsage: [],
      history: emptyHistory,
      connections: unavailableMetric(0),
      dns: unavailableMetric(UNAVAILABLE),
      ipv4: unavailableMetric(UNAVAILABLE),
      publicIp: unavailableMetric(UNAVAILABLE)
    },
    powerBattery: {
      batteryLevelPercent: unavailableMetric<number | null>(null),
      batteryHealthPercent: unavailableMetric<number | null>(null),
      cycleCount: unavailableMetric<number | null>(null),
      fullChargeCapacityWh: unavailableMetric<number | null>(null),
      acConnected: unavailableMetric(false),
      totalSystemPowerW: unavailableMetric(0),
      cpuPowerW: unavailableMetric(0),
      gpuPowerW: unavailableMetric(0),
      estimatedRemainingMinutes: unavailableMetric<number | null>(null),
      powerHistory: emptyHistory
    },
    thermalsFans: {
      cpuTemperatureC: unavailableMetric<number | null>(null),
      gpuTemperatureC: unavailableMetric<number | null>(null),
      ssdTemperatureC: unavailableMetric<number | null>(null),
      cpuFanRpm: unavailableMetric<number | null>(null),
      gpuFanRpm: unavailableMetric<number | null>(null),
      coolingEfficiencyPercent: unavailableMetric(0),
      coolingLabel: UNAVAILABLE,
      noiseLevelDba: unavailableMetric<number | null>(null),
      noiseHistory: emptyHistory
    },
    topProcesses: [],
    systemHealth: {
      overallStatus: UNAVAILABLE,
      items: [
        { label: 'Overall Status', status: UNAVAILABLE, tone: 'slate' },
        { label: 'Thermal Status', status: UNAVAILABLE, tone: 'slate' },
        { label: 'Performance', status: UNAVAILABLE, tone: 'slate' },
        { label: 'Component Health', status: UNAVAILABLE, tone: 'slate' }
      ],
      recentAlerts: []
    },
    trends: {
      lines: [
        { label: 'CPU', valueLabel: UNAVAILABLE, tone: 'blue', history: emptyHistory },
        { label: 'GPU', valueLabel: UNAVAILABLE, tone: 'green', history: emptyHistory },
        { label: 'RAM', valueLabel: UNAVAILABLE, tone: 'purple', history: emptyHistory },
        { label: 'Disk', valueLabel: UNAVAILABLE, tone: 'blue', history: emptyHistory }
      ]
    },
    systemInformation: {
      deviceName: UNAVAILABLE,
      operatingSystem: UNAVAILABLE,
      motherboard: unavailableMetric(UNAVAILABLE),
      biosVersion: unavailableMetric(UNAVAILABLE),
      uptimeSeconds: 0,
      lastBootIso: new Date(now).toISOString(),
      driversStatus: unavailableMetric(UNAVAILABLE)
    },
    footer: {
      systemHealthy: false,
      statusLine: UNAVAILABLE,
      uptimeSeconds: 0,
      totalDataReadBytes: unavailableMetric(0),
      totalDataWrittenBytes: unavailableMetric(0),
      activityPercent: 0
    }
  };

  return {
    timestamp: now,
    chips,
    overview
  };
}
