import { execFile } from 'node:child_process';
import os from 'node:os';
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
}

export interface GpuInfo {
  provider: 'nvml' | 'wmi' | 'unavailable';
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
  const command = `$ProgressPreference='SilentlyContinue'; $ErrorActionPreference='SilentlyContinue'; ${script} | ConvertTo-Json -Depth 8 -Compress`;

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

    return temp && temp > 0 && temp < 120 ? temp : null;
  }

  async getProcesses(): Promise<ProcessRow[]> {
    const raw = await runPowerShellJson<unknown>(
      'Get-Process | Select-Object Id,ProcessName,CPU,WorkingSet64,@{Name="ThreadCount";Expression={$_.Threads.Count}},@{Name="StartTimeUtc";Expression={try {$_.StartTime.ToUniversalTime().ToString("o")} catch {$null}}}',
      4500
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
          startTimeMs: typeof record?.StartTimeUtc === 'string' ? Date.parse(record.StartTimeUtc) : null
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
    const nvidia = await this.getNvidiaSmiInfo();
    if (nvidia.name || nvidia.utilizationPercent !== null) {
      return nvidia;
    }

    const [video, utilization, vramUsedBytes] = await Promise.all([this.getVideoControllerInfo(), this.getGpuCounterUtilization(), this.getGpuMemoryUsageBytes()]);

    if (!video.name && video.vramTotalBytes === null && utilization === null) {
      return this.emptyGpuInfo();
    }

    return {
      provider: 'wmi',
      ...video,
      utilizationPercent: utilization,
      coreClockGhz: null,
      memoryClockGhz: null,
      powerDrawW: null,
      temperatureC: null,
      vramUsedBytes,
      vramTotalBytes: video.vramTotalBytes,
      encoderUsagePercent: null
    };
  }

  private async getNvidiaSmiInfo(): Promise<GpuInfo> {
    const stdout = await runText(
      'nvidia-smi',
      [
        '--query-gpu=name,utilization.gpu,utilization.encoder,clocks.current.graphics,clocks.current.memory,power.draw,temperature.gpu,memory.used,memory.total',
        '--format=csv,noheader,nounits'
      ],
      2500
    );

    if (!stdout) {
      return this.emptyGpuInfo();
    }

    const values = stdout
      .split(/\r?\n/)[0]
      ?.split(',')
      .map((part) => part.trim());

    if (!values || values.length < 9) {
      return this.emptyGpuInfo();
    }

    const coreClockMhz = toNumber(values[3]);
    const memoryClockMhz = toNumber(values[4]);
    const vramUsedMb = toNumber(values[7]);
    const vramTotalMb = toNumber(values[8]);

    return {
      provider: 'nvml',
      name: values[0] || null,
      utilizationPercent: toNumber(values[1]),
      coreClockGhz: coreClockMhz === null ? null : coreClockMhz / 1000,
      memoryClockGhz: memoryClockMhz === null ? null : memoryClockMhz / 1000,
      powerDrawW: toNumber(values[5]),
      temperatureC: toNumber(values[6]),
      vramUsedBytes: vramUsedMb === null ? null : vramUsedMb * 1024 * 1024,
      vramTotalBytes: vramTotalMb === null ? null : vramTotalMb * 1024 * 1024,
      encoderUsagePercent: toNumber(values[2])
    };
  }

  private async getVideoControllerInfo(): Promise<Pick<GpuInfo, 'name' | 'vramTotalBytes'>> {
    const raw = await runPowerShellJson<unknown>(
      'Get-CimInstance Win32_VideoController | Sort-Object AdapterRAM -Descending | Select-Object -First 1 Name,AdapterRAM',
      3500
    );
    const record = firstRecord(raw);

    return {
      name: typeof record?.Name === 'string' ? record.Name : null,
      vramTotalBytes: toNumber(record?.AdapterRAM)
    };
  }

  private async getGpuCounterUtilization(): Promise<number | null> {
    const raw = await runPowerShellJson<unknown>(
      "$samples = (Get-Counter '\\GPU Engine(*)\\Utilization Percentage').CounterSamples | Where-Object {$_.InstanceName -match 'engtype_3D'}; if ($samples) { [math]::Round(($samples | Measure-Object CookedValue -Sum).Sum, 1) }",
      2500
    );
    const value = toNumber(raw);
    return value === null ? null : Math.max(0, Math.min(100, value));
  }

  private async getGpuMemoryUsageBytes(): Promise<number | null> {
    const raw = await runPowerShellJson<unknown>(
      "$samples = (Get-Counter '\\GPU Adapter Memory(*)\\Dedicated Usage').CounterSamples; if ($samples) { [math]::Round(($samples | Measure-Object CookedValue -Sum).Sum, 0) }",
      2500
    );
    const value = toNumber(raw);
    return value === null || value < 0 ? null : value;
  }

  private emptyGpuInfo(): GpuInfo {
    return {
      provider: 'unavailable',
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

  async getStorageInfo(): Promise<StorageInfo> {
    const raw = await runPowerShellJson<unknown>(
      "$disk = Get-PhysicalDisk | Select-Object -First 1 FriendlyName,HealthStatus,Size; $rel = $null; try { $rel = Get-PhysicalDisk | Select-Object -First 1 | Get-StorageReliabilityCounter } catch {}; [pscustomobject]@{ Label=$disk.FriendlyName; Health=$disk.HealthStatus; Size=$disk.Size; Temperature=$rel.Temperature; PowerOnHours=$rel.PowerOnHours; Wear=$rel.Wear; HostWrites=$rel.HostWrites }",
      4500
    );
    const record = firstRecord(raw);
    const health = typeof record?.Health === 'string' ? record.Health : null;
    const wear = toNumber(record?.Wear);
    const healthPercent = wear === null ? null : Math.max(0, Math.min(100, 100 - wear));

    return {
      label: typeof record?.Label === 'string' ? record.Label : null,
      healthPercent,
      healthGrade: health,
      temperatureC: toNumber(record?.Temperature),
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
    const stdout = await runText('netsh', ['wlan', 'show', 'interfaces'], 2500);
    const match = stdout?.match(/^\s*Signal\s*:\s*(\d+)%/im);
    const percent = match ? Number.parseInt(match[1], 10) : null;

    return percent === null ? null : Math.round(-100 + percent / 2);
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
      "$battery = Get-CimInstance Win32_Battery | Select-Object -First 1; $full = Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity | Select-Object -First 1; $design = Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData | Select-Object -First 1; $cycles = Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount | Select-Object -First 1; $result = if ($battery) { [pscustomobject]@{Level=$battery.EstimatedChargeRemaining;Status=$battery.BatteryStatus;Remaining=$battery.EstimatedRunTime;Full=$full.FullChargedCapacity;Design=$design.DesignedCapacity;Cycles=$cycles.CycleCount} } else { [pscustomobject]@{Level=$null;Status=$null;Remaining=$null;Full=$null;Design=$null;Cycles=$null} }; $result",
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
    const raw = await runPowerShellJson<unknown>(
      "$sensors = @(Get-CimInstance -Namespace root/OpenHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue) + @(Get-CimInstance -Namespace root/LibreHardwareMonitor -ClassName Sensor -ErrorAction SilentlyContinue); function FirstSensor($type, [string[]]$patterns) { $items = @($sensors | Where-Object {$_.SensorType -eq $type}); foreach ($pattern in $patterns) { $match = $items | Where-Object { ($_.Name -match $pattern) -or ($_.Identifier -match $pattern) -or ($_.Parent -match $pattern) } | Select-Object -First 1; if ($match) { return $match.Value } }; return $null }; [pscustomobject]@{CpuFan=(FirstSensor 'Fan' @('CPU','Processor')); GpuFan=(FirstSensor 'Fan' @('GPU','Graphics')); CpuTemp=(FirstSensor 'Temperature' @('CPU Package','CPU Core','Core Max','Tctl','Tdie','CPU')); GpuTemp=(FirstSensor 'Temperature' @('GPU Core','GPU')); SsdTemp=(FirstSensor 'Temperature' @('NVMe','SSD','HDD','Drive','Disk')); CpuPower=(FirstSensor 'Power' @('CPU Package','CPU Cores','Processor')); GpuPower=(FirstSensor 'Power' @('GPU Package','GPU'))}",
      3500
    );
    const record = firstRecord(raw);

    return {
      cpuFanRpm: toNumber(record?.CpuFan),
      gpuFanRpm: toNumber(record?.GpuFan),
      cpuTemperatureC: toNumber(record?.CpuTemp),
      gpuTemperatureC: toNumber(record?.GpuTemp),
      ssdTemperatureC: toNumber(record?.SsdTemp),
      cpuPackagePowerW: toNumber(record?.CpuPower),
      gpuPowerW: toNumber(record?.GpuPower)
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
    return match?.[1] ?? null;
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
