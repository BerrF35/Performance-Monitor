import os from 'node:os';
import type {
  CoreUsage,
  DisplayAlertItem,
  DisplayFooterSummaryModel,
  DisplayMetric,
  DisplayNetworkUsageMetric,
  DisplayOverviewCards,
  DisplayProcessMetric,
  DisplayThermalSensor,
  HealthItem,
  MetricSource,
  MetricValue,
  NetworkUsageMetric,
  OverviewCards,
  PerformanceDisplay,
  PerformanceSnapshot,
  ProcessMetric,
  RawSnapshot,
  StatusChip,
  StorageProcessMetric,
  SystemHealthCardModel,
  TimePoint,
  Tone
} from '@shared/models';
import { bytes, createFallbackSnapshot } from './fallbackSnapshot';
import { type BatteryInfo, type DiskCounterInfo, type FanInfo, type GpuInfo, type NetworkInfo, type ProcessRow, WindowsMetricsAdapter } from './windowsAdapter';

interface CpuTimes {
  idle: number;
  total: number;
}

interface ProcessSample {
  cpuSeconds: number;
  timestamp: number;
}

interface NetworkSample {
  receivedBytes: number;
  sentBytes: number;
  timestamp: number;
}

interface SlowCache {
  cpuName?: string;
  maxBoostGhz?: number;
  gpuName?: string;
  storageLabel?: string;
  storageHealthPercent?: number;
  storageHealthGrade?: string;
  storageTemperatureC?: number | null;
  storagePowerOnHours?: number;
  storageTbwBytes?: number;
  storageTbwLimitBytes?: number;
  systemInfo?: {
    deviceName: string;
    operatingSystem: string | null;
    motherboard?: string | null;
    biosVersion?: string | null;
    driverStatus?: string | null;
  };
  powerMode?: string;
  publicIp?: string;
  lastStaticRefresh: number;
  lastPublicIpRefresh: number;
}

class HistoryRingBuffer {
  private points: TimePoint[];

  constructor(
    private readonly length: number,
    seed: TimePoint[]
  ) {
    const normalizedSeed = seed.slice(-length);
    const filler = normalizedSeed[0] ?? { timestamp: Date.now(), value: 0 };
    this.points = [
      ...Array.from({ length: Math.max(0, length - normalizedSeed.length) }, (_, index) => ({
        ...filler,
        timestamp: filler.timestamp - (length - normalizedSeed.length - index) * 1000
      })),
      ...normalizedSeed
    ];
  }

  push(value: number, secondary?: number, timestamp = Date.now()): TimePoint[] {
    this.points.push({ timestamp, value, secondary });

    while (this.points.length > this.length) {
      this.points.shift();
    }

    return this.series();
  }

  series(): TimePoint[] {
    return this.points.map((point) => ({ ...point }));
  }
}

const clamp = (value: number, min = 0, max = 100): number => Math.max(min, Math.min(max, value));
const round = (value: number, digits = 0): number => Number(value.toFixed(digits));
const metric = <T>(value: T, source: MetricSource, label?: string): MetricValue<T> => ({ value, source, label });
const isWindows = process.platform === 'win32';

function readCpuTimes(): CpuTimes[] {
  return os.cpus().map((cpu) => {
    const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
    return {
      idle: cpu.times.idle,
      total
    };
  });
}

function cpuPercentFromDelta(previous: CpuTimes, current: CpuTimes): number {
  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;

  if (totalDelta <= 0) {
    return 0;
  }

  return clamp(((totalDelta - idleDelta) / totalDelta) * 100);
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sourceOf<T>(value: MetricValue<T> | undefined, fallback: MetricSource = 'fallback'): MetricSource {
  return value?.source ?? fallback;
}

function displayMetric<T>(value: T, label: string, source: MetricSource, tone?: Tone): DisplayMetric<T> {
  return { value, label, source, tone };
}

function safePercent(numerator: number, denominator: number): number {
  return denominator > 0 ? clamp((numerator / denominator) * 100) : 0;
}

function percentLabel(value: number): string {
  return `${round(value)}%`;
}

function ghzLabel(value: number): string {
  return `${value.toFixed(2)} GHz`;
}

function wattsLabel(value: number): string {
  return `${value.toFixed(value >= 100 ? 0 : 1)} W`;
}

function celsiusLabel(value: number | null): string {
  return value === null ? 'N/A' : `${round(value)} °C`;
}

function msLabel(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 0)} ms`;
}

function integerLabel(value: number | null): string {
  return value === null ? 'N/A' : `${Math.round(value)}`;
}

function gbLabel(value: number): string {
  return `${(value / bytes.gb(1)).toFixed(1)} GB`;
}

function storageRateLabel(value: number): string {
  if (value >= bytes.gb(1)) {
    return `${(value / bytes.gb(1)).toFixed(1)} GB/s`;
  }

  return `${Math.max(0, value / bytes.mb(1)).toFixed(0)} MB/s`;
}

function networkMbps(value: number): number {
  return Math.max(0, (value * 8) / 1_000_000);
}

function mbpsLabel(value: number): string {
  const mbps = networkMbps(value);
  return `${mbps >= 100 ? mbps.toFixed(0) : mbps.toFixed(1)} Mbps`;
}

function durationLabel(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

function minutesLabel(totalMinutes: number | null): string {
  if (totalMinutes === null || totalMinutes <= 0 || !Number.isFinite(totalMinutes)) {
    return 'N/A';
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function tbLabel(value: number): string {
  return `${(value / bytes.tb(1)).toFixed(2)} TB`;
}

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function signalLabel(dbm: number | null): string {
  if (dbm === null) {
    return 'Unavailable';
  }

  if (dbm >= -60) {
    return 'Excellent';
  }

  if (dbm >= -70) {
    return 'Good';
  }

  if (dbm >= -80) {
    return 'Fair';
  }

  return 'Weak';
}

function thermalStatus(value: number | null): { label: string; tone: Tone } {
  if (value === null) {
    return { label: 'Unavailable', tone: 'slate' };
  }

  if (value >= 90) {
    return { label: 'Hot', tone: 'red' };
  }

  if (value >= 78) {
    return { label: 'Warm', tone: 'orange' };
  }

  return { label: 'Good', tone: 'green' };
}

function formatProcessName(name: string): string {
  return name.toLowerCase().endsWith('.exe') ? name : `${name}.exe`;
}

function processId(process: ProcessMetric | { name: string }, index: number): string {
  return 'pid' in process && process.pid ? `${process.pid}` : `${process.name}-${index}`;
}

export class SnapshotService {
  private readonly adapter = new WindowsMetricsAdapter();
  private raw: RawSnapshot = createFallbackSnapshot();
  private readonly histories = this.createHistoryBuffers(this.raw.overview);
  private snapshot: PerformanceSnapshot;
  private cpuTimes = readCpuTimes();
  private processSamples = new Map<number, ProcessSample>();
  private processRows: ProcessRow[] = [];
  private processMetrics: ProcessMetric[] = this.raw.overview.topProcesses;
  private networkSample: NetworkSample | null = null;
  private pingSamples: number[] = [12, 13, 11, 14];
  private batteryInfo: BatteryInfo | null = null;
  private fanInfo: FanInfo | null = null;
  private gpuInfo: GpuInfo | null = null;
  private networkInfo: NetworkInfo | null = null;
  private diskReadsSinceLaunch = this.raw.overview.footer.totalDataReadBytes.value;
  private diskWritesSinceLaunch = this.raw.overview.footer.totalDataWrittenBytes.value;
  private lastSnapshotAt = Date.now();
  private lastProcessRefresh = 0;
  private lastGpuRefresh = 0;
  private lastDiskRefresh = 0;
  private lastNetworkRefresh = 0;
  private lastPingRefresh = 0;
  private lastBatteryRefresh = 0;
  private lastFanRefresh = 0;
  private lastMemoryCacheRefresh = 0;
  private lastCpuTemperatureRefresh = 0;
  private cpuTemperatureC: number | null = this.raw.overview.cpu.temperatureC.value;
  private cpuTemperatureSource: MetricSource = 'fallback';
  private memoryCacheBytes = this.raw.overview.ram.cachedBytes.value;
  private diskCounters: DiskCounterInfo = {
    readBytesPerSec: this.raw.overview.storage.readBytesPerSec.value,
    writeBytesPerSec: this.raw.overview.storage.writeBytesPerSec.value,
    latencyMs: this.raw.overview.storage.latencyMs.value,
    queueDepth: this.raw.overview.storage.queueDepth.value
  };
  private slowCache: SlowCache = {
    lastStaticRefresh: 0,
    lastPublicIpRefresh: 0
  };

  constructor() {
    this.snapshot = this.composeSnapshot(this.raw);
  }

  async getSnapshot(): Promise<PerformanceSnapshot> {
    const now = Date.now();
    const elapsedSeconds = Math.max(0.1, (now - this.lastSnapshotAt) / 1000);

    await Promise.all([
      this.refreshStatic(now),
      this.refreshProcesses(now),
      this.refreshGpu(now),
      this.refreshDisk(now),
      this.refreshNetwork(now),
      this.refreshPing(now),
      this.refreshBattery(now),
      this.refreshFans(now),
      this.refreshMemoryCache(now),
      this.refreshCpuTemperature(now)
    ]);

    const previous = this.raw.overview;
    const cpu = this.buildCpu(now, previous);
    const topProcesses = this.processMetrics.length ? this.processMetrics : previous.topProcesses;
    const ram = this.buildRam(now, previous);
    const gpu = this.buildGpu(now, previous, topProcesses);
    const storage = this.buildStorage(now, elapsedSeconds, previous, topProcesses);
    const network = this.buildNetwork(now, previous, topProcesses);
    const powerBattery = this.buildPowerBattery(now, previous, cpu.packagePowerW.value, gpu.powerDrawW.value);
    const thermalsFans = this.buildThermalsFans(now, previous, cpu.temperatureC, gpu.temperatureC, storage.temperatureC);
    const systemHealth = this.buildSystemHealth(now, previous, cpu.temperatureC.value, gpu.temperatureC.value, storage.healthPercent.value);
    const systemInformation = this.buildSystemInformation(now, previous);
    const trends = this.buildTrends(cpu.utilizationPercent, gpu.utilizationPercent.value, ram.inUsePercent, storage);
    const footer = this.buildFooter(cpu.utilizationPercent, gpu.utilizationPercent.value, ram.inUsePercent, storage, network, systemHealth);
    const powerMode = this.slowCache.powerMode ?? this.raw.chips[1]?.value ?? 'Balanced';
    const chips: StatusChip[] = [
      {
        id: 'health',
        label: 'System Health',
        value: systemHealth.overallStatus,
        detail: footer.statusLine,
        tone: footer.systemHealthy ? 'green' : 'yellow'
      },
      {
        id: 'power',
        label: 'Power Mode',
        value: powerMode,
        detail: powerMode.toLowerCase().includes('balanced') ? 'Optimal balance' : 'Current Windows power plan',
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

    this.raw = {
      timestamp: now,
      chips,
      overview: {
        cpu,
        gpu,
        ram,
        storage,
        network,
        powerBattery,
        thermalsFans,
        topProcesses,
        systemHealth,
        trends,
        systemInformation,
        footer
      }
    };
    this.snapshot = this.composeSnapshot(this.raw);
    this.lastSnapshotAt = now;

    return this.snapshot;
  }

  private createHistoryBuffers(overview: OverviewCards) {
    const coolingSeed = overview.thermalsFans.noiseHistory.map((point) => ({
      timestamp: point.timestamp,
      value: overview.thermalsFans.coolingEfficiencyPercent.value
    }));

    return {
      cpuUtilization: new HistoryRingBuffer(60, overview.cpu.utilizationHistory),
      gpuFrametime: new HistoryRingBuffer(60, overview.gpu.frametimeHistory),
      ramTrend: new HistoryRingBuffer(60, overview.ram.trendHistory),
      storageActivity: new HistoryRingBuffer(60, overview.storage.activityHistory),
      network: new HistoryRingBuffer(60, overview.network.history),
      power: new HistoryRingBuffer(60, overview.powerBattery.powerHistory),
      noise: new HistoryRingBuffer(60, overview.thermalsFans.noiseHistory),
      cooling: new HistoryRingBuffer(60, coolingSeed),
      trendCpu: new HistoryRingBuffer(60, overview.trends.lines[0]?.history ?? []),
      trendGpu: new HistoryRingBuffer(60, overview.trends.lines[1]?.history ?? []),
      trendRam: new HistoryRingBuffer(60, overview.trends.lines[2]?.history ?? []),
      trendDisk: new HistoryRingBuffer(60, overview.trends.lines[3]?.history ?? [])
    };
  }

  private composeSnapshot(raw: RawSnapshot): PerformanceSnapshot {
    return {
      appName: 'Performance Monitor',
      timestamp: raw.timestamp,
      updateAgeMs: 0,
      raw,
      display: this.buildDisplay(raw)
    };
  }

  private buildCpu(now: number, previous: OverviewCards) {
    const previousTimes = this.cpuTimes;
    const currentTimes = readCpuTimes();
    const perLogicalCore = currentTimes.map((current, index) => cpuPercentFromDelta(previousTimes[index] ?? current, current));
    const totalPercent = round(average(perLogicalCore) || previous.cpu.utilizationPercent);
    const cpuInfos = os.cpus();
    const currentClockGhz = round(cpuInfos.reduce((sum, cpuInfo) => sum + cpuInfo.speed, 0) / Math.max(1, cpuInfos.length) / 1000, 2);
    const coreCount = Math.min(14, Math.max(1, perLogicalCore.length));
    const shownCores = perLogicalCore.slice(0, coreCount);
    const pCoreCount = coreCount >= 14 ? 6 : Math.max(1, Math.ceil(coreCount / 2));
    const perCoreUsage: CoreUsage[] = shownCores.map((usage, index) => {
      const isPCore = index < pCoreCount;
      return {
        id: `${isPCore ? 'p' : 'e'}-${index + 1}`,
        label: `${isPCore ? 'P' : 'E'}${index + 1}`,
        type: isPCore ? 'P-Core' : 'E-Core',
        usage: round(usage)
      };
    });
    const pCoreAverage = round(currentClockGhz * (0.74 + average(shownCores.slice(0, pCoreCount)) / 260), 2);
    const eCoreAverage = round(currentClockGhz * (0.54 + average(shownCores.slice(pCoreCount)) / 330), 2);
    const cpuTemp = this.cpuTemperatureC ?? previous.cpu.temperatureC.value;
    const packagePowerW = round(8 + (totalPercent / 100) * 58, 1);

    this.cpuTimes = currentTimes;

    return {
      ...previous.cpu,
      deviceLabel: this.slowCache.cpuName ?? previous.cpu.deviceLabel,
      utilizationPercent: totalPercent,
      currentClockGhz: currentClockGhz || previous.cpu.currentClockGhz,
      packagePowerW: metric(packagePowerW, 'estimated', 'Estimated when package power sensor is not exposed'),
      maxBoostGhz: this.slowCache.maxBoostGhz ?? previous.cpu.maxBoostGhz,
      temperatureC: metric(cpuTemp, this.cpuTemperatureSource, this.cpuTemperatureSource === 'fallback' ? 'ACPI thermal zone unavailable' : undefined),
      perCoreUsage,
      utilizationHistory: this.histories.cpuUtilization.push(totalPercent, undefined, now),
      status: cpuTemp && cpuTemp >= 92 ? 'Thermal Limit' : 'No Throttling',
      loadPercent: totalPercent,
      pCoreAverageGhz: pCoreAverage,
      eCoreAverageGhz: eCoreAverage,
      threads: this.processRows.reduce((sum, row) => sum + row.threadCount, 0) || previous.cpu.threads,
      processes: this.processRows.length || previous.cpu.processes
    };
  }

  private buildGpu(now: number, previous: OverviewCards, topProcesses: ProcessMetric[]) {
    const fallback = previous.gpu;
    const gpuInfo = this.gpuInfo;
    const utilization = gpuInfo?.utilizationPercent ?? fallback.utilizationPercent.value;
    const vramTotal = gpuInfo?.vramTotalBytes ?? fallback.vramTotalBytes.value;
    const vramUsed = gpuInfo?.vramUsedBytes ?? fallback.vramUsedBytes.value;
    const source: MetricSource = gpuInfo?.utilizationPercent === null || gpuInfo?.utilizationPercent === undefined ? 'fallback' : 'live';
    const frametime = clamp(6 + (utilization / 100) * 22 + Math.sin(now / 700) * 5, 0, 50);
    const gpuProcesses = topProcesses.slice(0, 4).map((process, index) => ({
      ...process,
      gpuPercent: index === 0 ? round(utilization * 0.62) : round((utilization * Math.max(0.08, 0.24 - index * 0.05)) / 1.2)
    }));

    return {
      ...fallback,
      deviceLabel: gpuInfo?.name ?? this.slowCache.gpuName ?? fallback.deviceLabel,
      utilizationPercent: metric(round(utilization), source),
      coreClockGhz: metric(round(gpuInfo?.coreClockGhz ?? fallback.coreClockGhz.value, 2), gpuInfo?.coreClockGhz ? 'live' : 'fallback'),
      memoryClockGhz: metric(round(gpuInfo?.memoryClockGhz ?? fallback.memoryClockGhz.value, 2), gpuInfo?.memoryClockGhz ? 'live' : 'fallback'),
      powerDrawW: metric(round(gpuInfo?.powerDrawW ?? 10 + utilization * 1.15, 1), gpuInfo?.powerDrawW ? 'live' : 'estimated'),
      temperatureC: metric(gpuInfo?.temperatureC ?? fallback.temperatureC.value, gpuInfo?.temperatureC ? 'live' : 'fallback'),
      coreUsagePercent: round(utilization),
      vramUsedBytes: metric(vramUsed, gpuInfo?.vramUsedBytes ? 'live' : 'fallback'),
      vramTotalBytes: metric(vramTotal, gpuInfo?.vramTotalBytes ? 'live' : 'fallback'),
      encoderUsagePercent: metric(gpuInfo?.encoderUsagePercent ?? fallback.encoderUsagePercent.value, gpuInfo?.encoderUsagePercent ? 'live' : 'fallback'),
      frametimeHistory: this.histories.gpuFrametime.push(frametime, undefined, now),
      status: utilization > 80 ? 'High GPU load' : 'GPU waiting on CPU',
      topProcesses: gpuProcesses
    };
  }

  private buildRam(now: number, previous: OverviewCards) {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    const inUsePercent = round((used / total) * 100);
    const cached = Math.min(this.memoryCacheBytes, Math.max(0, total - used));

    return {
      ...previous.ram,
      inUsePercent,
      usedBytes: used,
      totalBytes: total,
      cachedBytes: metric(cached, this.memoryCacheBytes ? 'live' : 'fallback'),
      freeBytes: free,
      topProcesses: this.processRows.length
        ? this.processRows
            .slice()
            .sort((a, b) => b.workingSetBytes - a.workingSetBytes)
            .slice(0, 4)
            .map((row) => ({
              name: formatProcessName(row.name),
              memoryBytes: row.workingSetBytes
            }))
        : previous.ram.topProcesses,
      trendHistory: this.histories.ramTrend.push(inUsePercent, undefined, now),
      stabilityLabel: inUsePercent < 82 ? 'Stable' : 'Pressure'
    };
  }

  private buildStorage(now: number, elapsedSeconds: number, previous: OverviewCards, topProcesses: ProcessMetric[]) {
    const fallback = previous.storage;
    const readBytesPerSec = this.diskCounters.readBytesPerSec ?? fallback.readBytesPerSec.value;
    const writeBytesPerSec = this.diskCounters.writeBytesPerSec ?? fallback.writeBytesPerSec.value;
    const readActivity = clamp((readBytesPerSec / bytes.gb(1.5)) * 100);
    const writeActivity = clamp((writeBytesPerSec / bytes.gb(1)) * 100);

    this.diskReadsSinceLaunch += readBytesPerSec * elapsedSeconds;
    this.diskWritesSinceLaunch += writeBytesPerSec * elapsedSeconds;

    const activeProcess = topProcesses[0]
      ? {
          name: `${topProcesses[0].name} (active I/O)`,
          readBytesPerSec: topProcesses[0].diskReadBytesPerSec ?? readBytesPerSec * 0.34,
          writeBytesPerSec: topProcesses[0].diskWriteBytesPerSec ?? writeBytesPerSec * 0.28
        }
      : fallback.activeProcess;

    return {
      ...fallback,
      deviceLabel: this.slowCache.storageLabel ?? fallback.deviceLabel,
      readBytesPerSec: metric(readBytesPerSec, this.diskCounters.readBytesPerSec === null ? 'fallback' : 'live'),
      writeBytesPerSec: metric(writeBytesPerSec, this.diskCounters.writeBytesPerSec === null ? 'fallback' : 'live'),
      healthPercent: metric(this.slowCache.storageHealthPercent ?? fallback.healthPercent.value, this.slowCache.storageHealthPercent ? 'live' : 'fallback'),
      healthGrade: this.slowCache.storageHealthGrade ?? fallback.healthGrade,
      latencyMs: metric(round(this.diskCounters.latencyMs ?? fallback.latencyMs.value, 2), this.diskCounters.latencyMs === null ? 'fallback' : 'live'),
      queueDepth: metric(round(this.diskCounters.queueDepth ?? fallback.queueDepth.value, 1), this.diskCounters.queueDepth === null ? 'fallback' : 'live'),
      temperatureC: metric(this.slowCache.storageTemperatureC ?? fallback.temperatureC.value, this.slowCache.storageTemperatureC ? 'live' : 'fallback'),
      tbwBytes: metric(this.slowCache.storageTbwBytes ?? fallback.tbwBytes.value, this.slowCache.storageTbwBytes ? 'live' : 'fallback'),
      tbwLimitBytes: metric(this.slowCache.storageTbwLimitBytes ?? fallback.tbwLimitBytes.value, this.slowCache.storageTbwLimitBytes ? 'live' : 'fallback'),
      powerOnHours: metric(this.slowCache.storagePowerOnHours ?? fallback.powerOnHours.value, this.slowCache.storagePowerOnHours ? 'live' : 'fallback'),
      activityHistory: this.histories.storageActivity.push(readActivity, writeActivity, now),
      activeProcess
    };
  }

  private buildNetwork(now: number, previous: OverviewCards, topProcesses: ProcessMetric[]) {
    const fallback = previous.network;
    const current = this.networkInfo;
    let download = fallback.downloadBytesPerSec;
    let upload = fallback.uploadBytesPerSec;

    if (
      current?.receivedBytes !== null &&
      current?.receivedBytes !== undefined &&
      current?.sentBytes !== null &&
      current?.sentBytes !== undefined &&
      this.networkSample
    ) {
      const elapsedSeconds = Math.max(0.1, (now - this.networkSample.timestamp) / 1000);
      download = Math.max(0, (current.receivedBytes - this.networkSample.receivedBytes) / elapsedSeconds);
      upload = Math.max(0, (current.sentBytes - this.networkSample.sentBytes) / elapsedSeconds);
    }

    if (current?.receivedBytes !== null && current?.receivedBytes !== undefined && current?.sentBytes !== null && current?.sentBytes !== undefined) {
      this.networkSample = {
        receivedBytes: current.receivedBytes,
        sentBytes: current.sentBytes,
        timestamp: now
      };
    }

    return {
      ...fallback,
      adapterLabel: current?.adapterLabel ?? fallback.adapterLabel,
      downloadBytesPerSec: download,
      uploadBytesPerSec: upload,
      latencyMs: metric(this.pingSamples.at(-1) ?? fallback.latencyMs.value, this.pingSamples.length > 4 ? 'live' : 'fallback'),
      jitterMs: metric(round(this.calculateJitter(), 1), this.pingSamples.length > 4 ? 'live' : 'fallback'),
      packetLossPercent: fallback.packetLossPercent,
      signalDbm: metric(previous.network.signalDbm.value, previous.network.signalDbm.source),
      signalLabel: signalLabel(previous.network.signalDbm.value),
      topUsage: this.buildNetworkUsage(topProcesses, download, upload),
      history: this.histories.network.push(clamp(networkMbps(download) / 4), clamp(networkMbps(upload) / 2), now),
      connections: metric(current?.connections ?? fallback.connections.value, current?.connections ? 'live' : 'fallback'),
      dns: metric(current?.dns ?? fallback.dns.value, current?.dns ? 'live' : 'fallback'),
      ipv4: metric(current?.ipv4 ?? fallback.ipv4.value, current?.ipv4 ? 'live' : 'fallback'),
      publicIp: metric(this.slowCache.publicIp ?? fallback.publicIp.value, this.slowCache.publicIp ? 'live' : 'fallback')
    };
  }

  private buildNetworkUsage(topProcesses: ProcessMetric[], download: number, upload: number): NetworkUsageMetric[] {
    const total = download + upload;
    if (!topProcesses.length) {
      return this.raw.overview.network.topUsage;
    }

    return topProcesses.slice(0, 4).map((process, index) => ({
      name: process.name,
      bytesPerSec: process.networkBytesPerSec ?? total * [0.34, 0.24, 0.14, 0.08][index]
    }));
  }

  private buildPowerBattery(now: number, previous: OverviewCards, cpuPowerW: number, gpuPowerW: number) {
    const fallback = previous.powerBattery;
    const battery = this.batteryInfo;
    const totalPower = round(cpuPowerW + gpuPowerW + 8.5 + Math.sin(now / 1600) * 1.5, 1);

    return {
      ...fallback,
      batteryLevelPercent: metric(battery?.levelPercent ?? fallback.batteryLevelPercent.value, battery?.levelPercent === null || battery?.levelPercent === undefined ? 'fallback' : 'live'),
      batteryHealthPercent: metric(battery?.healthPercent ?? fallback.batteryHealthPercent.value, battery?.healthPercent ? 'live' : 'fallback'),
      cycleCount: metric(battery?.cycleCount ?? fallback.cycleCount.value, battery?.cycleCount ? 'live' : 'fallback'),
      fullChargeCapacityWh: metric(battery?.fullChargeCapacityWh ?? fallback.fullChargeCapacityWh.value, battery?.fullChargeCapacityWh ? 'live' : 'fallback'),
      acConnected: metric(battery?.acConnected ?? fallback.acConnected.value, battery?.acConnected === null || battery?.acConnected === undefined ? 'fallback' : 'live'),
      totalSystemPowerW: metric(totalPower, 'estimated', 'Estimated from component draw where platform power telemetry is unavailable'),
      cpuPowerW: metric(cpuPowerW, 'estimated'),
      gpuPowerW: metric(gpuPowerW, this.gpuInfo?.powerDrawW ? 'live' : 'estimated'),
      estimatedRemainingMinutes: metric(battery?.estimatedRemainingMinutes ?? fallback.estimatedRemainingMinutes.value, battery?.estimatedRemainingMinutes ? 'live' : 'fallback'),
      powerHistory: this.histories.power.push(totalPower, undefined, now)
    };
  }

  private buildThermalsFans(
    now: number,
    previous: OverviewCards,
    cpuTemperature: MetricValue<number | null>,
    gpuTemperature: MetricValue<number | null>,
    ssdTemperature: MetricValue<number | null>
  ) {
    const fallback = previous.thermalsFans;
    const maxTemp = Math.max(cpuTemperature.value ?? 0, gpuTemperature.value ?? 0, ssdTemperature.value ?? 0);
    const coolingEfficiency = clamp(100 - Math.max(0, maxTemp - 35) * 1.4);
    const cpuFanRpm = this.fanInfo?.cpuFanRpm ?? fallback.cpuFanRpm.value;
    const gpuFanRpm = this.fanInfo?.gpuFanRpm ?? fallback.gpuFanRpm.value;
    const noise = cpuFanRpm || gpuFanRpm ? round(24 + ((cpuFanRpm ?? 0) + (gpuFanRpm ?? 0)) / 550, 1) : fallback.noiseLevelDba.value;

    return {
      ...fallback,
      cpuTemperatureC: cpuTemperature,
      gpuTemperatureC: gpuTemperature,
      ssdTemperatureC: ssdTemperature,
      cpuFanRpm: metric(cpuFanRpm, this.fanInfo?.cpuFanRpm ? 'live' : 'fallback'),
      gpuFanRpm: metric(gpuFanRpm, this.fanInfo?.gpuFanRpm ? 'live' : 'fallback'),
      coolingEfficiencyPercent: metric(round(coolingEfficiency), 'estimated'),
      coolingLabel: coolingEfficiency > 75 ? 'Good' : coolingEfficiency > 55 ? 'Warm' : 'Limited',
      noiseLevelDba: metric(noise, this.fanInfo?.cpuFanRpm || this.fanInfo?.gpuFanRpm ? 'estimated' : 'fallback'),
      noiseHistory: this.histories.noise.push(noise ?? 0, undefined, now)
    };
  }

  private buildSystemHealth(now: number, previous: OverviewCards, cpuTemp: number | null, gpuTemp: number | null, storageHealth: number): SystemHealthCardModel {
    const maxTemp = Math.max(cpuTemp ?? 0, gpuTemp ?? 0);
    const thermalGood = maxTemp < 86;
    const componentGood = storageHealth >= 80;
    const overallStatus = thermalGood && componentGood ? 'Excellent' : thermalGood ? 'Good' : 'Attention';
    const alerts =
      overallStatus === 'Excellent'
        ? previous.systemHealth.recentAlerts
        : [
            {
              id: 'attention',
              title: thermalGood ? 'Component health needs attention' : 'Thermal limits approaching',
              detail: thermalGood ? 'Storage or battery telemetry reported degraded health' : 'Review fan curve or active workload',
              severity: 'warning' as const,
              timestamp: now
            }
          ];
    const overallTone: Tone = overallStatus === 'Attention' ? 'yellow' : 'green';
    const thermalTone: Tone = thermalGood ? 'green' : 'orange';
    const componentTone: Tone = componentGood ? 'green' : 'yellow';

    return {
      overallStatus,
      items: [
        { label: 'Overall Status', status: overallStatus, tone: overallTone },
        { label: 'Thermal Status', status: thermalGood ? 'Good' : 'Warm', tone: thermalTone },
        { label: 'Performance', status: 'Good', tone: 'green' },
        { label: 'Component Health', status: componentGood ? 'Excellent' : 'Review', tone: componentTone }
      ],
      recentAlerts: alerts
    };
  }

  private buildTrends(cpu: number, gpu: number, ram: number, storage: OverviewCards['storage']) {
    const diskValue = clamp(((storage.readBytesPerSec.value + storage.writeBytesPerSec.value) / bytes.gb(1.5)) * 100);
    const now = Date.now();

    return {
      lines: [
        { label: 'CPU', valueLabel: percentLabel(cpu), tone: 'blue' as const, history: this.histories.trendCpu.push(cpu, undefined, now) },
        { label: 'GPU', valueLabel: percentLabel(gpu), tone: 'green' as const, history: this.histories.trendGpu.push(gpu, undefined, now) },
        { label: 'RAM', valueLabel: percentLabel(ram), tone: 'purple' as const, history: this.histories.trendRam.push(ram, undefined, now) },
        { label: 'Disk', valueLabel: percentLabel(diskValue), tone: 'blue' as const, history: this.histories.trendDisk.push(diskValue, undefined, now) }
      ]
    };
  }

  private buildSystemInformation(now: number, previous: OverviewCards) {
    const fallback = previous.systemInformation;
    const uptimeSeconds = os.uptime();

    return {
      ...fallback,
      deviceName: this.slowCache.systemInfo?.deviceName ?? os.hostname(),
      operatingSystem: this.slowCache.systemInfo?.operatingSystem ?? fallback.operatingSystem,
      motherboard: metric(this.slowCache.systemInfo?.motherboard ?? fallback.motherboard.value, this.slowCache.systemInfo?.motherboard ? 'live' : 'fallback'),
      biosVersion: metric(this.slowCache.systemInfo?.biosVersion ?? fallback.biosVersion.value, this.slowCache.systemInfo?.biosVersion ? 'live' : 'fallback'),
      uptimeSeconds,
      lastBootIso: new Date(now - uptimeSeconds * 1000).toISOString(),
      driversStatus: metric(this.slowCache.systemInfo?.driverStatus ?? fallback.driversStatus.value, this.slowCache.systemInfo?.driverStatus ? 'live' : 'fallback')
    };
  }

  private buildFooter(cpu: number, gpu: number, ram: number, storage: OverviewCards['storage'], network: OverviewCards['network'], health: SystemHealthCardModel) {
    const activityPercent = clamp(cpu * 0.28 + gpu * 0.24 + ram * 0.18 + ((storage.readBytesPerSec.value + storage.writeBytesPerSec.value) / bytes.gb(1)) * 12 + ((network.downloadBytesPerSec + network.uploadBytesPerSec) / bytes.mb(25)) * 6);

    return {
      systemHealthy: health.overallStatus !== 'Attention',
      statusLine: health.overallStatus === 'Attention' ? 'Review active alerts' : 'All systems normal',
      uptimeSeconds: os.uptime(),
      totalDataReadBytes: metric(this.diskReadsSinceLaunch, 'estimated', 'Integrated from disk throughput counters during this app session'),
      totalDataWrittenBytes: metric(this.diskWritesSinceLaunch, 'estimated', 'Integrated from disk throughput counters during this app session'),
      activityPercent: round(activityPercent)
    };
  }

  private buildDisplay(raw: RawSnapshot): PerformanceDisplay {
    const overview = raw.overview;
    const displayOverview: DisplayOverviewCards = {
      cpu: this.displayCpu(overview),
      gpu: this.displayGpu(overview),
      ram: this.displayRam(overview),
      storage: this.displayStorage(overview),
      network: this.displayNetwork(overview),
      powerBattery: this.displayPowerBattery(overview),
      thermalsFans: this.displayThermalsFans(overview),
      topProcesses: this.displayProcesses(overview.topProcesses, this.processRows.length ? 'live' : 'fallback'),
      systemHealth: this.displaySystemHealth(overview),
      trends: this.displayTrends(overview),
      systemInformation: this.displaySystemInformation(overview),
      footer: this.displayFooter(overview)
    };

    return {
      timestamp: raw.timestamp,
      updateAgeLabel: 'now',
      chips: raw.chips,
      overview: displayOverview
    };
  }

  private displayCpu(overview: OverviewCards) {
    const cpu = overview.cpu;
    const pCores = cpu.perCoreUsage.filter((core) => core.type === 'P-Core');
    const eCores = cpu.perCoreUsage.filter((core) => core.type === 'E-Core');
    const pUsage = round(average(pCores.map((core) => core.usage)));
    const eUsage = round(average(eCores.map((core) => core.usage)));

    return {
      deviceLabel: cpu.deviceLabel,
      utilization: displayMetric(cpu.utilizationPercent, percentLabel(cpu.utilizationPercent), 'live', 'blue'),
      currentClock: displayMetric(cpu.currentClockGhz, ghzLabel(cpu.currentClockGhz), 'live'),
      packagePower: displayMetric(cpu.packagePowerW.value, wattsLabel(cpu.packagePowerW.value), sourceOf(cpu.packagePowerW)),
      maxBoost: displayMetric(cpu.maxBoostGhz, ghzLabel(cpu.maxBoostGhz), this.slowCache.maxBoostGhz ? 'live' : 'fallback'),
      temperature: displayMetric(cpu.temperatureC.value, celsiusLabel(cpu.temperatureC.value), sourceOf(cpu.temperatureC)),
      pCoreUsageAveragePercent: displayMetric(pUsage, percentLabel(pUsage), 'live', 'blue'),
      eCoreUsageAveragePercent: displayMetric(eUsage, percentLabel(eUsage), 'live', 'cyan'),
      perCoreUsage: cpu.perCoreUsage.map((core) => {
        const tone: Tone = core.type === 'P-Core' ? 'blue' : 'cyan';

        return {
          id: core.id,
          label: core.label,
          type: core.type,
          usagePercent: core.usage,
          usageLabel: percentLabel(core.usage),
          tone
        };
      }),
      utilizationHistory: cpu.utilizationHistory,
      status: displayMetric(cpu.status, cpu.status, cpu.status === 'No Throttling' ? 'live' : 'estimated', cpu.status === 'No Throttling' ? 'green' : 'orange'),
      load: displayMetric(cpu.loadPercent, percentLabel(cpu.loadPercent), 'live'),
      pCoreAverage: displayMetric(cpu.pCoreAverageGhz, ghzLabel(cpu.pCoreAverageGhz), 'estimated'),
      eCoreAverage: displayMetric(cpu.eCoreAverageGhz, ghzLabel(cpu.eCoreAverageGhz), 'estimated'),
      threads: displayMetric(cpu.threads, `${cpu.threads}`, this.processRows.length ? 'live' : 'fallback'),
      processes: displayMetric(cpu.processes, `${cpu.processes}`, this.processRows.length ? 'live' : 'fallback')
    };
  }

  private displayGpu(overview: OverviewCards) {
    const gpu = overview.gpu;
    const vramPercent = round(safePercent(gpu.vramUsedBytes.value, gpu.vramTotalBytes.value));

    return {
      deviceLabel: gpu.deviceLabel,
      utilization: displayMetric(gpu.utilizationPercent.value, percentLabel(gpu.utilizationPercent.value), sourceOf(gpu.utilizationPercent), 'green'),
      coreClock: displayMetric(gpu.coreClockGhz.value, ghzLabel(gpu.coreClockGhz.value), sourceOf(gpu.coreClockGhz)),
      memoryClock: displayMetric(gpu.memoryClockGhz.value, ghzLabel(gpu.memoryClockGhz.value), sourceOf(gpu.memoryClockGhz)),
      powerDraw: displayMetric(gpu.powerDrawW.value, wattsLabel(gpu.powerDrawW.value), sourceOf(gpu.powerDrawW)),
      temperature: displayMetric(gpu.temperatureC.value, celsiusLabel(gpu.temperatureC.value), sourceOf(gpu.temperatureC)),
      coreUsage: displayMetric(gpu.coreUsagePercent, percentLabel(gpu.coreUsagePercent), sourceOf(gpu.utilizationPercent), 'green'),
      vramUsagePercent: displayMetric(vramPercent, percentLabel(vramPercent), sourceOf(gpu.vramUsedBytes), 'green'),
      vramUsage: displayMetric(`${gbLabel(gpu.vramUsedBytes.value)} / ${gbLabel(gpu.vramTotalBytes.value)}`, `${gbLabel(gpu.vramUsedBytes.value)} / ${gbLabel(gpu.vramTotalBytes.value)}`, sourceOf(gpu.vramUsedBytes), 'green'),
      encoderUsage: displayMetric(gpu.encoderUsagePercent.value, percentLabel(gpu.encoderUsagePercent.value), sourceOf(gpu.encoderUsagePercent), 'green'),
      frametimeHistory: gpu.frametimeHistory,
      status: displayMetric(gpu.status, gpu.status, gpu.status.includes('waiting') ? 'estimated' : 'live', gpu.status.includes('High') ? 'orange' : 'yellow'),
      topProcesses: this.displayProcesses(gpu.topProcesses, this.gpuInfo?.utilizationPercent === null || this.gpuInfo?.utilizationPercent === undefined ? 'fallback' : 'estimated')
    };
  }

  private displayRam(overview: OverviewCards) {
    const ram = overview.ram;
    const cachedPercent = round(safePercent(ram.cachedBytes.value, ram.totalBytes));
    const freePercent = round(safePercent(ram.freeBytes, ram.totalBytes));

    return {
      inUse: displayMetric(ram.inUsePercent, percentLabel(ram.inUsePercent), 'live', 'purple'),
      usedTotalLabel: `${gbLabel(ram.usedBytes)} / ${gbLabel(ram.totalBytes)}`,
      used: displayMetric(ram.usedBytes, gbLabel(ram.usedBytes), 'live', 'purple'),
      cached: displayMetric(ram.cachedBytes.value, gbLabel(ram.cachedBytes.value), sourceOf(ram.cachedBytes), 'blue'),
      cachedPercent: displayMetric(cachedPercent, percentLabel(cachedPercent), sourceOf(ram.cachedBytes), 'blue'),
      free: displayMetric(ram.freeBytes, gbLabel(ram.freeBytes), 'live', 'slate'),
      freePercent: displayMetric(freePercent, percentLabel(freePercent), 'live', 'slate'),
      topProcesses: ram.topProcesses.map((process, index) => {
        const source: MetricSource = this.processRows.length ? 'live' : 'fallback';

        return {
          id: `${process.name}-${index}`,
          name: process.name,
          memoryLabel: gbLabel(process.memoryBytes),
          source
        };
      }),
      trendHistory: ram.trendHistory,
      stability: displayMetric(ram.stabilityLabel, ram.stabilityLabel, 'estimated', ram.stabilityLabel === 'Stable' ? 'green' : 'orange')
    };
  }

  private displayStorage(overview: OverviewCards) {
    const storage = overview.storage;
    const readActivity = round(clamp((storage.readBytesPerSec.value / bytes.gb(1.5)) * 100));
    const writeActivity = round(clamp((storage.writeBytesPerSec.value / bytes.gb(1)) * 100));
    const activeProcess = storage.activeProcess ? this.displayStorageProcess(storage.activeProcess, 'estimated') : null;

    return {
      deviceLabel: storage.deviceLabel,
      readSpeed: displayMetric(storage.readBytesPerSec.value, storageRateLabel(storage.readBytesPerSec.value), sourceOf(storage.readBytesPerSec)),
      writeSpeed: displayMetric(storage.writeBytesPerSec.value, storageRateLabel(storage.writeBytesPerSec.value), sourceOf(storage.writeBytesPerSec)),
      readActivityPercent: displayMetric(readActivity, percentLabel(readActivity), sourceOf(storage.readBytesPerSec), 'blue'),
      writeActivityPercent: displayMetric(writeActivity, percentLabel(writeActivity), sourceOf(storage.writeBytesPerSec), 'purple'),
      health: displayMetric(storage.healthPercent.value, percentLabel(storage.healthPercent.value), sourceOf(storage.healthPercent), 'lime'),
      healthGrade: displayMetric(storage.healthGrade, storage.healthGrade, sourceOf(storage.healthPercent), 'lime'),
      latency: displayMetric(storage.latencyMs.value, msLabel(storage.latencyMs.value), sourceOf(storage.latencyMs)),
      queueDepth: displayMetric(storage.queueDepth.value, `${storage.queueDepth.value}`, sourceOf(storage.queueDepth)),
      temperature: displayMetric(storage.temperatureC.value, celsiusLabel(storage.temperatureC.value), sourceOf(storage.temperatureC)),
      tbw: displayMetric(`${tbLabel(storage.tbwBytes.value)} / ${tbLabel(storage.tbwLimitBytes.value)}`, `${tbLabel(storage.tbwBytes.value)} / ${tbLabel(storage.tbwLimitBytes.value)}`, sourceOf(storage.tbwBytes)),
      powerOnHours: displayMetric(storage.powerOnHours.value, `${Math.round(storage.powerOnHours.value)} h`, sourceOf(storage.powerOnHours)),
      activityHistory: storage.activityHistory,
      activeProcess
    };
  }

  private displayStorageProcess(process: StorageProcessMetric, source: MetricSource) {
    return {
      name: process.name,
      readLabel: storageRateLabel(process.readBytesPerSec),
      writeLabel: storageRateLabel(process.writeBytesPerSec),
      source
    };
  }

  private displayNetwork(overview: OverviewCards) {
    const network = overview.network;
    const signalStrength = network.signalDbm.value === null ? 'N/A' : `${network.signalDbm.value} dBm`;

    return {
      adapterLabel: network.adapterLabel,
      downloadRate: displayMetric(networkMbps(network.downloadBytesPerSec), mbpsLabel(network.downloadBytesPerSec), 'live', 'blue'),
      uploadRate: displayMetric(networkMbps(network.uploadBytesPerSec), mbpsLabel(network.uploadBytesPerSec), 'live', 'green'),
      latency: displayMetric(network.latencyMs.value, `${network.latencyMs.value} ms`, sourceOf(network.latencyMs)),
      jitter: displayMetric(network.jitterMs.value, `${network.jitterMs.value} ms`, sourceOf(network.jitterMs)),
      packetLoss: displayMetric(network.packetLossPercent.value, percentLabel(network.packetLossPercent.value), sourceOf(network.packetLossPercent)),
      signal: displayMetric(network.signalDbm.value, signalStrength, sourceOf(network.signalDbm), 'green'),
      signalLabel: displayMetric(network.signalLabel, network.signalLabel, sourceOf(network.signalDbm), network.signalLabel === 'Excellent' || network.signalLabel === 'Good' ? 'green' : 'orange'),
      topUsage: this.displayNetworkUsage(network.topUsage),
      history: network.history,
      connections: displayMetric(network.connections.value, `${network.connections.value}`, sourceOf(network.connections)),
      dns: displayMetric(network.dns.value, network.dns.value, sourceOf(network.dns)),
      ipv4: displayMetric(network.ipv4.value, network.ipv4.value, sourceOf(network.ipv4)),
      publicIp: displayMetric(network.publicIp.value, network.publicIp.value, sourceOf(network.publicIp))
    };
  }

  private displayNetworkUsage(items: NetworkUsageMetric[]): DisplayNetworkUsageMetric[] {
    return items.map((item, index) => ({
      id: `${item.name}-${index}`,
      name: item.name,
      rateMbps: networkMbps(item.bytesPerSec),
      rateLabel: mbpsLabel(item.bytesPerSec),
      source: this.processRows.length ? 'estimated' : 'fallback'
    }));
  }

  private displayPowerBattery(overview: OverviewCards) {
    const power = overview.powerBattery;

    return {
      batteryLevel: displayMetric(power.batteryLevelPercent.value, power.batteryLevelPercent.value === null ? 'N/A' : percentLabel(power.batteryLevelPercent.value), sourceOf(power.batteryLevelPercent), 'green'),
      batteryHealth: displayMetric(power.batteryHealthPercent.value, power.batteryHealthPercent.value === null ? 'N/A' : percentLabel(power.batteryHealthPercent.value), sourceOf(power.batteryHealthPercent), 'green'),
      cycleCount: displayMetric(power.cycleCount.value, integerLabel(power.cycleCount.value), sourceOf(power.cycleCount)),
      fullChargeCapacity: displayMetric(power.fullChargeCapacityWh.value, power.fullChargeCapacityWh.value === null ? 'N/A' : `${round(power.fullChargeCapacityWh.value)} Wh`, sourceOf(power.fullChargeCapacityWh)),
      acStatus: displayMetric(power.acConnected.value, power.acConnected.value ? 'AC Connected' : 'On Battery', sourceOf(power.acConnected), power.acConnected.value ? 'green' : 'yellow'),
      totalSystemPower: displayMetric(power.totalSystemPowerW.value, wattsLabel(power.totalSystemPowerW.value), sourceOf(power.totalSystemPowerW)),
      cpuPower: displayMetric(power.cpuPowerW.value, wattsLabel(power.cpuPowerW.value), sourceOf(power.cpuPowerW)),
      gpuPower: displayMetric(power.gpuPowerW.value, wattsLabel(power.gpuPowerW.value), sourceOf(power.gpuPowerW)),
      estimatedRemaining: displayMetric(power.estimatedRemainingMinutes.value, minutesLabel(power.estimatedRemainingMinutes.value), sourceOf(power.estimatedRemainingMinutes)),
      powerHistory: power.powerHistory
    };
  }

  private displayThermalsFans(overview: OverviewCards) {
    const thermals = overview.thermalsFans;
    const sensors: DisplayThermalSensor[] = [
      this.displayThermalSensor('cpu', 'CPU', thermals.cpuTemperatureC),
      this.displayThermalSensor('gpu', 'GPU', thermals.gpuTemperatureC),
      this.displayThermalSensor('ssd', 'SSD', thermals.ssdTemperatureC)
    ];
    const coolingHistory = this.histories.cooling.push(thermals.coolingEfficiencyPercent.value);

    return {
      sensors,
      cpuFan: displayMetric(thermals.cpuFanRpm.value, thermals.cpuFanRpm.value === null ? 'N/A' : `${Math.round(thermals.cpuFanRpm.value)} RPM`, sourceOf(thermals.cpuFanRpm), 'blue'),
      gpuFan: displayMetric(thermals.gpuFanRpm.value, thermals.gpuFanRpm.value === null ? 'N/A' : `${Math.round(thermals.gpuFanRpm.value)} RPM`, sourceOf(thermals.gpuFanRpm), 'blue'),
      coolingEfficiency: displayMetric(thermals.coolingEfficiencyPercent.value, percentLabel(thermals.coolingEfficiencyPercent.value), sourceOf(thermals.coolingEfficiencyPercent), 'green'),
      coolingLabel: displayMetric(thermals.coolingLabel, thermals.coolingLabel, sourceOf(thermals.coolingEfficiencyPercent), thermals.coolingLabel === 'Good' ? 'green' : 'orange'),
      coolingHistory,
      noiseLevel: displayMetric(thermals.noiseLevelDba.value, thermals.noiseLevelDba.value === null ? 'N/A' : `${thermals.noiseLevelDba.value} dB(A)`, sourceOf(thermals.noiseLevelDba), 'green'),
      noiseHistory: thermals.noiseHistory
    };
  }

  private displayThermalSensor(id: string, label: string, temperature: MetricValue<number | null>): DisplayThermalSensor {
    const status = thermalStatus(temperature.value);

    return {
      id,
      label,
      temperature: displayMetric(temperature.value, celsiusLabel(temperature.value), sourceOf(temperature), status.tone),
      status: displayMetric(status.label, status.label, sourceOf(temperature), status.tone)
    };
  }

  private displaySystemHealth(overview: OverviewCards) {
    const health = overview.systemHealth;

    return {
      overallStatus: displayMetric(health.overallStatus, health.overallStatus, 'estimated', health.overallStatus === 'Attention' ? 'yellow' : 'green'),
      items: health.items,
      recentAlerts: health.recentAlerts.map((alert): DisplayAlertItem => ({
        ...alert,
        timeLabel: dateTimeLabel(new Date(alert.timestamp).toISOString())
      }))
    };
  }

  private displayTrends(overview: OverviewCards) {
    return {
      lines: overview.trends.lines.map((line) => ({
        label: line.label,
        value: displayMetric(Number.parseFloat(line.valueLabel), line.valueLabel, 'estimated', line.tone),
        tone: line.tone,
        history: line.history
      }))
    };
  }

  private displaySystemInformation(overview: OverviewCards) {
    const info = overview.systemInformation;

    return {
      deviceName: displayMetric(info.deviceName, info.deviceName, 'live'),
      operatingSystem: displayMetric(info.operatingSystem, info.operatingSystem, this.slowCache.systemInfo?.operatingSystem ? 'live' : 'fallback'),
      motherboard: displayMetric(info.motherboard.value, info.motherboard.value, sourceOf(info.motherboard)),
      biosVersion: displayMetric(info.biosVersion.value, info.biosVersion.value, sourceOf(info.biosVersion)),
      uptime: displayMetric(info.uptimeSeconds, durationLabel(info.uptimeSeconds), 'live'),
      lastBoot: displayMetric(info.lastBootIso, dateTimeLabel(info.lastBootIso), 'live'),
      driversStatus: displayMetric(info.driversStatus.value, info.driversStatus.value, sourceOf(info.driversStatus), info.driversStatus.value.includes('problem') ? 'yellow' : 'green')
    };
  }

  private displayFooter(overview: OverviewCards): DisplayFooterSummaryModel {
    const footer = overview.footer;
    const activityDotTotal = 8;
    const activityDotCount = Math.max(0, Math.min(activityDotTotal, Math.ceil((footer.activityPercent / 100) * activityDotTotal)));

    return {
      systemHealthy: footer.systemHealthy,
      healthLabel: footer.systemHealthy ? 'System Healthy' : 'Attention Required',
      statusLine: footer.statusLine,
      uptime: displayMetric(footer.uptimeSeconds, durationLabel(footer.uptimeSeconds), 'live'),
      totalDataRead: displayMetric(footer.totalDataReadBytes.value, tbLabel(footer.totalDataReadBytes.value), sourceOf(footer.totalDataReadBytes)),
      totalDataWritten: displayMetric(footer.totalDataWrittenBytes.value, footer.totalDataWrittenBytes.value >= bytes.tb(1) ? tbLabel(footer.totalDataWrittenBytes.value) : gbLabel(footer.totalDataWrittenBytes.value), sourceOf(footer.totalDataWrittenBytes)),
      activityLabel: percentLabel(footer.activityPercent),
      activityDotCount,
      activityDotTotal
    };
  }

  private displayProcesses(processes: ProcessMetric[], source: MetricSource): DisplayProcessMetric[] {
    return processes.slice(0, 6).map((process, index) => ({
      id: processId(process, index),
      name: process.name,
      cpuPercent: process.cpuPercent,
      cpuLabel: percentLabel(process.cpuPercent),
      ramLabel: gbLabel(process.memoryBytes),
      gpuPercent: process.gpuPercent,
      gpuLabel: percentLabel(process.gpuPercent),
      diskReadLabel: process.diskReadBytesPerSec === undefined ? undefined : storageRateLabel(process.diskReadBytesPerSec),
      diskWriteLabel: process.diskWriteBytesPerSec === undefined ? undefined : storageRateLabel(process.diskWriteBytesPerSec),
      networkRateLabel: process.networkBytesPerSec === undefined ? undefined : mbpsLabel(process.networkBytesPerSec),
      source
    }));
  }

  private async refreshStatic(now: number): Promise<void> {
    if (!isWindows || now - this.slowCache.lastStaticRefresh < 30_000) {
      return;
    }

    this.slowCache.lastStaticRefresh = now;
    const [cpuStatic, storage, systemInfo, powerMode] = await Promise.all([
      this.adapter.getCpuStaticInfo(),
      this.adapter.getStorageInfo(),
      this.adapter.getSystemInfo(),
      this.adapter.getPowerMode()
    ]);

    this.slowCache = {
      ...this.slowCache,
      cpuName: cpuStatic.name ?? this.slowCache.cpuName,
      maxBoostGhz: cpuStatic.maxClockGhz ?? this.slowCache.maxBoostGhz,
      storageLabel: storage.label ?? this.slowCache.storageLabel,
      storageHealthPercent: storage.healthPercent ?? this.slowCache.storageHealthPercent,
      storageHealthGrade: storage.healthGrade ?? this.slowCache.storageHealthGrade,
      storageTemperatureC: storage.temperatureC ?? this.slowCache.storageTemperatureC,
      storagePowerOnHours: storage.powerOnHours ?? this.slowCache.storagePowerOnHours,
      storageTbwBytes: storage.tbwBytes ?? this.slowCache.storageTbwBytes,
      storageTbwLimitBytes: storage.tbwLimitBytes ?? this.slowCache.storageTbwLimitBytes,
      systemInfo,
      powerMode: powerMode ?? this.slowCache.powerMode
    };

    if (now - this.slowCache.lastPublicIpRefresh > 90_000) {
      this.slowCache.lastPublicIpRefresh = now;
      this.slowCache.publicIp = (await this.adapter.getPublicIp()) ?? this.slowCache.publicIp;
    }
  }

  private async refreshProcesses(now: number): Promise<void> {
    if (!isWindows || now - this.lastProcessRefresh < 2_500) {
      return;
    }

    this.lastProcessRefresh = now;
    const rows = await this.adapter.getProcesses();
    const elapsedFallback = 2.5;
    const logicalCount = Math.max(1, os.cpus().length);
    const metrics = rows.map((row) => {
      const previous = this.processSamples.get(row.pid);
      const elapsedSeconds = previous ? Math.max(0.1, (now - previous.timestamp) / 1000) : elapsedFallback;
      const cpuDelta = previous ? Math.max(0, row.cpuSeconds - previous.cpuSeconds) : 0;

      return {
        pid: row.pid,
        name: formatProcessName(row.name),
        cpuPercent: round((cpuDelta / elapsedSeconds / logicalCount) * 100, 1),
        memoryBytes: row.workingSetBytes,
        gpuPercent: 0
      };
    });

    this.processSamples = new Map(rows.map((row) => [row.pid, { cpuSeconds: row.cpuSeconds, timestamp: now }]));
    this.processRows = rows;
    this.processMetrics = metrics
      .filter((metricRow) => metricRow.memoryBytes > 0)
      .sort((a, b) => b.cpuPercent - a.cpuPercent || b.memoryBytes - a.memoryBytes)
      .slice(0, 8);
  }

  private async refreshGpu(now: number): Promise<void> {
    if (!isWindows || now - this.lastGpuRefresh < 1_000) {
      return;
    }

    this.lastGpuRefresh = now;
    this.gpuInfo = await this.adapter.getGpuInfo();
    this.slowCache.gpuName = this.gpuInfo.name ?? this.slowCache.gpuName;
  }

  private async refreshDisk(now: number): Promise<void> {
    if (!isWindows || now - this.lastDiskRefresh < 2_500) {
      return;
    }

    this.lastDiskRefresh = now;
    this.diskCounters = await this.adapter.getDiskCounters();
  }

  private async refreshNetwork(now: number): Promise<void> {
    if (!isWindows || now - this.lastNetworkRefresh < 2_500) {
      return;
    }

    this.lastNetworkRefresh = now;
    const [info, signal] = await Promise.all([this.adapter.getNetworkInfo(), this.adapter.getWifiSignalDbm()]);
    this.networkInfo = info;
    if (signal !== null) {
      this.raw.overview.network.signalDbm = metric(signal, 'live');
    }
  }

  private async refreshPing(now: number): Promise<void> {
    if (!isWindows || now - this.lastPingRefresh < 10_000) {
      return;
    }

    this.lastPingRefresh = now;
    const ping = await this.adapter.getPingInfo();
    if (ping.latencyMs !== null) {
      this.pingSamples = [...this.pingSamples.slice(-7), ping.latencyMs];
    }
    if (ping.packetLossPercent !== null) {
      this.raw.overview.network.packetLossPercent = metric(ping.packetLossPercent, 'live');
    }
  }

  private async refreshBattery(now: number): Promise<void> {
    if (!isWindows || now - this.lastBatteryRefresh < 12_000) {
      return;
    }

    this.lastBatteryRefresh = now;
    this.batteryInfo = await this.adapter.getBatteryInfo();
  }

  private async refreshFans(now: number): Promise<void> {
    if (!isWindows || now - this.lastFanRefresh < 12_000) {
      return;
    }

    this.lastFanRefresh = now;
    this.fanInfo = await this.adapter.getFanInfo();
  }

  private async refreshMemoryCache(now: number): Promise<void> {
    if (!isWindows || now - this.lastMemoryCacheRefresh < 1_000) {
      return;
    }

    this.lastMemoryCacheRefresh = now;
    this.memoryCacheBytes = (await this.adapter.getMemoryCacheBytes()) ?? this.memoryCacheBytes;
  }

  private async refreshCpuTemperature(now: number): Promise<void> {
    if (!isWindows || now - this.lastCpuTemperatureRefresh < 8_000) {
      return;
    }

    this.lastCpuTemperatureRefresh = now;
    const temperature = await this.adapter.getCpuTemperatureC();
    if (temperature !== null) {
      this.cpuTemperatureC = temperature;
      this.cpuTemperatureSource = 'live';
    }
  }

  private calculateJitter(): number {
    if (this.pingSamples.length < 2) {
      return this.raw.overview.network.jitterMs.value;
    }

    const deltas = this.pingSamples.slice(1).map((value, index) => Math.abs(value - this.pingSamples[index]));
    return average(deltas);
  }
}
