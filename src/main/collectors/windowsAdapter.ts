import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

type JsonObject = Record<string, unknown>;

export interface CpuStaticInfo {
  name: string | null;
  maxClockGhz: number | null;
}

export interface ProcessRow {
  pid: number;
  name: string;
  cpuSeconds: number;
  workingSetBytes: number;
  threadCount: number;
  startTimeMs: number | null;
  diskReadBytesPerSec: number | null;
  diskWriteBytesPerSec: number | null;
}

export interface GpuInfo {
  id: string;
  adapterIndex: number;
  vendor: 'nvidia' | 'intel' | 'unknown';
  provider: 'nvml' | 'wmi' | 'lhm' | 'unavailable';
  luid: string | null;
  name: string | null;
  utilizationPercent: number | null;
  coreClockGhz: number | null;
  memoryClockGhz: number | null;
  powerDrawW: number | null;
  temperatureC: number | null;
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
  encoderUsagePercent: number | null;
}

export interface GpuProcessRow {
  pid: number;
  luid: string | null;
  utilizationPercent: number | null;
  engine: string | null;
  dedicatedBytes: number | null;
  sharedBytes: number | null;
}

interface VideoControllerRow {
  index: number;
  name: string | null;
  pnpDeviceId: string | null;
  adapterRamBytes: number | null;
}

interface GpuAdapterMemoryRow {
  luid: string;
  dedicatedUsageBytes: number | null;
  sharedUsageBytes: number | null;
}

interface NvidiaSmiRow {
  index: number;
  name: string | null;
  utilizationPercent: number | null;
  encoderUsagePercent: number | null;
  coreClockGhz: number | null;
  memoryClockGhz: number | null;
  powerDrawW: number | null;
  temperatureC: number | null;
  vramUsedBytes: number | null;
  vramTotalBytes: number | null;
}

interface HardwareSensorReading {
  hardware: string;
  hardwareType: string;
  name: string;
  type: string;
  value: number;
  id: string;
}

export interface StorageInfo {
  label: string | null;
  healthPercent: number | null;
  healthGrade: string | null;
  temperatureC: number | null;
  powerOnHours: number | null;
  tbwBytes: number | null;
  tbwLimitBytes: number | null;
}

export interface DiskCounterInfo {
  readBytesPerSec: number | null;
  writeBytesPerSec: number | null;
  latencyMs: number | null;
  queueDepth: number | null;
}

export interface NetworkInfo {
  adapterLabel: string | null;
  receivedBytes: number | null;
  sentBytes: number | null;
  downloadBytesPerSec: number | null;
  uploadBytesPerSec: number | null;
  ipv4: string | null;
  dns: string | null;
  gateway: string | null;
  connections: number | null;
}

export interface PingInfo {
  latencyMs: number | null;
  packetLossPercent: number | null;
}

export interface BatteryInfo {
  levelPercent: number | null;
  healthPercent: number | null;
  cycleCount: number | null;
  fullChargeCapacityWh: number | null;
  acConnected: boolean | null;
  estimatedRemainingMinutes: number | null;
}

export interface FanInfo {
  cpuFanRpm: number | null;
  gpuFanRpm: number | null;
  cpuTemperatureC: number | null;
  gpuTemperatureC: number | null;
  ssdTemperatureC: number | null;
  cpuPackagePowerW: number | null;
  gpuPowerW: number | null;
}

export interface SystemInfo {
  deviceName: string;
  operatingSystem: string | null;
  motherboard: string | null;
  biosVersion: string | null;
  driverStatus: string | null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(/[^\d.-]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function asRecord(value: unknown): JsonObject | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as JsonObject;
  }

  return null;
}

function firstRecord(value: unknown): JsonObject | null {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }

  return asRecord(value);
}

function stripPowerShellProgress(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#< CLIXML'))
    .join('\n');
}

async function runPowerShellJson<T>(script: string, timeoutMs = 3500): Promise<T | null> {
  const command = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='SilentlyContinue'; ${script.trim()} | ConvertTo-Json -Depth 8 -Compress`;

  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 4
    });

    const cleaned = stripPowerShellProgress(stdout);
    if (!cleaned) {
      return null;
    }

    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function runText(command: string, args: string[], timeoutMs = 2500): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024 * 2
    });

    return stdout;
  } catch {
    return null;
  }
}

export class WindowsMetricsAdapter {
  private hardwareSensorsCache: { timestamp: number; sensors: HardwareSensorReading[] } | null = null;

  async getCpuStaticInfo(): Promise<CpuStaticInfo> {
    const raw = await runPowerShellJson<unknown>(
      'Get-CimInstance Win32_Processor | Select-Object -First 1 Name,MaxClockSpeed',
      3500
    );
    const record = firstRecord(raw);
    const maxClockMhz = toNumber(record?.MaxClockSpeed);

    return {
      name: typeof record?.Name === 'string' ? record.Name.trim() : null,
      maxClockGhz: maxClockMhz ? maxClockMhz / 1000 : null
    };
  }

  async getCpuTemperatureC(): Promise<number | null> {
    const raw = await runPowerShellJson<unknown>(
      "Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature | Select-Object -First 1 @{Name='TemperatureC';Expression={[math]::Round(($_.CurrentTemperature / 10) - 273.15, 1)}}",
      3000
    );
    const temp = toNumber(firstRecord(raw)?.TemperatureC);
    if (temp && temp > 0 && temp < 120) {
      return temp;
    }

    const thermalZoneRaw = await runPowerShellJson<unknown>(
      "Get-CimInstance Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue | Where-Object {$_.HighPrecisionTemperature -gt 0} | ForEach-Object {[pscustomobject]@{TemperatureC=[math]::Round(($_.HighPrecisionTemperature / 10) - 273.15, 1)}} | Sort-Object TemperatureC -Descending | Select-Object -First 1",
      3000
    );
    const zoneTemp = toNumber(firstRecord(thermalZoneRaw)?.TemperatureC);

    return zoneTemp && zoneTemp > 0 && zoneTemp < 120 ? zoneTemp : null;
  }

  async getProcesses(): Promise<ProcessRow[]> {
    const raw = await runPowerShellJson<unknown>(
      '$perf = @{}; Get-CimInstance Win32_PerfFormattedData_PerfProc_Process -ErrorAction SilentlyContinue | Where-Object {$_.IDProcess -gt 0} | ForEach-Object {$perf[[int]$_.IDProcess] = $_}; Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64,@{Name="ThreadCount";Expression={$_.Threads.Count}},@{Name="StartTimeUtc";Expression={try {$_.StartTime.ToUniversalTime().ToString("o")} catch {$null}}},@{Name="IOReadBytesPersec";Expression={if ($perf.ContainsKey([int]$_.Id)) {$perf[[int]$_.Id].IOReadBytesPersec} else {$null}}},@{Name="IOWriteBytesPersec";Expression={if ($perf.ContainsKey([int]$_.Id)) {$perf[[int]$_.Id].IOWriteBytesPersec} else {$null}}}',
      5500
    );
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return rows
      .map((row) => {
        const record = asRecord(row);
        return {
          pid: toNumber(record?.Id) ?? 0,
          name: typeof record?.ProcessName === 'string' ? record.ProcessName : '',
          cpuSeconds: toNumber(record?.CPU) ?? 0,
          workingSetBytes: toNumber(record?.WorkingSet64) ?? 0,
          threadCount: toNumber(record?.ThreadCount) ?? 0,
          startTimeMs: typeof record?.StartTimeUtc === 'string' ? Date.parse(record.StartTimeUtc) : null,
          diskReadBytesPerSec: toNumber(record?.IOReadBytesPersec),
          diskWriteBytesPerSec: toNumber(record?.IOWriteBytesPersec)
        };
      })
      .filter((row) => row.pid > 0 && row.name.trim().length > 0);
  }

  async getMemoryCacheBytes(): Promise<number | null> {
    const raw = await runPowerShellJson<unknown>(
      "(Get-Counter '\\Memory\\Cache Bytes').CounterSamples[0].CookedValue",
      2500
    );

    return toNumber(raw);
  }

  async getGpuInfo(): Promise<GpuInfo> {
    const gpus = await this.getGpuInfos();
    return this.selectActiveGpu(gpus);
  }

  async getGpuInfos(): Promise<GpuInfo[]> {
    const [controllers, nvidiaRows, sensors, adapterMemoryRows, utilizationByLuid] = await Promise.all([
      this.getVideoControllers(),
      this.getNvidiaSmiInfos(),
      this.getHardwareSensors(),
      this.getGpuAdapterMemoryRows(),
      this.getGpuUtilizationByLuid()
    ]);
    const physicalControllers = controllers.filter((controller) => this.isPhysicalGpu(controller));
    const usedNvidiaRows = new Set<number>();
    const memoryRowsByDedicated = [...adapterMemoryRows].sort((a, b) => (b.dedicatedUsageBytes ?? 0) - (a.dedicatedUsageBytes ?? 0));
    const memoryRowsByShared = [...adapterMemoryRows].sort((a, b) => (b.sharedUsageBytes ?? 0) - (a.sharedUsageBytes ?? 0));
    const nvidiaLuid = memoryRowsByDedicated.find((row) => (row.dedicatedUsageBytes ?? 0) > 0)?.luid ?? null;
    const intelLuid = memoryRowsByShared.find((row) => row.luid !== nvidiaLuid && (row.sharedUsageBytes ?? 0) > 0)?.luid ?? null;

    const gpus = physicalControllers.map((controller, index) => {
      const vendor = this.gpuVendor(controller.name, controller.pnpDeviceId);
      const nvidiaRow =
        vendor === 'nvidia'
          ? nvidiaRows.find((row) => {
              const matches = Boolean(row.name && controller.name && this.normalizedName(row.name).includes(this.normalizedName(controller.name).slice(0, 18)));
              return !usedNvidiaRows.has(row.index) && (matches || nvidiaRows.length === 1);
            })
          : undefined;
      if (nvidiaRow) {
        usedNvidiaRows.add(nvidiaRow.index);
      }

      const gpuSensors = this.sensorsForGpu(sensors, controller.name, vendor);
      const luid = vendor === 'nvidia' ? nvidiaLuid : vendor === 'intel' ? intelLuid : null;
      const adapterMemory = luid ? adapterMemoryRows.find((row) => row.luid === luid) : undefined;
      const sensorUtilization = this.gpuLoadFromSensors(gpuSensors);
      const utilizationFromCounters = luid ? utilizationByLuid.get(luid.toLowerCase()) ?? null : null;
      const sensorCoreClockMhz = this.firstSensorValue(gpuSensors, 'Clock', [/GPU Core/i]);
      const sensorMemoryClockMhz = this.firstSensorValue(gpuSensors, 'Clock', [/GPU Memory/i]);
      const sensorPower = this.firstSensorValue(gpuSensors, 'Power', [/GPU (Package|Power|Core)/i]);
      const sensorTemperature = this.firstSensorValue(gpuSensors, 'Temperature', [/GPU Core/i, /Hot Spot/i]);
      const sensorEncoder = this.firstSensorValue(gpuSensors, 'Load', [/Video Encode/i, /Encoder/i]);
      const sensorMemoryUsedMb =
        this.firstSensorValue(gpuSensors, 'SmallData', [/GPU Memory Used/i, /D3D Dedicated Memory Used/i, /D3D Shared Memory Used/i]) ?? null;
      const sensorMemoryTotalMb =
        this.firstSensorValue(gpuSensors, 'SmallData', [/GPU Memory Total/i, /D3D Dedicated Memory Total/i, /D3D Shared Memory Total/i]) ?? null;
      const hasSensorData = gpuSensors.length > 0;
      const provider: GpuInfo['provider'] = nvidiaRow
        ? 'nvml'
        : hasSensorData
          ? 'lhm'
          : controller.name || adapterMemory || utilizationFromCounters !== null
            ? 'wmi'
            : 'unavailable';

      return {
        id: `${vendor}-${controller.index}`,
        adapterIndex: controller.index,
        vendor,
        provider,
        luid,
        name: nvidiaRow?.name ?? controller.name,
        utilizationPercent: this.validPercent(nvidiaRow?.utilizationPercent ?? sensorUtilization ?? utilizationFromCounters),
        coreClockGhz: nvidiaRow?.coreClockGhz ?? (sensorCoreClockMhz === null ? null : sensorCoreClockMhz / 1000),
        memoryClockGhz: nvidiaRow?.memoryClockGhz ?? (sensorMemoryClockMhz === null ? null : sensorMemoryClockMhz / 1000),
        powerDrawW: this.validNonNegative(nvidiaRow?.powerDrawW ?? sensorPower),
        temperatureC: this.validTemperature(nvidiaRow?.temperatureC ?? sensorTemperature),
        vramUsedBytes:
          nvidiaRow?.vramUsedBytes ??
          (sensorMemoryUsedMb === null ? adapterMemory?.dedicatedUsageBytes ?? null : sensorMemoryUsedMb * 1024 * 1024),
        vramTotalBytes:
          nvidiaRow?.vramTotalBytes ??
          (sensorMemoryTotalMb === null ? controller.adapterRamBytes : sensorMemoryTotalMb * 1024 * 1024),
        encoderUsagePercent: this.validPercent(nvidiaRow?.encoderUsagePercent ?? sensorEncoder)
      };
    });

    for (const nvidiaRow of nvidiaRows) {
      if (usedNvidiaRows.has(nvidiaRow.index)) {
        continue;
      }

      gpus.push({
        id: `nvidia-${nvidiaRow.index}`,
        adapterIndex: nvidiaRow.index,
        vendor: 'nvidia',
        provider: 'nvml',
        luid: nvidiaLuid,
        name: nvidiaRow.name,
        utilizationPercent: this.validPercent(nvidiaRow.utilizationPercent),
        coreClockGhz: nvidiaRow.coreClockGhz,
        memoryClockGhz: nvidiaRow.memoryClockGhz,
        powerDrawW: this.validNonNegative(nvidiaRow.powerDrawW),
        temperatureC: this.validTemperature(nvidiaRow.temperatureC),
        vramUsedBytes: nvidiaRow.vramUsedBytes,
        vramTotalBytes: nvidiaRow.vramTotalBytes,
        encoderUsagePercent: this.validPercent(nvidiaRow.encoderUsagePercent)
      });
    }

    return gpus.length ? gpus : [this.emptyGpuInfo()];
  }

  private async getNvidiaSmiInfos(): Promise<NvidiaSmiRow[]> {
    const stdout = await runText(
      'nvidia-smi',
      [
        '--query-gpu=index,name,utilization.gpu,utilization.encoder,clocks.current.graphics,clocks.current.memory,power.draw,temperature.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ],
      2500
    );

    if (!stdout) {
      return [];
    }

    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const values = line.split(',').map((part) => part.trim());
        const coreClockMhz = toNumber(values[4]);
        const memoryClockMhz = toNumber(values[5]);
        const vramUsedMb = toNumber(values[8]);
        const vramTotalMb = toNumber(values[9]);

        return {
          index: toNumber(values[0]) ?? 0,
          name: values[1] || null,
          utilizationPercent: toNumber(values[2]),
          encoderUsagePercent: toNumber(values[3]),
          coreClockGhz: coreClockMhz === null ? null : coreClockMhz / 1000,
          memoryClockGhz: memoryClockMhz === null ? null : memoryClockMhz / 1000,
          powerDrawW: toNumber(values[6]),
          temperatureC: toNumber(values[7]),
          vramUsedBytes: vramUsedMb === null ? null : vramUsedMb * 1024 * 1024,
          vramTotalBytes: vramTotalMb === null ? null : vramTotalMb * 1024 * 1024
        };
      });
  }

  private async getVideoControllers(): Promise<VideoControllerRow[]> {
    const raw = await runPowerShellJson<unknown>(
      'Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID,AdapterRAM',
      3500
    );
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return rows.map((row, index) => {
      const record = asRecord(row);
      return {
        index,
        name: typeof record?.Name === 'string' ? record.Name : null,
        pnpDeviceId: typeof record?.PNPDeviceID === 'string' ? record.PNPDeviceID : null,
        adapterRamBytes: toNumber(record?.AdapterRAM)
      };
    });
  }

  private async getGpuUtilizationByLuid(): Promise<Map<string, number>> {
    const raw = await runPowerShellJson<unknown>(
      "$samples = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples; $rows = @{}; foreach ($sample in $samples) { if ($sample.InstanceName -match '(luid_0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)_') { $key = $Matches[1].ToLowerInvariant(); if (-not $rows.ContainsKey($key)) { $rows[$key] = 0.0 }; $rows[$key] += [double]$sample.CookedValue } }; $rows.GetEnumerator() | ForEach-Object {[pscustomobject]@{Luid=$_.Key;Value=[math]::Round([math]::Min(100,[math]::Max(0,$_.Value)),1)}}",
      2500
    );
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const result = new Map<string, number>();
    for (const row of rows) {
      const record = asRecord(row);
      const luid = typeof record?.Luid === 'string' ? record.Luid.toLowerCase() : null;
      const value = this.validPercent(toNumber(record?.Value));
      if (luid && value !== null) {
        result.set(luid, value);
      }
    }
    return result;
  }

  private async getGpuAdapterMemoryRows(): Promise<GpuAdapterMemoryRow[]> {
    const raw = await runPowerShellJson<unknown>(
      'Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue | Select-Object Name,DedicatedUsage,SharedUsage',
      2500
    );
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return rows
      .map((row) => {
        const record = asRecord(row);
        const name = typeof record?.Name === 'string' ? record.Name.toLowerCase() : '';
        const luidMatch = name.match(/(luid_0x[0-9a-f]+_0x[0-9a-f]+)/);
        return {
          luid: luidMatch?.[1] ?? '',
          dedicatedUsageBytes: this.validNonNegative(toNumber(record?.DedicatedUsage)),
          sharedUsageBytes: this.validNonNegative(toNumber(record?.SharedUsage))
        };
      })
      .filter((row) => row.luid);
  }

  private emptyGpuInfo(): GpuInfo {
    return {
      id: 'gpu-unavailable',
      adapterIndex: 0,
      vendor: 'unknown',
      provider: 'unavailable',
      luid: null,
      name: null,
      utilizationPercent: null,
      coreClockGhz: null,
      memoryClockGhz: null,
      powerDrawW: null,
      temperatureC: null,
      vramUsedBytes: null,
      vramTotalBytes: null,
      encoderUsagePercent: null
    };
  }

  private selectActiveGpu(gpus: GpuInfo[]): GpuInfo {
    const usable = gpus.filter((gpu) => gpu.provider !== 'unavailable');
    if (!usable.length) {
      return this.emptyGpuInfo();
    }

    return [...usable].sort((a, b) => (b.utilizationPercent ?? -1) - (a.utilizationPercent ?? -1) || (b.vramUsedBytes ?? -1) - (a.vramUsedBytes ?? -1))[0];
  }

  private isPhysicalGpu(controller: VideoControllerRow): boolean {
    const name = controller.name ?? '';
    const pnp = controller.pnpDeviceId ?? '';
    if (!/^PCI\\/i.test(pnp)) {
      return false;
    }

    return !/virtual|iddcx|display hub|luminon/i.test(name);
  }

  private gpuVendor(name: string | null, pnpDeviceId: string | null): 'nvidia' | 'intel' | 'unknown' {
    const value = `${name ?? ''} ${pnpDeviceId ?? ''}`;
    if (/nvidia|ven_10de/i.test(value)) {
      return 'nvidia';
    }

    if (/intel|ven_8086/i.test(value)) {
      return 'intel';
    }

    return 'unknown';
  }

  private normalizedName(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private sensorsForGpu(sensors: HardwareSensorReading[], name: string | null, vendor: 'nvidia' | 'intel' | 'unknown'): HardwareSensorReading[] {
    const normalized = name ? this.normalizedName(name) : '';
    return sensors.filter((sensor) => {
      if (vendor === 'nvidia' && /GpuNvidia/i.test(sensor.hardwareType)) {
        return true;
      }
      if (vendor === 'intel' && /GpuIntel/i.test(sensor.hardwareType)) {
        return true;
      }
      return normalized.length > 0 && this.normalizedName(sensor.hardware).includes(normalized.slice(0, 18));
    });
  }

  private gpuLoadFromSensors(sensors: HardwareSensorReading[]): number | null {
    const loads = sensors
      .filter((sensor) => sensor.type === 'Load' && !/memory|bus|controller/i.test(sensor.name))
      .map((sensor) => this.validPercent(sensor.value))
      .filter((value): value is number => value !== null);

    return loads.length ? Math.max(...loads) : null;
  }

  private firstSensorValue(sensors: HardwareSensorReading[], type: string, patterns: RegExp[]): number | null {
    const typed = sensors.filter((sensor) => sensor.type === type);
    for (const pattern of patterns) {
      const match = typed.find((sensor) => pattern.test(sensor.name) || pattern.test(sensor.id));
      if (match) {
        return match.value;
      }
    }

    return null;
  }

  private validPercent(value: number | null | undefined): number | null {
    return value === null || value === undefined || !Number.isFinite(value) ? null : Math.max(0, Math.min(100, value));
  }

  private validNonNegative(value: number | null | undefined): number | null {
    return value === null || value === undefined || !Number.isFinite(value) || value < 0 ? null : value;
  }

  private validTemperature(value: number | null | undefined): number | null {
    return value === null || value === undefined || !Number.isFinite(value) || value <= 0 || value >= 130 ? null : value;
  }

  private async getHardwareSensors(): Promise<HardwareSensorReading[]> {
    const now = Date.now();
    if (this.hardwareSensorsCache && now - this.hardwareSensorsCache.timestamp < 4_000) {
      return this.hardwareSensorsCache.sensors;
    }

    const projectPath = this.findSensorBridgeProject();
    if (!projectPath) {
      return [];
    }

    let stdout = await runText('dotnet', ['run', '--project', projectPath, '-c', 'Release', '--no-restore'], 10_000);
    if (!stdout) {
      stdout = await runText('dotnet', ['run', '--project', projectPath, '-c', 'Release'], 25_000);
    }

    if (!stdout) {
      return [];
    }

    try {
      const parsed = JSON.parse(stripPowerShellProgress(stdout)) as unknown;
      const rows = Array.isArray(parsed) ? parsed : [];
      const sensors = rows
        .map((row) => {
          const record = asRecord(row);
          return {
            hardware: typeof record?.hardware === 'string' ? record.hardware : '',
            hardwareType: typeof record?.hardwareType === 'string' ? record.hardwareType : '',
            name: typeof record?.name === 'string' ? record.name : '',
            type: typeof record?.type === 'string' ? record.type : '',
            value: toNumber(record?.value) ?? Number.NaN,
            id: typeof record?.id === 'string' ? record.id : ''
          };
        })
        .filter((sensor) => sensor.hardware && sensor.name && sensor.type && Number.isFinite(sensor.value));

      this.hardwareSensorsCache = { timestamp: now, sensors };
      return sensors;
    } catch {
      return [];
    }
  }

  private findSensorBridgeProject(): string | null {
    const candidates = [
      join(process.cwd(), 'src', 'main', 'sensorBridge', 'HardwareSensorBridge.csproj'),
      join(__dirname, '..', 'sensorBridge', 'HardwareSensorBridge.csproj'),
      join(__dirname, '..', '..', 'src', 'main', 'sensorBridge', 'HardwareSensorBridge.csproj')
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
  }

  async getGpuProcesses(): Promise<GpuProcessRow[]> {
    const raw = await runPowerShellJson<unknown>(
      "$engines = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue | Select-Object Name,UtilizationPercentage; $memory = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory -ErrorAction SilentlyContinue | Select-Object Name,DedicatedUsage,SharedUsage; $rows = @{}; function KeyFor($pid,$luid){ return ('' + $pid + '|' + $luid.ToLowerInvariant()) }; foreach ($engine in $engines) { if ($engine.Name -match 'pid_(\\d+).*?(luid_0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)') { $processIdValue = [int]$Matches[1]; $luidValue = $Matches[2].ToLowerInvariant(); $key = KeyFor $processIdValue $luidValue; if (-not $rows.ContainsKey($key)) { $rows[$key] = [pscustomobject]@{Pid=$processIdValue;Luid=$luidValue;Utilization=0.0;Engine=$null;Dedicated=$null;Shared=$null;TopEngineUsage=-1.0} }; $usage = if ($null -ne $engine.UtilizationPercentage) { [double]$engine.UtilizationPercentage } else { 0.0 }; $rows[$key].Utilization += $usage; if ($usage -gt $rows[$key].TopEngineUsage) { $rows[$key].TopEngineUsage = $usage; if ($engine.Name -match 'engtype_([^_]+)') { $rows[$key].Engine = $Matches[1] } } } }; foreach ($item in $memory) { if ($item.Name -match 'pid_(\\d+).*?(luid_0x[0-9a-fA-F]+_0x[0-9a-fA-F]+)') { $processIdValue = [int]$Matches[1]; $luidValue = $Matches[2].ToLowerInvariant(); $key = KeyFor $processIdValue $luidValue; if (-not $rows.ContainsKey($key)) { $rows[$key] = [pscustomobject]@{Pid=$processIdValue;Luid=$luidValue;Utilization=$null;Engine=$null;Dedicated=$null;Shared=$null;TopEngineUsage=-1.0} }; if ($null -ne $item.DedicatedUsage) { if ($rows[$key].Dedicated -eq $null) { $rows[$key].Dedicated = 0.0 }; $rows[$key].Dedicated += [double]$item.DedicatedUsage }; if ($null -ne $item.SharedUsage) { if ($rows[$key].Shared -eq $null) { $rows[$key].Shared = 0.0 }; $rows[$key].Shared += [double]$item.SharedUsage } } }; $rows.Values | ForEach-Object {[pscustomobject]@{Pid=$_.Pid;Luid=$_.Luid;Utilization=if ($_.Utilization -eq $null) {$null} else {[math]::Round([math]::Min(100, [math]::Max(0, $_.Utilization)), 1)};Engine=$_.Engine;Dedicated=if ($_.Dedicated -eq $null) {$null} else {[math]::Round($_.Dedicated, 0)};Shared=if ($_.Shared -eq $null) {$null} else {[math]::Round($_.Shared, 0)}}}",
      4500
    );
    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

    return rows
      .map((row) => {
        const record = asRecord(row);
        return {
          pid: toNumber(record?.Pid) ?? 0,
          luid: typeof record?.Luid === 'string' && record.Luid.trim() ? record.Luid.trim().toLowerCase() : null,
          utilizationPercent: toNumber(record?.Utilization),
          engine: typeof record?.Engine === 'string' && record.Engine.trim() ? record.Engine.trim() : null,
          dedicatedBytes: toNumber(record?.Dedicated),
          sharedBytes: toNumber(record?.Shared)
        };
      })
      .filter((row) => row.pid > 0);
  }

  async getStorageInfo(): Promise<StorageInfo> {
    const [raw, sensors] = await Promise.all([
      runPowerShellJson<unknown>(
        "$disk = Get-PhysicalDisk | Select-Object -First 1 FriendlyName,HealthStatus,Size; $rel = $null; try { $rel = Get-PhysicalDisk | Select-Object -First 1 | Get-StorageReliabilityCounter -ErrorAction Stop } catch {}; [pscustomobject]@{ Label=$disk.FriendlyName; Health=$disk.HealthStatus; Size=$disk.Size; Temperature=$rel.Temperature; PowerOnHours=$rel.PowerOnHours; Wear=$rel.Wear; HostWrites=$rel.HostWrites }",
        4500
      ),
      this.getHardwareSensors()
    ]);
    const record = firstRecord(raw);
    const health = typeof record?.Health === 'string' ? record.Health : null;
    const wear = toNumber(record?.Wear);
    const healthPercent = wear === null ? null : Math.max(0, Math.min(100, 100 - wear));
    const storageSensors = sensors.filter((sensor) => /storage|hdd|ssd|nvme/i.test(sensor.hardwareType) || /nvme|ssd|hdd|drive|disk/i.test(sensor.hardware));
    const sensorTemperature = this.validTemperature(this.firstSensorValue(storageSensors, 'Temperature', [/temperature/i, /composite/i, /drive/i]));

    return {
      label: typeof record?.Label === 'string' ? record.Label : null,
      healthPercent,
      healthGrade: health,
      temperatureC: this.validTemperature(toNumber(record?.Temperature)) ?? sensorTemperature,
      powerOnHours: toNumber(record?.PowerOnHours),
      tbwBytes: toNumber(record?.HostWrites),
      tbwLimitBytes: null
    };
  }

  async getDiskCounters(): Promise<DiskCounterInfo> {
    const raw = await runPowerShellJson<unknown>(
      "$c = Get-Counter -Counter '\\PhysicalDisk(_Total)\\Disk Read Bytes/sec','\\PhysicalDisk(_Total)\\Disk Write Bytes/sec','\\PhysicalDisk(_Total)\\Avg. Disk sec/Transfer','\\PhysicalDisk(_Total)\\Current Disk Queue Length'; $read=$null; $write=$null; $lat=$null; $queue=$null; foreach ($s in $c.CounterSamples) { if ($s.Path -like '*Disk Read Bytes/sec') { $read=$s.CookedValue } elseif ($s.Path -like '*Disk Write Bytes/sec') { $write=$s.CookedValue } elseif ($s.Path -like '*Avg. Disk sec/Transfer') { $lat=$s.CookedValue * 1000 } elseif ($s.Path -like '*Current Disk Queue Length') { $queue=$s.CookedValue } }; [pscustomobject]@{Read=$read;Write=$write;Latency=$lat;Queue=$queue}",
      3000
    );
    const record = firstRecord(raw);

    return {
      readBytesPerSec: toNumber(record?.Read),
      writeBytesPerSec: toNumber(record?.Write),
      latencyMs: toNumber(record?.Latency),
      queueDepth: toNumber(record?.Queue)
    };
  }

  async getNetworkInfo(): Promise<NetworkInfo> {
    const raw = await runPowerShellJson<unknown>(
      "$cfg = Get-CimInstance Win32_NetworkAdapterConfiguration -Filter \"IPEnabled=True\" | Where-Object { $_.IPAddress -and ($_.IPAddress | Where-Object { $_ -match '^\\d+\\.' -and $_ -notmatch '^169\\.254\\.' }) } | Select-Object -First 1; $statsText = netstat -e; $bytesLine = $statsText | Select-String -Pattern '^\\s*Bytes\\s+(\\d+)\\s+(\\d+)' | Select-Object -First 1; $received = if ($bytesLine) { [double]$bytesLine.Matches[0].Groups[1].Value } else { $null }; $sent = if ($bytesLine) { [double]$bytesLine.Matches[0].Groups[2].Value } else { $null }; $connections = (netstat -ano | Select-String -Pattern 'TCP|UDP').Count; $ipv4 = if ($cfg) { $cfg.IPAddress | Where-Object { $_ -match '^\\d+\\.' -and $_ -notmatch '^169\\.254\\.' } | Select-Object -First 1 } else { $null }; $dns = if ($cfg) { $cfg.DNSServerSearchOrder | Where-Object { $_ -match '^\\d+\\.' } | Select-Object -First 1 } else { $null }; $gateway = if ($cfg) { $cfg.DefaultIPGateway | Where-Object { $_ -match '^\\d+\\.' } | Select-Object -First 1 } else { $null }; [pscustomobject]@{Label=$cfg.Description;Received=$received;Sent=$sent;DownloadRate=$null;UploadRate=$null;IPv4=$ipv4;Dns=$dns;Gateway=$gateway;Connections=$connections}",
      2500
    );
    const record = firstRecord(raw);

    return {
      adapterLabel: typeof record?.Label === 'string' ? record.Label : null,
      receivedBytes: toNumber(record?.Received),
      sentBytes: toNumber(record?.Sent),
      downloadBytesPerSec: toNumber(record?.DownloadRate),
      uploadBytesPerSec: toNumber(record?.UploadRate),
      ipv4: typeof record?.IPv4 === 'string' ? record.IPv4 : null,
      dns: typeof record?.Dns === 'string' ? record.Dns : null,
      gateway: typeof record?.Gateway === 'string' ? record.Gateway : null,
      connections: toNumber(record?.Connections)
    };
  }

  async getWifiSignalDbm(): Promise<number | null> {
    const raw = await runPowerShellJson<unknown>(
      `
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class PerformanceMonitorNativeWifi {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct WLAN_INTERFACE_INFO {
    public Guid InterfaceGuid;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string strInterfaceDescription;
    public int isState;
  }

  [DllImport("wlanapi.dll")] public static extern uint WlanOpenHandle(uint dwClientVersion, IntPtr pReserved, out uint pdwNegotiatedVersion, out IntPtr phClientHandle);
  [DllImport("wlanapi.dll")] public static extern uint WlanEnumInterfaces(IntPtr hClientHandle, IntPtr pReserved, out IntPtr ppInterfaceList);
  [DllImport("wlanapi.dll")] public static extern uint WlanQueryInterface(IntPtr hClientHandle, ref Guid pInterfaceGuid, int OpCode, IntPtr pReserved, out uint pdwDataSize, out IntPtr ppData, IntPtr pWlanOpcodeValueType);
  [DllImport("wlanapi.dll")] public static extern void WlanFreeMemory(IntPtr pMemory);
  [DllImport("wlanapi.dll")] public static extern uint WlanCloseHandle(IntPtr hClientHandle, IntPtr pReserved);
}
"@
$client = [IntPtr]::Zero
$version = [uint32]0
$opened = [PerformanceMonitorNativeWifi]::WlanOpenHandle(2, [IntPtr]::Zero, [ref]$version, [ref]$client)
$result = $null
if ($opened -eq 0) {
  $list = [IntPtr]::Zero
  $enum = [PerformanceMonitorNativeWifi]::WlanEnumInterfaces($client, [IntPtr]::Zero, [ref]$list)
  if ($enum -eq 0) {
    $count = [Runtime.InteropServices.Marshal]::ReadInt32($list, 0)
    $offset = 8
    $size = [Runtime.InteropServices.Marshal]::SizeOf([type][PerformanceMonitorNativeWifi+WLAN_INTERFACE_INFO])
    for ($i = 0; $i -lt $count; $i++) {
      $ptr = [IntPtr]::Add($list, $offset + ($i * $size))
      $info = [Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type][PerformanceMonitorNativeWifi+WLAN_INTERFACE_INFO])
      $dataSize = [uint32]0
      $data = [IntPtr]::Zero
      $query = [PerformanceMonitorNativeWifi]::WlanQueryInterface($client, [ref]$info.InterfaceGuid, 0x10000102, [IntPtr]::Zero, [ref]$dataSize, [ref]$data, [IntPtr]::Zero)
      if ($query -eq 0 -and $data -ne [IntPtr]::Zero) {
        $rssi = [Runtime.InteropServices.Marshal]::ReadInt32($data)
        if ($rssi -le 0 -and $rssi -ge -120) {
          $result = $rssi
        }
      }
      if ($data -ne [IntPtr]::Zero) {
        [PerformanceMonitorNativeWifi]::WlanFreeMemory($data)
      }
      if ($result -ne $null) {
        break
      }
    }
    [PerformanceMonitorNativeWifi]::WlanFreeMemory($list)
  }
  [PerformanceMonitorNativeWifi]::WlanCloseHandle($client, [IntPtr]::Zero) | Out-Null
}
$result
      `,
      3500
    );
    const signal = toNumber(raw);

    return signal !== null && signal <= 0 && signal >= -120 ? signal : null;
  }

  async getPingInfo(host: string): Promise<PingInfo> {
    const stdout = await runText('ping', ['-n', '3', host], 5000);
    if (!stdout) {
      return { latencyMs: null, packetLossPercent: null };
    }

    const average = stdout.match(/Average\s*=\s*(\d+)ms/i) ?? stdout.match(/Average\s*=\s*(\d+)\s*ms/i);
    const loss = stdout.match(/\((\d+)%\s*loss\)/i);

    return {
      latencyMs: average ? Number.parseInt(average[1], 10) : null,
      packetLossPercent: loss ? Number.parseInt(loss[1], 10) : null
    };
  }

  async getPublicIp(): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch('https://api.ipify.org', { signal: controller.signal });
      clearTimeout(timer);

      if (!response.ok) {
        return null;
      }

      return (await response.text()).trim();
    } catch {
      return null;
    }
  }

  async getBatteryInfo(): Promise<BatteryInfo> {
    const raw = await runPowerShellJson<unknown>(
      "$battery = Get-CimInstance Win32_Battery | Select-Object -First 1; $portable = Get-CimInstance Win32_PortableBattery -ErrorAction SilentlyContinue | Select-Object -First 1; $full = Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1; $design = Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1; $cycles = Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1; $level = if ($battery -and $null -ne $battery.EstimatedChargeRemaining) { $battery.EstimatedChargeRemaining } elseif ($portable) { $portable.EstimatedChargeRemaining } else { $null }; $remaining = if ($battery -and $null -ne $battery.EstimatedRunTime) { $battery.EstimatedRunTime } elseif ($portable) { $portable.EstimatedRunTime } else { $null }; $fullCapacity = if ($full -and $null -ne $full.FullChargedCapacity) { $full.FullChargedCapacity } elseif ($portable) { $portable.FullChargeCapacity } else { $null }; $designCapacity = if ($design -and $null -ne $design.DesignedCapacity) { $design.DesignedCapacity } elseif ($portable) { $portable.DesignCapacity } else { $null }; $result = if ($battery -or $portable) { [pscustomobject]@{Level=$level;Status=$battery.BatteryStatus;Remaining=$remaining;Full=$fullCapacity;Design=$designCapacity;Cycles=$cycles.CycleCount} } else { [pscustomobject]@{Level=$null;Status=$null;Remaining=$null;Full=$null;Design=$null;Cycles=$null} }; $result",
      4000
    );
    const record = firstRecord(raw);
    const fullMwh = toNumber(record?.Full);
    const designMwh = toNumber(record?.Design);
    const status = toNumber(record?.Status);
    const remaining = toNumber(record?.Remaining);

    return {
      levelPercent: toNumber(record?.Level),
      healthPercent: fullMwh && designMwh ? Math.round((fullMwh / designMwh) * 100) : null,
      cycleCount: toNumber(record?.Cycles),
      fullChargeCapacityWh: fullMwh ? fullMwh / 1000 : null,
      acConnected: status === null ? null : [2, 6, 7, 8, 9].includes(status),
      estimatedRemainingMinutes: remaining && remaining > 0 && remaining < 71582788 ? remaining : null
    };
  }

  async getFanInfo(): Promise<FanInfo> {
    const [raw, sensors] = await Promise.all([
      runPowerShellJson<unknown>(
        "$sensors = @(Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue) + @(Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue); function FirstSensor($type, [string[]]$patterns) { $items = @($sensors | Where-Object {$_.SensorType -eq $type}); foreach ($pattern in $patterns) { $match = $items | Where-Object { ($_.Name -match $pattern) -or ($_.Identifier -match $pattern) -or ($_.Parent -match $pattern) } | Select-Object -First 1; if ($match) { return $match.Value } }; return $null }; [pscustomobject]@{CpuFan=(FirstSensor 'Fan' @('CPU','Processor')); GpuFan=(FirstSensor 'Fan' @('GPU','Graphics')); CpuTemp=(FirstSensor 'Temperature' @('CPU Package','CPU Core','Core Max','Tctl','Tdie','CPU')); GpuTemp=(FirstSensor 'Temperature' @('GPU Core','GPU')); SsdTemp=(FirstSensor 'Temperature' @('NVMe','SSD','HDD','Drive','Disk')); CpuPower=(FirstSensor 'Power' @('CPU Package','CPU Cores','Processor')); GpuPower=(FirstSensor 'Power' @('GPU Package','GPU'))}",
        3500
      ),
      this.getHardwareSensors()
    ]);
    const record = firstRecord(raw);
    const cpuSensors = sensors.filter((sensor) => /cpu/i.test(sensor.hardwareType) || /cpu|processor|intel core|ryzen/i.test(sensor.hardware));
    const gpuSensors = sensors.filter((sensor) => /gpu/i.test(sensor.hardwareType));
    const storageSensors = sensors.filter((sensor) => /storage|hdd|ssd|nvme/i.test(sensor.hardwareType) || /nvme|ssd|hdd|drive|disk/i.test(sensor.hardware));
    const cpuPower = this.validNonNegative(toNumber(record?.CpuPower)) ?? this.validNonNegative(this.firstSensorValue(cpuSensors, 'Power', [/CPU Package/i, /CPU Cores/i, /Processor/i]));
    const gpuPower = this.validNonNegative(toNumber(record?.GpuPower)) ?? this.validNonNegative(this.firstSensorValue(gpuSensors, 'Power', [/GPU Package/i, /GPU Power/i, /GPU Core/i]));

    return {
      cpuFanRpm: this.validNonNegative(toNumber(record?.CpuFan)) ?? this.validNonNegative(this.firstSensorValue(cpuSensors, 'Fan', [/CPU/i, /Processor/i])),
      gpuFanRpm: this.validNonNegative(toNumber(record?.GpuFan)) ?? this.validNonNegative(this.firstSensorValue(gpuSensors, 'Fan', [/GPU/i, /Graphics/i])),
      cpuTemperatureC:
        this.validTemperature(toNumber(record?.CpuTemp)) ??
        this.validTemperature(this.firstSensorValue(cpuSensors, 'Temperature', [/CPU Package/i, /CPU Core Max/i, /Core Max/i, /Tctl/i, /Tdie/i, /CPU/i])),
      gpuTemperatureC:
        this.validTemperature(toNumber(record?.GpuTemp)) ??
        this.validTemperature(this.firstSensorValue(gpuSensors, 'Temperature', [/GPU Core/i, /Hot Spot/i, /GPU/i])),
      ssdTemperatureC:
        this.validTemperature(toNumber(record?.SsdTemp)) ??
        this.validTemperature(this.firstSensorValue(storageSensors, 'Temperature', [/Composite/i, /Temperature/i, /Drive/i])),
      cpuPackagePowerW: cpuPower,
      gpuPowerW: gpuPower
    };
  }

  async getSystemInfo(): Promise<SystemInfo> {
    const raw = await runPowerShellJson<unknown>(
      "$os = Get-CimInstance Win32_OperatingSystem | Select-Object -First 1 Caption,OSArchitecture; $board = Get-CimInstance Win32_BaseBoard | Select-Object -First 1 Manufacturer,Product; $bios = Get-CimInstance Win32_BIOS | Select-Object -First 1 SMBIOSBIOSVersion; [pscustomobject]@{Os=($os.Caption + ' ' + $os.OSArchitecture);Board=($board.Manufacturer + ' ' + $board.Product);Bios=$bios.SMBIOSBIOSVersion}",
      4500
    );
    const record = firstRecord(raw);
    const driverStatus = await this.getDriverStatus();

    return {
      deviceName: os.hostname(),
      operatingSystem: typeof record?.Os === 'string' ? record.Os : null,
      motherboard: typeof record?.Board === 'string' ? record.Board.trim() : null,
      biosVersion: typeof record?.Bios === 'string' ? record.Bios : null,
      driverStatus
    };
  }

  async getPowerMode(): Promise<string | null> {
    const stdout = await runText('powercfg', ['/getactivescheme'], 2500);
    const match = stdout?.match(/\(([^)]+)\)/);
    const plan = match?.[1]?.trim();
    if (!plan) {
      return null;
    }

    if (/balanced/i.test(plan)) {
      return 'Balanced';
    }
    if (/high|ultimate|performance/i.test(plan)) {
      return 'High Performance';
    }
    if (/power saver|saver/i.test(plan)) {
      return 'Power Saver';
    }

    return plan;
  }

  private async getDriverStatus(): Promise<string | null> {
    const stdout = await runText('pnputil', ['/enum-devices', '/problem'], 3500);
    if (!stdout) {
      return null;
    }

    if (/No devices were found|No matching devices found/i.test(stdout)) {
      return 'No problem devices reported';
    }

    const problemMatches = stdout.match(/Instance ID:/gi);
    return problemMatches?.length ? `${problemMatches.length} problem device${problemMatches.length === 1 ? '' : 's'}` : 'No problem devices reported';
  }
}
