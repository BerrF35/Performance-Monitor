import os from 'node:os';
import { performance } from 'node:perf_hooks';
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

interface ProcessState {
  key: string;
  baseKey: string;
  pid: number;
  name: string;
  generation: number;
  startTimeMs: number | null;
  firstSeen: number;
  cpuAverage: NumberWindow;
  gpuAverage: NumberWindow;
  rankScore: number;
  lastSeen: number;
  metric: ProcessMetric;
}

interface ProcessIdentityState {
  generation: number;
  startTimeMs: number | null;
  lastCpuSeconds: number;
  lastSeen: number;
  active: boolean;
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
  private readonly points: TimePoint[];
  private readonly orderedPoints: TimePoint[];
  private nextIndex = 0;
  private lastTimestamp: number;

  constructor(
    private readonly length: number,
    private readonly stepMs: number,
    seed: TimePoint[]
  ) {
    const seedCount = Math.min(seed.length, length);
    const seedOffset = Math.max(0, seed.length - length);
    const seedEnd = seed[seed.length - 1]?.timestamp ?? Date.now();
    const filler = seed[seedOffset] ?? { timestamp: seedEnd, value: 0, secondary: undefined };
    const startTimestamp = seedEnd - (length - 1) * stepMs;

    this.points = Array.from({ length }, (_, index) => {
      const seedIndex = index - (length - seedCount);
      const point = seedIndex >= 0 ? seed[seedOffset + seedIndex] : filler;

      return {
        timestamp: startTimestamp + index * stepMs,
        value: point.value,
        secondary: point.secondary
      };
    });
    this.orderedPoints = [...this.points];
    this.lastTimestamp = seedEnd;
  }

  push(value: number, secondary?: number): TimePoint[] {
    const point = this.points[this.nextIndex];
    this.lastTimestamp += this.stepMs;
    point.timestamp = this.lastTimestamp;
    point.value = value;
    point.secondary = secondary;
    this.nextIndex = (this.nextIndex + 1) % this.length;
    this.reorder();

    return this.series();
  }

  series(): TimePoint[] {
    return this.orderedPoints;
  }

  private reorder(): void {
    for (let index = 0; index < this.length; index += 1) {
      this.orderedPoints[index] = this.points[(this.nextIndex + index) % this.length];
    }
  }
}

class NumberWindow {
  private readonly values: number[];
  private nextIndex = 0;
  private count = 0;
  private sum = 0;

  constructor(private readonly length: number, seed: number[] = []) {
    this.values = Array.from({ length }, () => 0);
    for (const value of seed.slice(-length)) {
      this.push(value);
    }
  }

  push(value: number): void {
    if (this.count < this.length) {
      this.values[this.nextIndex] = value;
      this.sum += value;
      this.count += 1;
    } else {
      this.sum -= this.values[this.nextIndex];
      this.values[this.nextIndex] = value;
      this.sum += value;
    }

    this.nextIndex = (this.nextIndex + 1) % this.length;
  }

  average(): number {
    return this.count ? this.sum / this.count : 0;
  }

  latest(): number | null {
    if (!this.count) {
      return null;
    }

    const latestIndex = (this.nextIndex - 1 + this.length) % this.length;
    return this.values[latestIndex];
  }

  size(): number {
    return this.count;
  }

  at(index: number): number | null {
    if (index < 0 || index >= this.count) {
      return null;
    }

    const start = this.count < this.length ? 0 : this.nextIndex;
    return this.values[(start + index) % this.length];
  }
}

const DASH = '—';
const SCHEDULER_INTERVAL_MS = 1000;
const FAST_INTERVAL_MS = 1000;
const MEDIUM_INTERVAL_MS = 2500;
const SLOW_INTERVAL_MS = 12_000;
const STATIC_INTERVAL_MS = 30_000;
const PUBLIC_IP_INTERVAL_MS = 90_000;
const PROCESS_RETENTION_MS = 10_000;
const PROCESS_IDENTITY_RETENTION_MS = 5 * 60_000;
const PROCESS_MIN_TOP_LIFETIME_MS = 5_000;
const PROCESS_RANK_DECAY = 0.65;
const GPU_UNAVAILABLE_CONFIRMATION_SAMPLES = 3;
const GPU_ZERO_CONFIRMATION_SAMPLES = 2;
const GPU_SOURCE_FAILURE_CONFIRMATION_SAMPLES = 3;
const GPU_SOURCE_VALID_CONFIRMATION_SAMPLES = 4;
const GPU_OUTLIER_CONFIRMATION_SAMPLES = 2;
const GPU_SOURCE_SWITCH_COOLDOWN_MS = 30_000;
const RUNTIME_DEBUG_STATS_INTERVAL_MS = 60_000;
const RUNTIME_DEBUG_STATS_ENABLED = process.env.PERFORMANCE_MONITOR_DEBUG === '1';
const SAMPLE_WINDOW = 4;
type GpuTelemetryProvider = GpuInfo['provider'];

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
  return { value, label: displayLabel(source, label), source, tone };
}

function displayLabel(source: MetricSource, label: string): string {
  return source === 'unavailable' ? DASH : label;
}

function movingAverage(window: NumberWindow): number {
  return round(window.average(), 1);
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
  return value === null ? DASH : `${round(value)} °C`;
}

function msLabel(value: number): string {
  return `${value.toFixed(value < 1 ? 2 : 0)} ms`;
}

function integerLabel(value: number | null): string {
  return value === null ? DASH : `${Math.round(value)}`;
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
    return DASH;
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
    return DASH;
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
    return DASH;
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
    return { label: DASH, tone: 'slate' };
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

function processBaseKey(pid: number | undefined, name: string): string {
  return `${pid ?? 'unknown'}:${name.toLowerCase()}`;
}

function processKey(pid: number | undefined, name: string, generation = 0, startTimeMs?: number | null): string {
  return `${processBaseKey(pid, name)}:${generation}:${startTimeMs ?? 'unknown'}`;
}

function processId(process: ProcessMetric | { name: string }, index: number): string {
  if ('identityKey' in process && process.identityKey) {
    return process.identityKey;
  }

  return 'pid' in process && process.pid ? processKey(process.pid, process.name) : `${process.name}-${index}`;
}

export class SnapshotService {
  private readonly adapter = new WindowsMetricsAdapter();
  private raw: RawSnapshot = createFallbackSnapshot();
  private readonly histories = this.createHistoryBuffers(this.raw.overview);
  private snapshot: PerformanceSnapshot;
  private cpuTimes = readCpuTimes();
  private processSamples = new Map<string, ProcessSample>();
  private processIdentities = new Map<string, ProcessIdentityState>();
  private processStates = new Map<string, ProcessState>();
  private stableTopProcessKeys: string[] = [];
  private processRows: ProcessRow[] = [];
  private processMetrics: ProcessMetric[] = this.raw.overview.topProcesses;
  private networkSample: NetworkSample | null = null;
  private readonly pingSamples = new NumberWindow(8);
  private batteryInfo: BatteryInfo | null = null;
  private fanInfo: FanInfo | null = null;
  private gpuInfo: GpuInfo | null = null;
  private lastValidGpuInfo: GpuInfo | null = null;
  private gpuUnavailableSamples = 0;
  private gpuZeroSamples = 0;
  private gpuOutlierSamples = 0;
  private activeGpuProvider: GpuTelemetryProvider = 'unavailable';
  private pendingGpuProvider: GpuTelemetryProvider | null = null;
  private activeGpuProviderFailureSamples = 0;
  private pendingGpuProviderSamples = 0;
  private gpuProviderCooldownUntilMs = 0;
  private gpuProcessSource: MetricSource = 'fallback';
  private networkInfo: NetworkInfo | null = null;
  private networkRateSource: MetricSource = 'fallback';
  private diskReadsSinceLaunch = this.raw.overview.footer.totalDataReadBytes.value;
  private diskWritesSinceLaunch = this.raw.overview.footer.totalDataWrittenBytes.value;
  private snapshotVersion = 0;
  private snapshotsPublished = 0;
  private lastSnapshotMonotonicMs = performance.now();
  private expectedNextTickMs = this.lastSnapshotMonotonicMs;
  private schedulerTimer: NodeJS.Timeout | null = null;
  private schedulerRunning = false;
  private schedulerStopped = false;
  private schedulerMaxStartDelayMs = 0;
  private schedulerMaxExecutionMs = 0;
  private schedulerMaxDriftMs = 0;
  private schedulerTotalMissedTicks = 0;
  private schedulerCoalescedCycles = 0;
  private schedulerLastStatsLogMs = 0;
  private runtimeStatsLastLogMs = 0;
  private runtimeStatsLastSnapshotCount = 0;
  private lastProcessRefresh = 0;
  private lastGpuRefresh = 0;
  private lastDiskRefresh = 0;
  private lastNetworkRefresh = 0;
  private lastPingRefresh = 0;
  private lastBatteryRefresh = 0;
  private lastFanRefresh = 0;
  private lastMemoryCacheRefresh = 0;
  private lastCpuTemperatureRefresh = 0;
  private lastLongHistoryRefresh = 0;
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
    this.lastSnapshotMonotonicMs = performance.now();
    this.expectedNextTickMs = this.lastSnapshotMonotonicMs;
    void this.runSchedulerCycle();
  }

  async getSnapshot(): Promise<PerformanceSnapshot> {
    return this.snapshot;
  }

  stop(): void {
    this.schedulerStopped = true;
    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.schedulerRunning = false;
  }

  private scheduleNextCycle(): void {
    if (this.schedulerStopped) {
      return;
    }

    if (this.schedulerTimer) {
      clearTimeout(this.schedulerTimer);
      this.schedulerTimer = null;
    }

    const delayMs = Math.max(0, this.expectedNextTickMs - performance.now());
    this.schedulerTimer = setTimeout(() => {
      this.schedulerTimer = null;
      void this.runSchedulerCycle();
    }, delayMs);
    this.schedulerTimer.unref?.();
  }

  private async runSchedulerCycle(): Promise<void> {
    if (this.schedulerStopped) {
      return;
    }

    if (this.schedulerRunning) {
      this.schedulerCoalescedCycles += 1;
      return;
    }

    this.schedulerRunning = true;
    const scheduledTickMs = this.expectedNextTickMs;
    const startedMonotonicMs = performance.now();
    const wallNow = Date.now();
    const startDelayMs = startedMonotonicMs - scheduledTickMs;
    const elapsedSeconds = Math.max(0.1, (startedMonotonicMs - this.lastSnapshotMonotonicMs) / 1000);

    if (startDelayMs > SCHEDULER_INTERVAL_MS * 2) {
      console.warn(`[SnapshotService] Scheduler start delayed by ${Math.round(startDelayMs)} ms`);
    }

    try {
      await Promise.all([
        this.refreshStatic(startedMonotonicMs),
        this.refreshProcesses(startedMonotonicMs),
        this.refreshGpu(startedMonotonicMs),
        this.refreshDisk(startedMonotonicMs),
        this.refreshNetwork(startedMonotonicMs),
        this.refreshPing(startedMonotonicMs),
        this.refreshBattery(startedMonotonicMs),
        this.refreshFans(startedMonotonicMs),
        this.refreshMemoryCache(startedMonotonicMs),
        this.refreshCpuTemperature(startedMonotonicMs)
      ]);

      const previous = this.raw.overview;
      const cpu = this.buildCpu(startedMonotonicMs, previous);
      let topProcesses = this.processMetrics.length ? this.processMetrics : previous.topProcesses;
      const ram = this.buildRam(previous);
      const gpu = this.buildGpu(startedMonotonicMs, previous, topProcesses);
      topProcesses = this.processMetrics.length ? this.processMetrics : topProcesses;
      const storage = this.buildStorage(elapsedSeconds, previous, topProcesses);
      const network = this.buildNetwork(startedMonotonicMs, previous, topProcesses);
      const powerBattery = this.buildPowerBattery(previous, cpu.packagePowerW, gpu.powerDrawW);
      const thermalsFans = this.buildThermalsFans(previous, cpu.temperatureC, gpu.temperatureC, storage.temperatureC);
      const systemHealth = this.buildSystemHealth(wallNow, previous, cpu.temperatureC, gpu.temperatureC, storage.healthPercent);
      const systemInformation = this.buildSystemInformation(wallNow, previous);
      const trends = this.buildTrends(startedMonotonicMs, cpu.utilizationPercent, gpu.utilizationPercent, ram.inUsePercent, storage);
      ram.trendHistory = this.histories.ramTrend.series();
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
        timestamp: wallNow,
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
      const nextVersion = this.snapshotVersion + 1;
      const nextSnapshot = this.composeSnapshot(this.raw, nextVersion);
      this.snapshotVersion = nextVersion;
      this.snapshotsPublished += 1;
      this.snapshot = nextSnapshot;
      this.lastSnapshotMonotonicMs = startedMonotonicMs;
    } catch (error) {
      console.warn(`[SnapshotService] Scheduler cycle failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      const completedMonotonicMs = performance.now();
      const executionMs = completedMonotonicMs - startedMonotonicMs;
      const driftMs = Math.max(0, completedMonotonicMs - scheduledTickMs - SCHEDULER_INTERVAL_MS);
      if (executionMs > SCHEDULER_INTERVAL_MS * 2) {
        console.warn(`[SnapshotService] Scheduler execution took ${Math.round(executionMs)} ms`);
      }

      this.recordSchedulerStats(startDelayMs, executionMs, driftMs, completedMonotonicMs);
      this.schedulerRunning = false;
      if (!this.schedulerStopped) {
        this.advanceExpectedNextTick(completedMonotonicMs);
        this.scheduleNextCycle();
      }
    }
  }

  private advanceExpectedNextTick(now: number): void {
    if (this.expectedNextTickMs <= now) {
      const missedTicks = Math.floor((now - this.expectedNextTickMs) / SCHEDULER_INTERVAL_MS) + 1;
      const skippedTicks = Math.max(0, missedTicks - 1);
      this.schedulerTotalMissedTicks += skippedTicks;
      this.schedulerCoalescedCycles += skippedTicks;
      this.expectedNextTickMs += missedTicks * SCHEDULER_INTERVAL_MS;
    }

    if (this.expectedNextTickMs - now > SCHEDULER_INTERVAL_MS) {
      this.expectedNextTickMs = now + SCHEDULER_INTERVAL_MS;
    }
  }

  private recordSchedulerStats(startDelayMs: number, executionMs: number, driftMs: number, now: number): void {
    this.schedulerMaxStartDelayMs = Math.max(this.schedulerMaxStartDelayMs, startDelayMs);
    this.schedulerMaxExecutionMs = Math.max(this.schedulerMaxExecutionMs, executionMs);
    this.schedulerMaxDriftMs = Math.max(this.schedulerMaxDriftMs, driftMs);
    this.logRuntimeDebugStats(now);

    if (this.schedulerLastStatsLogMs === 0) {
      this.schedulerLastStatsLogMs = now;
      return;
    }

    if (now - this.schedulerLastStatsLogMs >= 60_000) {
      console.info(
        `[SnapshotService] Scheduler stats: maxStartDelay=${Math.round(this.schedulerMaxStartDelayMs)}ms maxExecution=${Math.round(this.schedulerMaxExecutionMs)}ms maxDrift=${Math.round(this.schedulerMaxDriftMs)}ms missedTicks=${this.schedulerTotalMissedTicks} coalescedCycles=${this.schedulerCoalescedCycles}`
      );
      this.schedulerLastStatsLogMs = now;
    }
  }

  private logRuntimeDebugStats(now: number): void {
    if (!RUNTIME_DEBUG_STATS_ENABLED) {
      return;
    }

    if (this.runtimeStatsLastLogMs === 0) {
      this.runtimeStatsLastLogMs = now;
      this.runtimeStatsLastSnapshotCount = this.snapshotsPublished;
      return;
    }

    if (now - this.runtimeStatsLastLogMs < RUNTIME_DEBUG_STATS_INTERVAL_MS) {
      return;
    }

    const memory = process.memoryUsage();
    const elapsedMinutes = Math.max(0.001, (now - this.runtimeStatsLastLogMs) / 60_000);
    const snapshotDelta = this.snapshotsPublished - this.runtimeStatsLastSnapshotCount;
    const snapshotRatePerMinute = snapshotDelta / elapsedMinutes;
    console.info(
      `[SnapshotService] Runtime stats: heap=${round(memory.heapUsed / bytes.mb(1), 1)}MB rss=${round(memory.rss / bytes.mb(1), 1)}MB snapshotRate=${round(snapshotRatePerMinute, 1)}/min maxDelay=${Math.round(this.schedulerMaxStartDelayMs)}ms maxExecution=${Math.round(this.schedulerMaxExecutionMs)}ms coalescedCycles=${this.schedulerCoalescedCycles}`
    );
    this.runtimeStatsLastLogMs = now;
    this.runtimeStatsLastSnapshotCount = this.snapshotsPublished;
  }

  private createHistoryBuffers(overview: OverviewCards) {
    const coolingSeed = overview.thermalsFans.noiseHistory.map((point) => ({
      timestamp: point.timestamp,
      value: overview.thermalsFans.coolingEfficiencyPercent.value
    }));

    return {
      cpuUtilization: new HistoryRingBuffer(60, 1000, overview.cpu.utilizationHistory),
      gpuFrametime: new HistoryRingBuffer(60, 1000, overview.gpu.frametimeHistory),
      ramTrend: new HistoryRingBuffer(60, 60_000, overview.ram.trendHistory),
      storageActivity: new HistoryRingBuffer(60, 1000, overview.storage.activityHistory),
      network: new HistoryRingBuffer(60, 1000, overview.network.history),
      power: new HistoryRingBuffer(60, 1000, overview.powerBattery.powerHistory),
      noise: new HistoryRingBuffer(60, 1000, overview.thermalsFans.noiseHistory),
      cooling: new HistoryRingBuffer(60, 1000, coolingSeed),
      trendCpu: new HistoryRingBuffer(60, 60_000, overview.trends.lines[0]?.history ?? []),
      trendGpu: new HistoryRingBuffer(60, 60_000, overview.trends.lines[1]?.history ?? []),
      trendRam: new HistoryRingBuffer(60, 60_000, overview.trends.lines[2]?.history ?? []),
      trendDisk: new HistoryRingBuffer(60, 60_000, overview.trends.lines[3]?.history ?? [])
    };
  }

  private composeSnapshot(raw: RawSnapshot, version = this.snapshotVersion): PerformanceSnapshot {
    return {
      appName: 'Performance Monitor',
      version,
      timestamp: raw.timestamp,
      updateAgeMs: 0,
      raw,
      display: this.buildDisplay(raw)
    };
  }

  private buildCpu(_now: number, previous: OverviewCards) {
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
    const cpuTemp = this.cpuTemperatureC ?? previous.cpu.temperatureC.value;
    const hasTemperatureTelemetry = this.cpuTemperatureSource !== 'unavailable' && cpuTemp !== null;

    this.cpuTimes = currentTimes;

    return {
      ...previous.cpu,
      deviceLabel: this.slowCache.cpuName ?? previous.cpu.deviceLabel,
      utilizationPercent: totalPercent,
      currentClockGhz: currentClockGhz || previous.cpu.currentClockGhz,
      packagePowerW: metric(0, 'unavailable'),
      maxBoostGhz: this.slowCache.maxBoostGhz ?? previous.cpu.maxBoostGhz,
      temperatureC: metric(cpuTemp, this.cpuTemperatureSource, this.cpuTemperatureSource === 'fallback' ? 'ACPI thermal zone unavailable' : undefined),
      perCoreUsage,
      utilizationHistory: this.histories.cpuUtilization.push(totalPercent),
      status: hasTemperatureTelemetry ? (cpuTemp >= 92 ? 'Thermal Limit' : 'Temperature Normal') : DASH,
      loadPercent: totalPercent,
      pCoreAverageGhz: 0,
      eCoreAverageGhz: 0,
      threads: this.processRows.reduce((sum, row) => sum + row.threadCount, 0) || previous.cpu.threads,
      processes: this.processRows.length || previous.cpu.processes
    };
  }

  private buildGpu(now: number, previous: OverviewCards, topProcesses: ProcessMetric[]) {
    const fallback = previous.gpu;
    const gpuInfo = this.gpuInfo;
    const cachedGpuInfo = this.lastValidGpuInfo;
    const fieldSource = <T>(current: T | null | undefined, cached: T | null | undefined): MetricSource => {
      if (current !== null && current !== undefined && gpuInfo?.provider !== 'unavailable') {
        return 'live';
      }

      if (cached !== null && cached !== undefined) {
        return 'unavailable';
      }

      return sourceOf(fallback.utilizationPercent) === 'fallback' ? 'unavailable' : sourceOf(fallback.utilizationPercent);
    };
    const fieldValue = <T>(current: T | null | undefined, cached: T | null | undefined, fallbackValue: T): T => {
      if (current !== null && current !== undefined && gpuInfo?.provider !== 'unavailable') {
        return current;
      }

      if (cached !== null && cached !== undefined) {
        return cached;
      }

      return fallbackValue;
    };
    const utilization = fieldValue(gpuInfo?.utilizationPercent, cachedGpuInfo?.utilizationPercent, fallback.utilizationPercent.value);
    const utilizationSource = fieldSource(gpuInfo?.utilizationPercent, cachedGpuInfo?.utilizationPercent);
    const coreClock = fieldValue(gpuInfo?.coreClockGhz, cachedGpuInfo?.coreClockGhz, fallback.coreClockGhz.value);
    const memoryClock = fieldValue(gpuInfo?.memoryClockGhz, cachedGpuInfo?.memoryClockGhz, fallback.memoryClockGhz.value);
    const vramTotal = fieldValue(gpuInfo?.vramTotalBytes, cachedGpuInfo?.vramTotalBytes, fallback.vramTotalBytes.value);
    const vramUsed = fieldValue(gpuInfo?.vramUsedBytes, cachedGpuInfo?.vramUsedBytes, fallback.vramUsedBytes.value);
    const powerSource: MetricSource =
      gpuInfo?.powerDrawW !== null && gpuInfo?.powerDrawW !== undefined && gpuInfo.provider !== 'unavailable'
        ? 'live'
        : cachedGpuInfo?.powerDrawW !== null && cachedGpuInfo?.powerDrawW !== undefined
          ? 'unavailable'
          : sourceOf(fallback.powerDrawW);
    const powerDraw = fieldValue(gpuInfo?.powerDrawW, cachedGpuInfo?.powerDrawW, fallback.powerDrawW.value);
    const frametime = fallback.frametimeHistory.at(-1)?.value ?? 0;
    const gpuProcesses = this.buildGpuProcesses(now, topProcesses);
    const encoderSource: MetricSource =
      gpuInfo?.encoderUsagePercent !== null && gpuInfo?.encoderUsagePercent !== undefined && gpuInfo.provider !== 'unavailable'
        ? 'live'
        : cachedGpuInfo?.encoderUsagePercent !== null && cachedGpuInfo?.encoderUsagePercent !== undefined
          ? 'unavailable'
          : sourceOf(fallback.encoderUsagePercent);

    return {
      ...fallback,
      deviceLabel: gpuInfo?.name ?? cachedGpuInfo?.name ?? this.slowCache.gpuName ?? fallback.deviceLabel,
      utilizationPercent: metric(round(utilization), utilizationSource),
      coreClockGhz: metric(round(coreClock, 2), fieldSource(gpuInfo?.coreClockGhz, cachedGpuInfo?.coreClockGhz)),
      memoryClockGhz: metric(round(memoryClock, 2), fieldSource(gpuInfo?.memoryClockGhz, cachedGpuInfo?.memoryClockGhz)),
      powerDrawW: metric(round(powerDraw, 1), powerSource),
      temperatureC: metric(fieldValue(gpuInfo?.temperatureC, cachedGpuInfo?.temperatureC, fallback.temperatureC.value), fieldSource(gpuInfo?.temperatureC, cachedGpuInfo?.temperatureC)),
      coreUsagePercent: round(utilization),
      vramUsedBytes: metric(vramUsed, fieldSource(gpuInfo?.vramUsedBytes, cachedGpuInfo?.vramUsedBytes)),
      vramTotalBytes: metric(vramTotal, fieldSource(gpuInfo?.vramTotalBytes, cachedGpuInfo?.vramTotalBytes)),
      encoderUsagePercent: metric(fieldValue(gpuInfo?.encoderUsagePercent, cachedGpuInfo?.encoderUsagePercent, fallback.encoderUsagePercent.value), encoderSource),
      frametimeHistory: this.histories.gpuFrametime.push(frametime),
      status: utilizationSource === 'live' ? (utilization > 80 ? 'High GPU load' : 'GPU telemetry live') : DASH,
      topProcesses: gpuProcesses
    };
  }

  private buildGpuProcesses(now: number, topProcesses: ProcessMetric[]): ProcessMetric[] {
    const baseProcesses = topProcesses.slice(0, 4);
    this.gpuProcessSource = 'unavailable';

    const processes = baseProcesses.map((process, index) => {
      const key = process.identityKey ?? (process.pid ? processKey(process.pid, process.name) : processId(process, index));
      const state = this.processStates.get(key);
      const gpuPercent = 0;

      if (state) {
        const metricRow = {
          ...state.metric,
          gpuPercent,
          memoryBytes: process.memoryBytes,
          cpuPercent: process.cpuPercent
        };

        this.processStates.set(key, {
          ...state,
          lastSeen: now,
          metric: metricRow
        });
      }

      return {
        ...process,
        gpuPercent
      };
    });

    if (processes.length) {
      this.processMetrics = this.selectStableTopProcesses(now);
    }

    return processes;
  }

  private buildRam(previous: OverviewCards) {
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
      trendHistory: this.histories.ramTrend.series(),
      stabilityLabel: inUsePercent < 82 ? 'Stable' : 'Pressure'
    };
  }

  private buildStorage(elapsedSeconds: number, previous: OverviewCards, topProcesses: ProcessMetric[]) {
    const fallback = previous.storage;
    const readBytesPerSec = this.diskCounters.readBytesPerSec ?? fallback.readBytesPerSec.value;
    const writeBytesPerSec = this.diskCounters.writeBytesPerSec ?? fallback.writeBytesPerSec.value;
    const counterSource = <T>(value: T | null, fallbackMetric: MetricValue<T>): MetricSource => {
      if (this.lastDiskRefresh === 0) {
        return sourceOf(fallbackMetric);
      }

      if (value !== null) {
        return 'live';
      }

      return sourceOf(fallbackMetric) === 'fallback' ? 'fallback' : 'unavailable';
    };
    const readActivity = clamp((readBytesPerSec / bytes.gb(1.5)) * 100);
    const writeActivity = clamp((writeBytesPerSec / bytes.gb(1)) * 100);

    this.diskReadsSinceLaunch += readBytesPerSec * elapsedSeconds;
    this.diskWritesSinceLaunch += writeBytesPerSec * elapsedSeconds;

    const activeProcess = topProcesses[0] && (topProcesses[0].diskReadBytesPerSec !== undefined || topProcesses[0].diskWriteBytesPerSec !== undefined)
      ? {
          name: topProcesses[0].name,
          readBytesPerSec: topProcesses[0].diskReadBytesPerSec ?? 0,
          writeBytesPerSec: topProcesses[0].diskWriteBytesPerSec ?? 0
        }
      : null;

    return {
      ...fallback,
      deviceLabel: this.slowCache.storageLabel ?? fallback.deviceLabel,
      readBytesPerSec: metric(readBytesPerSec, counterSource(this.diskCounters.readBytesPerSec, fallback.readBytesPerSec)),
      writeBytesPerSec: metric(writeBytesPerSec, counterSource(this.diskCounters.writeBytesPerSec, fallback.writeBytesPerSec)),
      healthPercent: metric(this.slowCache.storageHealthPercent ?? fallback.healthPercent.value, this.slowCache.storageHealthPercent !== undefined ? 'live' : sourceOf(fallback.healthPercent)),
      healthGrade: this.slowCache.storageHealthGrade ?? fallback.healthGrade,
      latencyMs: metric(round(this.diskCounters.latencyMs ?? fallback.latencyMs.value, 2), counterSource(this.diskCounters.latencyMs, fallback.latencyMs)),
      queueDepth: metric(round(this.diskCounters.queueDepth ?? fallback.queueDepth.value, 1), counterSource(this.diskCounters.queueDepth, fallback.queueDepth)),
      temperatureC: metric(this.slowCache.storageTemperatureC ?? fallback.temperatureC.value, this.slowCache.storageTemperatureC !== undefined && this.slowCache.storageTemperatureC !== null ? 'live' : sourceOf(fallback.temperatureC)),
      tbwBytes: metric(this.slowCache.storageTbwBytes ?? fallback.tbwBytes.value, this.slowCache.storageTbwBytes !== undefined ? 'live' : sourceOf(fallback.tbwBytes)),
      tbwLimitBytes: metric(this.slowCache.storageTbwLimitBytes ?? fallback.tbwLimitBytes.value, this.slowCache.storageTbwLimitBytes !== undefined ? 'live' : sourceOf(fallback.tbwLimitBytes)),
      powerOnHours: metric(this.slowCache.storagePowerOnHours ?? fallback.powerOnHours.value, this.slowCache.storagePowerOnHours !== undefined ? 'live' : sourceOf(fallback.powerOnHours)),
      activityHistory: this.histories.storageActivity.push(readActivity, writeActivity),
      activeProcess
    };
  }

  private buildNetwork(now: number, previous: OverviewCards, topProcesses: ProcessMetric[]) {
    const fallback = previous.network;
    const current = this.networkInfo;
    let download = fallback.downloadBytesPerSec;
    let upload = fallback.uploadBytesPerSec;
    let rateSource: MetricSource = 'unavailable';
    const receivedBytes = current?.receivedBytes;
    const sentBytes = current?.sentBytes;
    const hasCounters = receivedBytes !== null && receivedBytes !== undefined && sentBytes !== null && sentBytes !== undefined;

    if (hasCounters && this.networkSample) {
      const elapsedSeconds = Math.max(0.1, (now - this.networkSample.timestamp) / 1000);
      const receivedDelta = receivedBytes - this.networkSample.receivedBytes;
      const sentDelta = sentBytes - this.networkSample.sentBytes;

      if (receivedDelta >= 0 && sentDelta >= 0) {
        download = receivedDelta / elapsedSeconds;
        upload = sentDelta / elapsedSeconds;
        rateSource = 'live';
      }
    }

    if (hasCounters) {
      this.networkSample = {
        receivedBytes,
        sentBytes,
        timestamp: now
      };
    }

    this.networkRateSource = rateSource;

    return {
      ...fallback,
      adapterLabel: current?.adapterLabel ?? fallback.adapterLabel,
      downloadBytesPerSec: download,
      uploadBytesPerSec: upload,
      latencyMs: metric(this.pingSamples.latest() ?? fallback.latencyMs.value, this.pingSamples.size() > 4 ? 'live' : sourceOf(fallback.latencyMs)),
      jitterMs: metric(round(this.calculateJitter(), 1), this.pingSamples.size() > 4 ? 'live' : sourceOf(fallback.jitterMs)),
      packetLossPercent: fallback.packetLossPercent,
      signalDbm: metric(previous.network.signalDbm.value, previous.network.signalDbm.source),
      signalLabel: signalLabel(previous.network.signalDbm.value),
      topUsage: this.buildNetworkUsage(topProcesses),
      history: this.histories.network.push(clamp(networkMbps(download) / 4), clamp(networkMbps(upload) / 2)),
      connections: metric(current?.connections ?? fallback.connections.value, current?.connections !== null && current?.connections !== undefined ? 'live' : sourceOf(fallback.connections)),
      dns: metric(current?.dns ?? fallback.dns.value, current?.dns ? 'live' : sourceOf(fallback.dns)),
      ipv4: metric(current?.ipv4 ?? fallback.ipv4.value, current?.ipv4 ? 'live' : sourceOf(fallback.ipv4)),
      publicIp: metric(this.slowCache.publicIp ?? fallback.publicIp.value, this.slowCache.publicIp ? 'live' : sourceOf(fallback.publicIp))
    };
  }

  private buildNetworkUsage(topProcesses: ProcessMetric[]): NetworkUsageMetric[] {
    return topProcesses
      .filter((process) => process.networkBytesPerSec !== undefined)
      .slice(0, 4)
      .map((process) => ({
        name: process.name,
        bytesPerSec: process.networkBytesPerSec ?? 0
      }));
  }

  private buildPowerBattery(previous: OverviewCards, cpuPower: MetricValue<number>, gpuPower: MetricValue<number>) {
    const fallback = previous.powerBattery;
    const battery = this.batteryInfo;
    const batterySource = <T>(value: T | null | undefined, fallbackMetric: MetricValue<T | null>): MetricSource => {
      if (this.lastBatteryRefresh === 0) {
        return sourceOf(fallbackMetric);
      }

      if (value !== null && value !== undefined) {
        return 'live';
      }

      return sourceOf(fallbackMetric) === 'fallback' ? 'fallback' : 'unavailable';
    };
    return {
      ...fallback,
      batteryLevelPercent: metric(battery?.levelPercent ?? fallback.batteryLevelPercent.value, batterySource(battery?.levelPercent, fallback.batteryLevelPercent)),
      batteryHealthPercent: metric(battery?.healthPercent ?? fallback.batteryHealthPercent.value, batterySource(battery?.healthPercent, fallback.batteryHealthPercent)),
      cycleCount: metric(battery?.cycleCount ?? fallback.cycleCount.value, batterySource(battery?.cycleCount, fallback.cycleCount)),
      fullChargeCapacityWh: metric(battery?.fullChargeCapacityWh ?? fallback.fullChargeCapacityWh.value, batterySource(battery?.fullChargeCapacityWh, fallback.fullChargeCapacityWh)),
      acConnected: metric(battery?.acConnected ?? fallback.acConnected.value, batterySource(battery?.acConnected, fallback.acConnected)),
      totalSystemPowerW: metric(fallback.totalSystemPowerW.value, sourceOf(fallback.totalSystemPowerW)),
      cpuPowerW: metric(cpuPower.value, sourceOf(cpuPower)),
      gpuPowerW: metric(gpuPower.value, sourceOf(gpuPower)),
      estimatedRemainingMinutes: metric(battery?.estimatedRemainingMinutes ?? fallback.estimatedRemainingMinutes.value, batterySource(battery?.estimatedRemainingMinutes, fallback.estimatedRemainingMinutes)),
      powerHistory: this.histories.power.push(fallback.totalSystemPowerW.value)
    };
  }

  private buildThermalsFans(
    previous: OverviewCards,
    cpuTemperature: MetricValue<number | null>,
    gpuTemperature: MetricValue<number | null>,
    ssdTemperature: MetricValue<number | null>
  ) {
    const fallback = previous.thermalsFans;
    const cpuFanRpm = this.fanInfo?.cpuFanRpm ?? fallback.cpuFanRpm.value;
    const gpuFanRpm = this.fanInfo?.gpuFanRpm ?? fallback.gpuFanRpm.value;
    const fanSource = (value: number | null | undefined, fallbackMetric: MetricValue<number | null>): MetricSource => {
      if (this.lastFanRefresh === 0) {
        return sourceOf(fallbackMetric);
      }

      if (value !== null && value !== undefined) {
        return 'live';
      }

      return sourceOf(fallbackMetric) === 'fallback' ? 'fallback' : 'unavailable';
    };
    const cpuFanSource = fanSource(this.fanInfo?.cpuFanRpm, fallback.cpuFanRpm);
    const gpuFanSource = fanSource(this.fanInfo?.gpuFanRpm, fallback.gpuFanRpm);
    const noise = fallback.noiseLevelDba.value;
    const noiseSource: MetricSource = sourceOf(fallback.noiseLevelDba);

    return {
      ...fallback,
      cpuTemperatureC: cpuTemperature,
      gpuTemperatureC: gpuTemperature,
      ssdTemperatureC: ssdTemperature,
      cpuFanRpm: metric(cpuFanRpm, cpuFanSource),
      gpuFanRpm: metric(gpuFanRpm, gpuFanSource),
      coolingEfficiencyPercent: metric(fallback.coolingEfficiencyPercent.value, sourceOf(fallback.coolingEfficiencyPercent)),
      coolingLabel: sourceOf(fallback.coolingEfficiencyPercent) === 'unavailable' ? DASH : fallback.coolingLabel,
      noiseLevelDba: metric(noise, noiseSource),
      noiseHistory: this.histories.noise.push(noise ?? fallback.noiseHistory.at(-1)?.value ?? 0)
    };
  }

  private buildSystemHealth(now: number, previous: OverviewCards, cpuTemp: MetricValue<number | null>, gpuTemp: MetricValue<number | null>, storageHealth: MetricValue<number>): SystemHealthCardModel {
    const availableTemps = [cpuTemp, gpuTemp].filter((temperature) => sourceOf(temperature) !== 'unavailable' && temperature.value !== null);
    const hasStorageHealth = sourceOf(storageHealth) !== 'unavailable';

    if (!availableTemps.length && !hasStorageHealth) {
      return {
        overallStatus: DASH,
        items: [
          { label: 'Overall Status', status: DASH, tone: 'slate' },
          { label: 'Thermal Status', status: DASH, tone: 'slate' },
          { label: 'Performance', status: DASH, tone: 'slate' },
          { label: 'Component Health', status: DASH, tone: 'slate' }
        ],
        recentAlerts: []
      };
    }

    const maxTemp = availableTemps.length ? Math.max(...availableTemps.map((temperature) => temperature.value ?? 0)) : 0;
    const thermalGood = !availableTemps.length || maxTemp < 86;
    const componentGood = !hasStorageHealth || storageHealth.value >= 80;
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

  private buildTrends(now: number, cpu: number, gpu: MetricValue<number>, ram: number, storage: OverviewCards['storage']) {
    const diskValue = clamp(((storage.readBytesPerSec.value + storage.writeBytesPerSec.value) / bytes.gb(1.5)) * 100);
    const shouldPush = this.lastLongHistoryRefresh === 0 || now - this.lastLongHistoryRefresh >= 60_000;
    const gpuAvailable = sourceOf(gpu) !== 'unavailable';
    const diskAvailable = sourceOf(storage.readBytesPerSec) !== 'unavailable' || sourceOf(storage.writeBytesPerSec) !== 'unavailable';

    if (shouldPush) {
      this.lastLongHistoryRefresh = now;
      this.histories.ramTrend.push(ram);
      this.histories.trendCpu.push(cpu);
      this.histories.trendGpu.push(gpuAvailable ? gpu.value : this.histories.trendGpu.series().at(-1)?.value ?? 0);
      this.histories.trendRam.push(ram);
      this.histories.trendDisk.push(diskAvailable ? diskValue : this.histories.trendDisk.series().at(-1)?.value ?? 0);
    }

    return {
      lines: [
        { label: 'CPU', valueLabel: percentLabel(cpu), tone: 'blue' as const, history: this.histories.trendCpu.series() },
        { label: 'GPU', valueLabel: gpuAvailable ? percentLabel(gpu.value) : DASH, tone: 'green' as const, history: this.histories.trendGpu.series() },
        { label: 'RAM', valueLabel: percentLabel(ram), tone: 'purple' as const, history: this.histories.trendRam.series() },
        { label: 'Disk', valueLabel: diskAvailable ? percentLabel(diskValue) : DASH, tone: 'blue' as const, history: this.histories.trendDisk.series() }
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
    const diskCounterSource: MetricSource = sourceOf(storage.readBytesPerSec) === 'live' || sourceOf(storage.writeBytesPerSec) === 'live' ? 'estimated' : 'unavailable';

    return {
      systemHealthy: health.overallStatus !== DASH && health.overallStatus !== 'Attention',
      statusLine: health.overallStatus === DASH ? DASH : health.overallStatus === 'Attention' ? 'Review active alerts' : 'All systems normal',
      uptimeSeconds: os.uptime(),
      totalDataReadBytes: metric(this.diskReadsSinceLaunch, diskCounterSource, 'Integrated from disk throughput counters during this app session'),
      totalDataWrittenBytes: metric(this.diskWritesSinceLaunch, diskCounterSource, 'Integrated from disk throughput counters during this app session'),
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
      topProcesses: this.displayProcesses(overview.topProcesses, this.processRows.length ? 'live' : 'unavailable'),
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
    const cpuSource: MetricSource = cpu.perCoreUsage.length ? 'live' : 'unavailable';
    const statusSource: MetricSource = cpu.status === DASH ? 'unavailable' : 'estimated';

    return {
      deviceLabel: cpu.deviceLabel,
      utilization: displayMetric(cpu.utilizationPercent, percentLabel(cpu.utilizationPercent), cpuSource, 'blue'),
      currentClock: displayMetric(cpu.currentClockGhz, ghzLabel(cpu.currentClockGhz), cpu.currentClockGhz > 0 ? 'live' : 'unavailable'),
      packagePower: displayMetric(cpu.packagePowerW.value, wattsLabel(cpu.packagePowerW.value), sourceOf(cpu.packagePowerW)),
      maxBoost: displayMetric(cpu.maxBoostGhz, ghzLabel(cpu.maxBoostGhz), this.slowCache.maxBoostGhz ? 'live' : 'unavailable'),
      temperature: displayMetric(cpu.temperatureC.value, celsiusLabel(cpu.temperatureC.value), sourceOf(cpu.temperatureC)),
      pCoreUsageAveragePercent: displayMetric(pUsage, percentLabel(pUsage), pCores.length ? 'live' : 'unavailable', 'blue'),
      eCoreUsageAveragePercent: displayMetric(eUsage, percentLabel(eUsage), eCores.length ? 'live' : 'unavailable', 'cyan'),
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
      status: displayMetric(cpu.status, cpu.status, statusSource, statusSource === 'unavailable' ? 'slate' : cpu.status === 'Thermal Limit' ? 'orange' : 'green'),
      load: displayMetric(cpu.loadPercent, percentLabel(cpu.loadPercent), cpuSource),
      pCoreAverage: displayMetric(cpu.pCoreAverageGhz, ghzLabel(cpu.pCoreAverageGhz), 'unavailable'),
      eCoreAverage: displayMetric(cpu.eCoreAverageGhz, ghzLabel(cpu.eCoreAverageGhz), 'unavailable'),
      threads: displayMetric(cpu.threads, `${cpu.threads}`, this.processRows.length ? 'live' : 'unavailable'),
      processes: displayMetric(cpu.processes, `${cpu.processes}`, this.processRows.length ? 'live' : 'unavailable')
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
      status: displayMetric(gpu.status, gpu.status, gpu.status === DASH ? 'unavailable' : 'live', gpu.status.includes('High') ? 'orange' : gpu.status === DASH ? 'slate' : 'yellow'),
      topProcesses: this.displayProcesses(gpu.topProcesses, this.gpuProcessSource)
    };
  }

  private displayRam(overview: OverviewCards) {
    const ram = overview.ram;
    const ramSource: MetricSource = ram.totalBytes > 0 ? 'live' : 'unavailable';
    const cachedPercent = round(safePercent(ram.cachedBytes.value, ram.totalBytes));
    const freePercent = round(safePercent(ram.freeBytes, ram.totalBytes));

    return {
      inUse: displayMetric(ram.inUsePercent, percentLabel(ram.inUsePercent), ramSource, 'purple'),
      usedTotalLabel: ramSource === 'live' ? `${gbLabel(ram.usedBytes)} / ${gbLabel(ram.totalBytes)}` : DASH,
      used: displayMetric(ram.usedBytes, gbLabel(ram.usedBytes), ramSource, 'purple'),
      cached: displayMetric(ram.cachedBytes.value, gbLabel(ram.cachedBytes.value), sourceOf(ram.cachedBytes), 'blue'),
      cachedPercent: displayMetric(cachedPercent, percentLabel(cachedPercent), sourceOf(ram.cachedBytes), 'blue'),
      free: displayMetric(ram.freeBytes, gbLabel(ram.freeBytes), ramSource, 'slate'),
      freePercent: displayMetric(freePercent, percentLabel(freePercent), ramSource, 'slate'),
      topProcesses: ram.topProcesses.map((process, index) => {
        const source: MetricSource = this.processRows.length ? 'live' : 'unavailable';

        return {
          id: `${process.name}-${index}`,
          name: process.name,
          memoryLabel: displayLabel(source, gbLabel(process.memoryBytes)),
          source
        };
      }),
      trendHistory: ram.trendHistory,
      stability: displayMetric(ram.stabilityLabel, ram.stabilityLabel, ram.stabilityLabel === DASH ? 'unavailable' : 'estimated', ram.stabilityLabel === 'Stable' ? 'green' : 'orange')
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
    const signalStrength = network.signalDbm.value === null ? DASH : `${network.signalDbm.value} dBm`;

    return {
      adapterLabel: network.adapterLabel,
      downloadRate: displayMetric(networkMbps(network.downloadBytesPerSec), mbpsLabel(network.downloadBytesPerSec), this.networkRateSource, 'blue'),
      uploadRate: displayMetric(networkMbps(network.uploadBytesPerSec), mbpsLabel(network.uploadBytesPerSec), this.networkRateSource, 'green'),
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
      source: this.networkRateSource === 'live' && this.processRows.length ? 'estimated' : this.networkRateSource
    }));
  }

  private displayPowerBattery(overview: OverviewCards) {
    const power = overview.powerBattery;

    return {
      batteryLevel: displayMetric(power.batteryLevelPercent.value, power.batteryLevelPercent.value === null ? DASH : percentLabel(power.batteryLevelPercent.value), sourceOf(power.batteryLevelPercent), 'green'),
      batteryHealth: displayMetric(power.batteryHealthPercent.value, power.batteryHealthPercent.value === null ? DASH : percentLabel(power.batteryHealthPercent.value), sourceOf(power.batteryHealthPercent), 'green'),
      cycleCount: displayMetric(power.cycleCount.value, integerLabel(power.cycleCount.value), sourceOf(power.cycleCount)),
      fullChargeCapacity: displayMetric(power.fullChargeCapacityWh.value, power.fullChargeCapacityWh.value === null ? DASH : `${round(power.fullChargeCapacityWh.value)} Wh`, sourceOf(power.fullChargeCapacityWh)),
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
      cpuFan: displayMetric(thermals.cpuFanRpm.value, thermals.cpuFanRpm.value === null ? DASH : `${Math.round(thermals.cpuFanRpm.value)} RPM`, sourceOf(thermals.cpuFanRpm), 'blue'),
      gpuFan: displayMetric(thermals.gpuFanRpm.value, thermals.gpuFanRpm.value === null ? DASH : `${Math.round(thermals.gpuFanRpm.value)} RPM`, sourceOf(thermals.gpuFanRpm), 'blue'),
      coolingEfficiency: displayMetric(thermals.coolingEfficiencyPercent.value, percentLabel(thermals.coolingEfficiencyPercent.value), sourceOf(thermals.coolingEfficiencyPercent), 'green'),
      coolingLabel: displayMetric(thermals.coolingLabel, thermals.coolingLabel, sourceOf(thermals.coolingEfficiencyPercent), thermals.coolingLabel === 'Good' ? 'green' : 'orange'),
      coolingHistory,
      noiseLevel: displayMetric(thermals.noiseLevelDba.value, thermals.noiseLevelDba.value === null ? DASH : `${thermals.noiseLevelDba.value} dB(A)`, sourceOf(thermals.noiseLevelDba), 'green'),
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
    const source: MetricSource = health.overallStatus === DASH ? 'unavailable' : 'estimated';

    return {
      overallStatus: displayMetric(health.overallStatus, health.overallStatus, source, health.overallStatus === 'Attention' ? 'yellow' : source === 'unavailable' ? 'slate' : 'green'),
      items: health.items,
      recentAlerts: health.recentAlerts.map((alert): DisplayAlertItem => ({
        ...alert,
        timeLabel: dateTimeLabel(new Date(alert.timestamp).toISOString())
      }))
    };
  }

  private displayTrends(overview: OverviewCards) {
    return {
      lines: overview.trends.lines.map((line) => {
        const parsedValue = Number.parseFloat(line.valueLabel);
        const source: MetricSource = Number.isFinite(parsedValue) ? 'estimated' : 'unavailable';

        return {
          label: line.label,
          value: displayMetric(Number.isFinite(parsedValue) ? parsedValue : 0, line.valueLabel, source, line.tone),
          tone: line.tone,
          history: line.history
        };
      })
    };
  }

  private displaySystemInformation(overview: OverviewCards) {
    const info = overview.systemInformation;

    return {
      deviceName: displayMetric(info.deviceName, info.deviceName, info.deviceName === DASH ? 'unavailable' : 'live'),
      operatingSystem: displayMetric(info.operatingSystem, info.operatingSystem, info.operatingSystem === DASH ? 'unavailable' : this.slowCache.systemInfo?.operatingSystem ? 'live' : 'fallback'),
      motherboard: displayMetric(info.motherboard.value, info.motherboard.value, sourceOf(info.motherboard)),
      biosVersion: displayMetric(info.biosVersion.value, info.biosVersion.value, sourceOf(info.biosVersion)),
      uptime: displayMetric(info.uptimeSeconds, durationLabel(info.uptimeSeconds), info.uptimeSeconds > 0 ? 'live' : 'unavailable'),
      lastBoot: displayMetric(info.lastBootIso, dateTimeLabel(info.lastBootIso), info.uptimeSeconds > 0 ? 'live' : 'unavailable'),
      driversStatus: displayMetric(info.driversStatus.value, info.driversStatus.value, sourceOf(info.driversStatus), info.driversStatus.value.includes('problem') ? 'yellow' : 'green')
    };
  }

  private displayFooter(overview: OverviewCards): DisplayFooterSummaryModel {
    const footer = overview.footer;
    const activityDotTotal = 8;
    const activityDotCount = Math.max(0, Math.min(activityDotTotal, Math.ceil((footer.activityPercent / 100) * activityDotTotal)));

    return {
      systemHealthy: footer.systemHealthy,
      healthLabel: footer.statusLine === DASH ? DASH : footer.systemHealthy ? 'System Healthy' : 'Attention Required',
      statusLine: footer.statusLine,
      uptime: displayMetric(footer.uptimeSeconds, durationLabel(footer.uptimeSeconds), footer.uptimeSeconds > 0 ? 'live' : 'unavailable'),
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
      cpuLabel: displayLabel(source, percentLabel(process.cpuPercent)),
      ramLabel: displayLabel(source, gbLabel(process.memoryBytes)),
      gpuPercent: process.gpuPercent,
      gpuLabel: process.gpuPercent > 0 && source !== 'unavailable' ? percentLabel(process.gpuPercent) : DASH,
      diskReadLabel: process.diskReadBytesPerSec === undefined ? undefined : storageRateLabel(process.diskReadBytesPerSec),
      diskWriteLabel: process.diskWriteBytesPerSec === undefined ? undefined : storageRateLabel(process.diskWriteBytesPerSec),
      networkRateLabel: process.networkBytesPerSec === undefined ? undefined : mbpsLabel(process.networkBytesPerSec),
      source
    }));
  }

  private async refreshStatic(now: number): Promise<void> {
    if (!isWindows || (this.slowCache.lastStaticRefresh !== 0 && now - this.slowCache.lastStaticRefresh < STATIC_INTERVAL_MS)) {
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

    if (this.slowCache.lastPublicIpRefresh === 0 || now - this.slowCache.lastPublicIpRefresh > PUBLIC_IP_INTERVAL_MS) {
      this.slowCache.lastPublicIpRefresh = now;
      this.slowCache.publicIp = (await this.adapter.getPublicIp()) ?? this.slowCache.publicIp;
    }
  }

  private async refreshProcesses(now: number): Promise<void> {
    if (!isWindows || (this.lastProcessRefresh !== 0 && now - this.lastProcessRefresh < MEDIUM_INTERVAL_MS)) {
      return;
    }

    this.lastProcessRefresh = now;
    const rows = await this.adapter.getProcesses();
    if (!rows.length) {
      return;
    }

    const logicalCount = Math.max(1, os.cpus().length);
    const seenKeys = new Set<string>();
    const seenBaseKeys = new Set<string>();

    for (const row of rows) {
      const name = formatProcessName(row.name);
      const identity = this.resolveProcessIdentity(row, name, now);
      const key = identity.key;
      const previous = this.processSamples.get(key);
      const elapsedSeconds = previous ? Math.max(0.1, (now - previous.timestamp) / 1000) : MEDIUM_INTERVAL_MS / 1000;
      const cpuDelta = previous ? Math.max(0, row.cpuSeconds - previous.cpuSeconds) : 0;
      const existing = this.processStates.get(key);
      const instantCpu = round((cpuDelta / elapsedSeconds / logicalCount) * 100, 1);
      const cpuAverage = existing?.cpuAverage ?? new NumberWindow(SAMPLE_WINDOW);
      const gpuAverage = existing?.gpuAverage ?? new NumberWindow(SAMPLE_WINDOW);
      const firstSeen = existing?.firstSeen ?? now;
      cpuAverage.push(instantCpu);
      const metricRow: ProcessMetric = {
        pid: row.pid,
        identityKey: key,
        generation: identity.generation,
        startTimeMs: identity.startTimeMs,
        name,
        cpuPercent: movingAverage(cpuAverage),
        memoryBytes: row.workingSetBytes,
        gpuPercent: movingAverage(gpuAverage)
      };

      seenKeys.add(key);
      seenBaseKeys.add(identity.baseKey);
      this.processStates.set(key, {
        key,
        baseKey: identity.baseKey,
        pid: row.pid,
        name,
        generation: identity.generation,
        startTimeMs: identity.startTimeMs,
        firstSeen,
        cpuAverage,
        gpuAverage,
        rankScore: existing?.rankScore ?? 0,
        lastSeen: now,
        metric: metricRow
      });
    }

    for (const [key, state] of this.processStates) {
      if (!seenKeys.has(key)) {
        this.processStates.delete(key);
      }
    }

    for (const [baseKey, identity] of this.processIdentities) {
      if (seenBaseKeys.has(baseKey)) {
        continue;
      }

      identity.active = false;
      if (now - identity.lastSeen > PROCESS_IDENTITY_RETENTION_MS) {
        this.processIdentities.delete(baseKey);
      }
    }

    for (const key of this.processSamples.keys()) {
      if (!seenKeys.has(key)) {
        this.processSamples.delete(key);
      }
    }

    for (const row of rows) {
      const name = formatProcessName(row.name);
      const identity = this.processIdentities.get(processBaseKey(row.pid, name));
      const key = processKey(row.pid, name, identity?.generation ?? 0, identity?.startTimeMs ?? row.startTimeMs);
      this.processSamples.set(key, { cpuSeconds: row.cpuSeconds, timestamp: now });
    }

    this.stableTopProcessKeys = this.stableTopProcessKeys.filter((key) => this.processStates.has(key));
    this.processRows = rows;
    this.processMetrics = this.selectStableTopProcesses(now);
  }

  private resolveProcessIdentity(row: ProcessRow, name: string, now: number): { baseKey: string; key: string; generation: number; startTimeMs: number | null } {
    const baseKey = processBaseKey(row.pid, name);
    const identity = this.processIdentities.get(baseKey);
    let generation = identity?.generation ?? 0;
    const startTimeChanged = identity?.startTimeMs !== null && row.startTimeMs !== null && identity?.startTimeMs !== row.startTimeMs;
    const cpuCounterReset = identity !== undefined && row.cpuSeconds + 0.001 < identity.lastCpuSeconds;
    const processReappeared = identity !== undefined && !identity.active;

    if (startTimeChanged || cpuCounterReset || processReappeared) {
      generation += 1;
    }

    const startTimeMs = row.startTimeMs ?? (processReappeared || cpuCounterReset ? null : identity?.startTimeMs ?? null);
    this.processIdentities.set(baseKey, {
      generation,
      startTimeMs,
      lastCpuSeconds: row.cpuSeconds,
      lastSeen: now,
      active: true
    });

    return {
      baseKey,
      key: processKey(row.pid, name, generation, startTimeMs),
      generation,
      startTimeMs
    };
  }

  private selectStableTopProcesses(now: number): ProcessMetric[] {
    const existingStableKeys = new Set(this.stableTopProcessKeys);
    const candidates: Array<{ state: ProcessState; score: number }> = [];

    for (const state of this.processStates.values()) {
      if (now - state.lastSeen > PROCESS_RETENTION_MS) {
        continue;
      }

      const instantScore = state.metric.cpuPercent * 2 + state.metric.gpuPercent * 1.5 + state.metric.memoryBytes / bytes.gb(1);
      const smoothedScore = state.rankScore === 0 ? instantScore : state.rankScore * PROCESS_RANK_DECAY + instantScore * (1 - PROCESS_RANK_DECAY);
      const ageMs = now - state.firstSeen;
      const ageMultiplier = ageMs >= PROCESS_MIN_TOP_LIFETIME_MS || existingStableKeys.has(state.key) ? 1 : Math.max(0.25, ageMs / PROCESS_MIN_TOP_LIFETIME_MS);
      state.rankScore = smoothedScore;
      candidates.push({
        state,
        score: smoothedScore * ageMultiplier
      });
    }

    candidates.sort((a, b) => b.score - a.score || b.state.metric.memoryBytes - a.state.metric.memoryBytes);

    const candidateByKey = new Map(candidates.map((candidate) => [candidate.state.key, candidate]));
    const replacementThreshold = candidates[Math.min(7, candidates.length - 1)]?.score ?? 0;
    const stableKeys = this.stableTopProcessKeys.filter((key) => {
      const candidate = candidateByKey.get(key);
      return Boolean(candidate && (candidates.length < 8 || candidate.score >= replacementThreshold * 0.7));
    });

    for (const candidate of candidates) {
      if (!stableKeys.includes(candidate.state.key)) {
        stableKeys.push(candidate.state.key);
      }
      if (stableKeys.length >= 8) {
        break;
      }
    }

    this.stableTopProcessKeys = stableKeys.slice(0, 8);

    return this.stableTopProcessKeys
      .map((key) => this.processStates.get(key)?.metric)
      .filter((metricRow): metricRow is ProcessMetric => Boolean(metricRow));
  }

  private hasGpuTelemetry(gpuInfo: GpuInfo): boolean {
    return Boolean(
      gpuInfo.name ||
        gpuInfo.utilizationPercent !== null ||
        gpuInfo.coreClockGhz !== null ||
        gpuInfo.memoryClockGhz !== null ||
        gpuInfo.powerDrawW !== null ||
        gpuInfo.temperatureC !== null ||
        gpuInfo.vramUsedBytes !== null ||
        gpuInfo.vramTotalBytes !== null
    );
  }

  private acceptGpuProvider(provider: GpuTelemetryProvider, now: number): boolean {
    if (provider === 'unavailable') {
      return false;
    }

    if (this.activeGpuProvider === 'unavailable') {
      if (now < this.gpuProviderCooldownUntilMs) {
        return false;
      }

      return this.acceptPendingGpuProvider(provider, now);
    }

    if (provider === this.activeGpuProvider) {
      this.pendingGpuProvider = null;
      this.pendingGpuProviderSamples = 0;
      this.activeGpuProviderFailureSamples = 0;
      return true;
    }

    if (now < this.gpuProviderCooldownUntilMs) {
      return false;
    }

    this.activeGpuProviderFailureSamples += 1;
    if (this.activeGpuProviderFailureSamples < GPU_SOURCE_FAILURE_CONFIRMATION_SAMPLES) {
      return false;
    }

    return this.acceptPendingGpuProvider(provider, now);
  }

  private acceptPendingGpuProvider(provider: GpuTelemetryProvider, now: number): boolean {
    if (this.pendingGpuProvider !== provider) {
      this.pendingGpuProvider = provider;
      this.pendingGpuProviderSamples = 1;
      return false;
    }

    this.pendingGpuProviderSamples += 1;
    if (this.pendingGpuProviderSamples < GPU_SOURCE_VALID_CONFIRMATION_SAMPLES) {
      return false;
    }

    if (this.activeGpuProvider !== provider) {
      this.gpuProviderCooldownUntilMs = now + GPU_SOURCE_SWITCH_COOLDOWN_MS;
    }

    this.activeGpuProvider = provider;
    this.pendingGpuProvider = null;
    this.pendingGpuProviderSamples = 0;
    this.activeGpuProviderFailureSamples = 0;
    return true;
  }

  private isGpuOutlier(gpuInfo: GpuInfo): boolean {
    const cached = this.lastValidGpuInfo;
    if (!cached) {
      return false;
    }

    if (gpuInfo.vramUsedBytes !== null && gpuInfo.vramTotalBytes !== null && gpuInfo.vramUsedBytes > gpuInfo.vramTotalBytes * 1.05) {
      return true;
    }

    if (gpuInfo.utilizationPercent !== null && cached.utilizationPercent !== null && Math.abs(gpuInfo.utilizationPercent - cached.utilizationPercent) > 75) {
      return true;
    }

    if (gpuInfo.temperatureC !== null && cached.temperatureC !== null && Math.abs(gpuInfo.temperatureC - cached.temperatureC) > 35) {
      return true;
    }

    if (gpuInfo.powerDrawW !== null && cached.powerDrawW !== null && Math.abs(gpuInfo.powerDrawW - cached.powerDrawW) > 140) {
      return true;
    }

    return false;
  }

  private mergeGpuCache(gpuInfo: GpuInfo): GpuInfo {
    const cached = this.lastValidGpuInfo;

    return {
      provider: gpuInfo.provider,
      name: gpuInfo.name ?? cached?.name ?? null,
      utilizationPercent: gpuInfo.utilizationPercent ?? cached?.utilizationPercent ?? null,
      coreClockGhz: gpuInfo.coreClockGhz ?? cached?.coreClockGhz ?? null,
      memoryClockGhz: gpuInfo.memoryClockGhz ?? cached?.memoryClockGhz ?? null,
      powerDrawW: gpuInfo.powerDrawW ?? cached?.powerDrawW ?? null,
      temperatureC: gpuInfo.temperatureC ?? cached?.temperatureC ?? null,
      vramUsedBytes: gpuInfo.vramUsedBytes ?? cached?.vramUsedBytes ?? null,
      vramTotalBytes: gpuInfo.vramTotalBytes ?? cached?.vramTotalBytes ?? null,
      encoderUsagePercent: gpuInfo.encoderUsagePercent ?? cached?.encoderUsagePercent ?? null
    };
  }

  private unavailableGpuInfo(gpuInfo: GpuInfo): GpuInfo {
    const cached = this.lastValidGpuInfo;

    return {
      provider: 'unavailable',
      name: cached?.name ?? gpuInfo.name,
      utilizationPercent: cached?.utilizationPercent ?? gpuInfo.utilizationPercent,
      coreClockGhz: cached?.coreClockGhz ?? gpuInfo.coreClockGhz,
      memoryClockGhz: cached?.memoryClockGhz ?? gpuInfo.memoryClockGhz,
      powerDrawW: cached?.powerDrawW ?? gpuInfo.powerDrawW,
      temperatureC: cached?.temperatureC ?? gpuInfo.temperatureC,
      vramUsedBytes: cached?.vramUsedBytes ?? gpuInfo.vramUsedBytes,
      vramTotalBytes: cached?.vramTotalBytes ?? gpuInfo.vramTotalBytes,
      encoderUsagePercent: cached?.encoderUsagePercent ?? gpuInfo.encoderUsagePercent
    };
  }

  private async refreshGpu(now: number): Promise<void> {
    if (!isWindows || (this.lastGpuRefresh !== 0 && now - this.lastGpuRefresh < FAST_INTERVAL_MS)) {
      return;
    }

    this.lastGpuRefresh = now;
    const gpuInfo = await this.adapter.getGpuInfo();

    if (!this.hasGpuTelemetry(gpuInfo)) {
      this.gpuUnavailableSamples += 1;
      if (this.gpuUnavailableSamples >= GPU_UNAVAILABLE_CONFIRMATION_SAMPLES) {
        if (this.activeGpuProvider !== 'unavailable') {
          this.gpuProviderCooldownUntilMs = now + GPU_SOURCE_SWITCH_COOLDOWN_MS;
        }
        this.activeGpuProvider = 'unavailable';
        this.pendingGpuProvider = null;
        this.pendingGpuProviderSamples = 0;
        this.activeGpuProviderFailureSamples = 0;
      }
      this.gpuInfo = this.gpuUnavailableSamples >= GPU_UNAVAILABLE_CONFIRMATION_SAMPLES || this.lastValidGpuInfo ? this.unavailableGpuInfo(gpuInfo) : gpuInfo;
      return;
    }

    this.gpuUnavailableSamples = 0;
    if (!this.acceptGpuProvider(gpuInfo.provider, now)) {
      this.gpuInfo = this.unavailableGpuInfo(gpuInfo);
      return;
    }

    if (this.isGpuOutlier(gpuInfo)) {
      this.gpuOutlierSamples += 1;
      if (this.gpuOutlierSamples < GPU_OUTLIER_CONFIRMATION_SAMPLES) {
        this.gpuInfo = this.unavailableGpuInfo(gpuInfo);
        return;
      }
    } else {
      this.gpuOutlierSamples = 0;
    }

    const mergedGpuInfo = this.mergeGpuCache(gpuInfo);
    const previousUtilization = this.lastValidGpuInfo?.utilizationPercent;

    if (mergedGpuInfo.utilizationPercent === 0 && previousUtilization !== null && previousUtilization !== undefined && previousUtilization > 10) {
      this.gpuZeroSamples += 1;
      if (this.gpuZeroSamples < GPU_ZERO_CONFIRMATION_SAMPLES) {
        mergedGpuInfo.utilizationPercent = previousUtilization;
      }
    } else {
      this.gpuZeroSamples = 0;
    }

    this.gpuInfo = mergedGpuInfo;
    this.lastValidGpuInfo = mergedGpuInfo;
    this.slowCache.gpuName = mergedGpuInfo.name ?? this.slowCache.gpuName;
  }

  private async refreshDisk(now: number): Promise<void> {
    if (!isWindows || (this.lastDiskRefresh !== 0 && now - this.lastDiskRefresh < MEDIUM_INTERVAL_MS)) {
      return;
    }

    this.lastDiskRefresh = now;
    this.diskCounters = await this.adapter.getDiskCounters();
  }

  private async refreshNetwork(now: number): Promise<void> {
    if (!isWindows || (this.lastNetworkRefresh !== 0 && now - this.lastNetworkRefresh < MEDIUM_INTERVAL_MS)) {
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
    if (!isWindows || (this.lastPingRefresh !== 0 && now - this.lastPingRefresh < SLOW_INTERVAL_MS)) {
      return;
    }

    this.lastPingRefresh = now;
    const ping = await this.adapter.getPingInfo();
    if (ping.latencyMs !== null) {
      this.pingSamples.push(ping.latencyMs);
    }
    if (ping.packetLossPercent !== null) {
      this.raw.overview.network.packetLossPercent = metric(ping.packetLossPercent, 'live');
    }
  }

  private async refreshBattery(now: number): Promise<void> {
    if (!isWindows || (this.lastBatteryRefresh !== 0 && now - this.lastBatteryRefresh < SLOW_INTERVAL_MS)) {
      return;
    }

    this.lastBatteryRefresh = now;
    this.batteryInfo = await this.adapter.getBatteryInfo();
  }

  private async refreshFans(now: number): Promise<void> {
    if (!isWindows || (this.lastFanRefresh !== 0 && now - this.lastFanRefresh < SLOW_INTERVAL_MS)) {
      return;
    }

    this.lastFanRefresh = now;
    this.fanInfo = await this.adapter.getFanInfo();
  }

  private async refreshMemoryCache(now: number): Promise<void> {
    if (!isWindows || (this.lastMemoryCacheRefresh !== 0 && now - this.lastMemoryCacheRefresh < FAST_INTERVAL_MS)) {
      return;
    }

    this.lastMemoryCacheRefresh = now;
    this.memoryCacheBytes = (await this.adapter.getMemoryCacheBytes()) ?? this.memoryCacheBytes;
  }

  private async refreshCpuTemperature(now: number): Promise<void> {
    if (!isWindows || (this.lastCpuTemperatureRefresh !== 0 && now - this.lastCpuTemperatureRefresh < SLOW_INTERVAL_MS)) {
      return;
    }

    this.lastCpuTemperatureRefresh = now;
    const temperature = await this.adapter.getCpuTemperatureC();
    if (temperature !== null) {
      this.cpuTemperatureC = temperature;
      this.cpuTemperatureSource = 'live';
    } else if (this.cpuTemperatureSource === 'live') {
      this.cpuTemperatureSource = 'unavailable';
    }
  }

  private calculateJitter(): number {
    if (this.pingSamples.size() < 2) {
      return this.raw.overview.network.jitterMs.value;
    }

    let totalDelta = 0;
    for (let index = 1; index < this.pingSamples.size(); index += 1) {
      const previous = this.pingSamples.at(index - 1);
      const current = this.pingSamples.at(index);
      if (previous !== null && current !== null) {
        totalDelta += Math.abs(current - previous);
      }
    }

    return totalDelta / (this.pingSamples.size() - 1);
  }
}
