export type MetricSource = 'live' | 'adapter' | 'estimated' | 'fallback' | 'unavailable';

export type Tone = 'green' | 'blue' | 'purple' | 'orange' | 'cyan' | 'lime' | 'yellow' | 'red' | 'slate';

export interface MetricValue<T> {
  value: T;
  source: MetricSource;
  label?: string;
}

export interface DisplayMetric<T = number | string | boolean | null> {
  value: T;
  label: string;
  source: MetricSource;
  tone?: Tone;
}

export interface TimePoint {
  timestamp: number;
  value: number;
  secondary?: number;
}

export interface StatusChip {
  id: string;
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export interface CoreUsage {
  id: string;
  label: string;
  type: 'P-Core' | 'E-Core';
  usage: number;
}

export interface ProcessMetric {
  pid?: number;
  identityKey?: string;
  generation?: number;
  startTimeMs?: number | null;
  name: string;
  iconHint?: string;
  cpuPercent: number;
  memoryBytes: number;
  gpuPercent: number;
  diskReadBytesPerSec?: number;
  diskWriteBytesPerSec?: number;
  networkBytesPerSec?: number;
}

export interface CpuCardModel {
  deviceLabel: string;
  utilizationPercent: number;
  currentClockGhz: number;
  packagePowerW: MetricValue<number>;
  maxBoostGhz: number;
  temperatureC: MetricValue<number | null>;
  perCoreUsage: CoreUsage[];
  utilizationHistory: TimePoint[];
  status: string;
  loadPercent: number;
  pCoreAverageGhz: number;
  eCoreAverageGhz: number;
  threads: number;
  processes: number;
}

export interface GpuCardModel {
  deviceLabel: string;
  utilizationPercent: MetricValue<number>;
  coreClockGhz: MetricValue<number>;
  memoryClockGhz: MetricValue<number>;
  powerDrawW: MetricValue<number>;
  temperatureC: MetricValue<number | null>;
  coreUsagePercent: number;
  vramUsedBytes: MetricValue<number>;
  vramTotalBytes: MetricValue<number>;
  encoderUsagePercent: MetricValue<number>;
  frametimeHistory: TimePoint[];
  status: string;
  topProcesses: ProcessMetric[];
}

export interface MemoryProcessMetric {
  name: string;
  memoryBytes: number;
  iconHint?: string;
}

export interface RamCardModel {
  inUsePercent: number;
  usedBytes: number;
  totalBytes: number;
  cachedBytes: MetricValue<number>;
  freeBytes: number;
  topProcesses: MemoryProcessMetric[];
  trendHistory: TimePoint[];
  stabilityLabel: string;
}

export interface StorageProcessMetric {
  name: string;
  readBytesPerSec: number;
  writeBytesPerSec: number;
}

export interface StorageCardModel {
  deviceLabel: string;
  readBytesPerSec: MetricValue<number>;
  writeBytesPerSec: MetricValue<number>;
  healthPercent: MetricValue<number>;
  healthGrade: string;
  latencyMs: MetricValue<number>;
  queueDepth: MetricValue<number>;
  temperatureC: MetricValue<number | null>;
  tbwBytes: MetricValue<number>;
  tbwLimitBytes: MetricValue<number>;
  powerOnHours: MetricValue<number>;
  activityHistory: TimePoint[];
  activeProcess: StorageProcessMetric | null;
}

export interface NetworkUsageMetric {
  name: string;
  bytesPerSec: number;
  iconHint?: string;
}

export interface NetworkCardModel {
  adapterLabel: string;
  downloadBytesPerSec: number;
  uploadBytesPerSec: number;
  latencyMs: MetricValue<number>;
  jitterMs: MetricValue<number>;
  packetLossPercent: MetricValue<number>;
  signalDbm: MetricValue<number | null>;
  signalLabel: string;
  topUsage: NetworkUsageMetric[];
  history: TimePoint[];
  connections: MetricValue<number>;
  dns: MetricValue<string>;
  ipv4: MetricValue<string>;
  publicIp: MetricValue<string>;
}

export interface PowerBatteryCardModel {
  batteryLevelPercent: MetricValue<number | null>;
  batteryHealthPercent: MetricValue<number | null>;
  cycleCount: MetricValue<number | null>;
  fullChargeCapacityWh: MetricValue<number | null>;
  acConnected: MetricValue<boolean>;
  totalSystemPowerW: MetricValue<number>;
  cpuPowerW: MetricValue<number>;
  gpuPowerW: MetricValue<number>;
  estimatedRemainingMinutes: MetricValue<number | null>;
  powerHistory: TimePoint[];
}

export interface ThermalsFansCardModel {
  cpuTemperatureC: MetricValue<number | null>;
  gpuTemperatureC: MetricValue<number | null>;
  ssdTemperatureC: MetricValue<number | null>;
  cpuFanRpm: MetricValue<number | null>;
  gpuFanRpm: MetricValue<number | null>;
  coolingEfficiencyPercent: MetricValue<number>;
  coolingLabel: string;
  noiseLevelDba: MetricValue<number | null>;
  noiseHistory: TimePoint[];
}

export interface HealthItem {
  label: string;
  status: string;
  tone: Tone;
}

export interface AlertItem {
  id: string;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
}

export interface SystemHealthCardModel {
  overallStatus: string;
  items: HealthItem[];
  recentAlerts: AlertItem[];
}

export interface TrendLineModel {
  label: string;
  valueLabel: string;
  tone: Tone;
  history: TimePoint[];
}

export interface SystemInformationCardModel {
  deviceName: string;
  operatingSystem: string;
  motherboard: MetricValue<string>;
  biosVersion: MetricValue<string>;
  uptimeSeconds: number;
  lastBootIso: string;
  driversStatus: MetricValue<string>;
}

export interface FooterSummaryModel {
  systemHealthy: boolean;
  statusLine: string;
  uptimeSeconds: number;
  totalDataReadBytes: MetricValue<number>;
  totalDataWrittenBytes: MetricValue<number>;
  activityPercent: number;
}

export interface OverviewCards {
  cpu: CpuCardModel;
  gpu: GpuCardModel;
  ram: RamCardModel;
  storage: StorageCardModel;
  network: NetworkCardModel;
  powerBattery: PowerBatteryCardModel;
  thermalsFans: ThermalsFansCardModel;
  topProcesses: ProcessMetric[];
  systemHealth: SystemHealthCardModel;
  trends: TrendsCardModel;
  systemInformation: SystemInformationCardModel;
  footer: FooterSummaryModel;
}

export interface TrendsCardModel {
  lines: TrendLineModel[];
}

export interface RawSnapshot {
  timestamp: number;
  chips: StatusChip[];
  overview: OverviewCards;
}

export interface DisplayCoreUsage {
  id: string;
  label: string;
  type: 'P-Core' | 'E-Core';
  usagePercent: number;
  usageLabel: string;
  tone: Tone;
}

export interface DisplayProcessMetric {
  id: string;
  name: string;
  cpuPercent: number;
  cpuLabel: string;
  ramLabel: string;
  gpuPercent: number;
  gpuLabel: string;
  diskReadLabel?: string;
  diskWriteLabel?: string;
  networkRateLabel?: string;
  source: MetricSource;
}

export interface DisplayMemoryProcessMetric {
  id: string;
  name: string;
  memoryLabel: string;
  source: MetricSource;
}

export interface DisplayNetworkUsageMetric {
  id: string;
  name: string;
  rateMbps: number;
  rateLabel: string;
  source: MetricSource;
}

export interface DisplayStorageProcessMetric {
  name: string;
  readLabel: string;
  writeLabel: string;
  source: MetricSource;
}

export interface DisplayAlertItem extends AlertItem {
  timeLabel: string;
}

export interface DisplayCpuCardModel {
  deviceLabel: string;
  utilization: DisplayMetric<number>;
  currentClock: DisplayMetric<number>;
  packagePower: DisplayMetric<number>;
  maxBoost: DisplayMetric<number>;
  temperature: DisplayMetric<number | null>;
  pCoreUsageAveragePercent: DisplayMetric<number>;
  eCoreUsageAveragePercent: DisplayMetric<number>;
  perCoreUsage: DisplayCoreUsage[];
  utilizationHistory: TimePoint[];
  status: DisplayMetric<string>;
  load: DisplayMetric<number>;
  pCoreAverage: DisplayMetric<number>;
  eCoreAverage: DisplayMetric<number>;
  threads: DisplayMetric<number>;
  processes: DisplayMetric<number>;
}

export interface DisplayGpuCardModel {
  deviceLabel: string;
  utilization: DisplayMetric<number>;
  coreClock: DisplayMetric<number>;
  memoryClock: DisplayMetric<number>;
  powerDraw: DisplayMetric<number>;
  temperature: DisplayMetric<number | null>;
  coreUsage: DisplayMetric<number>;
  vramUsagePercent: DisplayMetric<number>;
  vramUsage: DisplayMetric<string>;
  encoderUsage: DisplayMetric<number>;
  frametimeHistory: TimePoint[];
  status: DisplayMetric<string>;
  topProcesses: DisplayProcessMetric[];
}

export interface DisplayRamCardModel {
  inUse: DisplayMetric<number>;
  usedTotalLabel: string;
  used: DisplayMetric<number>;
  cached: DisplayMetric<number>;
  cachedPercent: DisplayMetric<number>;
  free: DisplayMetric<number>;
  freePercent: DisplayMetric<number>;
  topProcesses: DisplayMemoryProcessMetric[];
  trendHistory: TimePoint[];
  stability: DisplayMetric<string>;
}

export interface DisplayStorageCardModel {
  deviceLabel: string;
  readSpeed: DisplayMetric<number>;
  writeSpeed: DisplayMetric<number>;
  readActivityPercent: DisplayMetric<number>;
  writeActivityPercent: DisplayMetric<number>;
  health: DisplayMetric<number>;
  healthGrade: DisplayMetric<string>;
  latency: DisplayMetric<number>;
  queueDepth: DisplayMetric<number>;
  temperature: DisplayMetric<number | null>;
  tbw: DisplayMetric<string>;
  powerOnHours: DisplayMetric<number>;
  activityHistory: TimePoint[];
  activeProcess: DisplayStorageProcessMetric | null;
}

export interface DisplayNetworkCardModel {
  adapterLabel: string;
  downloadRate: DisplayMetric<number>;
  uploadRate: DisplayMetric<number>;
  latency: DisplayMetric<number>;
  jitter: DisplayMetric<number>;
  packetLoss: DisplayMetric<number>;
  signal: DisplayMetric<number | null>;
  signalLabel: DisplayMetric<string>;
  topUsage: DisplayNetworkUsageMetric[];
  history: TimePoint[];
  connections: DisplayMetric<number>;
  dns: DisplayMetric<string>;
  ipv4: DisplayMetric<string>;
  publicIp: DisplayMetric<string>;
}

export interface DisplayPowerBatteryCardModel {
  batteryLevel: DisplayMetric<number | null>;
  batteryHealth: DisplayMetric<number | null>;
  cycleCount: DisplayMetric<number | null>;
  fullChargeCapacity: DisplayMetric<number | null>;
  acStatus: DisplayMetric<boolean>;
  totalSystemPower: DisplayMetric<number>;
  cpuPower: DisplayMetric<number>;
  gpuPower: DisplayMetric<number>;
  estimatedRemaining: DisplayMetric<number | null>;
  powerHistory: TimePoint[];
}

export interface DisplayThermalSensor {
  id: string;
  label: string;
  temperature: DisplayMetric<number | null>;
  status: DisplayMetric<string>;
}

export interface DisplayThermalsFansCardModel {
  sensors: DisplayThermalSensor[];
  cpuFan: DisplayMetric<number | null>;
  gpuFan: DisplayMetric<number | null>;
  coolingEfficiency: DisplayMetric<number>;
  coolingLabel: DisplayMetric<string>;
  coolingHistory: TimePoint[];
  noiseLevel: DisplayMetric<number | null>;
  noiseHistory: TimePoint[];
}

export interface DisplaySystemHealthCardModel {
  overallStatus: DisplayMetric<string>;
  items: HealthItem[];
  recentAlerts: DisplayAlertItem[];
}

export interface DisplayTrendLineModel {
  label: string;
  value: DisplayMetric<number>;
  tone: Tone;
  history: TimePoint[];
}

export interface DisplayTrendsCardModel {
  lines: DisplayTrendLineModel[];
}

export interface DisplaySystemInformationCardModel {
  deviceName: DisplayMetric<string>;
  operatingSystem: DisplayMetric<string>;
  motherboard: DisplayMetric<string>;
  biosVersion: DisplayMetric<string>;
  uptime: DisplayMetric<number>;
  lastBoot: DisplayMetric<string>;
  driversStatus: DisplayMetric<string>;
}

export interface DisplayFooterSummaryModel {
  systemHealthy: boolean;
  healthLabel: string;
  statusLine: string;
  uptime: DisplayMetric<number>;
  totalDataRead: DisplayMetric<number>;
  totalDataWritten: DisplayMetric<number>;
  activityLabel: string;
  activityDotCount: number;
  activityDotTotal: number;
}

export interface DisplayOverviewCards {
  cpu: DisplayCpuCardModel;
  gpu: DisplayGpuCardModel;
  ram: DisplayRamCardModel;
  storage: DisplayStorageCardModel;
  network: DisplayNetworkCardModel;
  powerBattery: DisplayPowerBatteryCardModel;
  thermalsFans: DisplayThermalsFansCardModel;
  topProcesses: DisplayProcessMetric[];
  systemHealth: DisplaySystemHealthCardModel;
  trends: DisplayTrendsCardModel;
  systemInformation: DisplaySystemInformationCardModel;
  footer: DisplayFooterSummaryModel;
}

export interface PerformanceDisplay {
  timestamp: number;
  updateAgeLabel: string;
  chips: StatusChip[];
  overview: DisplayOverviewCards;
}

export interface PerformanceSnapshot {
  appName: 'Performance Monitor';
  version: number;
  timestamp: number;
  updateAgeMs: number;
  raw: RawSnapshot;
  display: PerformanceDisplay;
}

export interface MonitorSettings {
  theme: 'dark';
  fastRefreshMs: number;
  slowRefreshMs: number;
  visiblePanels: Record<keyof DisplayOverviewCards, boolean>;
}

export type WindowAction = 'minimize' | 'maximize' | 'close';

export interface PerformanceMonitorApi {
  getSnapshot: () => Promise<PerformanceSnapshot>;
  windowAction: (action: WindowAction) => Promise<void>;
}
