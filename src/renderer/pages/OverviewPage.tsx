import clsx from 'clsx';
import {
  Activity,
  AlertCircle,
  BatteryCharging,
  CheckCircle2,
  Cpu,
  Download,
  Fan,
  Gauge as GaugeIcon,
  HardDrive,
  Info,
  LineChart as LineChartIcon,
  ListChecks,
  MemoryStick,
  Network,
  ShieldCheck,
  Upload,
  Zap
} from 'lucide-react';
import type {
  DisplayCpuCardModel,
  DisplayGpuCardModel,
  DisplayNetworkCardModel,
  DisplayOverviewCards,
  DisplayPowerBatteryCardModel,
  DisplayProcessMetric,
  DisplayRamCardModel,
  DisplayStorageCardModel,
  DisplaySystemHealthCardModel,
  DisplaySystemInformationCardModel,
  DisplayThermalSensor,
  DisplayThermalsFansCardModel,
  DisplayTrendsCardModel,
  TimePoint,
  Tone
} from '@shared/models';
import { Gauge, GlassCard, Meter, MetricRow, ProcessIcon, Sparkline, Stat, TinyButton, toneClass } from '@renderer/components/Primitives';

const reportInteraction = (action: string, detail?: unknown) => {
  console.info(`[Performance Monitor] ${action}`, detail ?? '');
};

interface OverviewPageProps {
  cards: DisplayOverviewCards;
  visiblePanels: Record<keyof DisplayOverviewCards, boolean>;
  onTogglePanel: (panel: keyof DisplayOverviewCards) => void;
}

export function OverviewPage({ cards, visiblePanels, onTogglePanel }: OverviewPageProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-normal text-ink">System Overview</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => reportInteraction('Customize clicked')}
            className="no-drag flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.035] px-3 text-[12px] text-ink transition hover:bg-white/[0.065]"
          >
            <GaugeIcon size={15} />
            Customize
          </button>
          <TinyButton title="Panel visibility" onClick={() => onTogglePanel('trends')}>
            <ListChecks size={15} />
          </TinyButton>
        </div>
      </div>

      <div className="dashboard-grid">
        {visiblePanels.cpu ? <CpuCard cpu={cards.cpu} /> : null}
        {visiblePanels.gpu ? <GpuCard gpu={cards.gpu} /> : null}
        {visiblePanels.ram ? <RamCard ram={cards.ram} /> : null}
        {visiblePanels.storage ? <StorageCard storage={cards.storage} /> : null}
        {visiblePanels.network ? <NetworkCard network={cards.network} /> : null}
        {visiblePanels.powerBattery ? <PowerBatteryCard power={cards.powerBattery} /> : null}
        {visiblePanels.thermalsFans ? <ThermalsFansCard thermals={cards.thermalsFans} /> : null}
        {visiblePanels.topProcesses ? <TopProcessesCard processes={cards.topProcesses} /> : null}
        {visiblePanels.systemHealth ? <SystemHealthCard health={cards.systemHealth} /> : null}
        {visiblePanels.trends ? <TrendsCard trends={cards.trends} /> : null}
        {visiblePanels.systemInformation ? <SystemInformationCard info={cards.systemInformation} /> : null}
      </div>

      {visiblePanels.footer ? <FooterStrip cards={cards} /> : null}
    </div>
  );
}

function CpuCard({ cpu }: { cpu: DisplayCpuCardModel }) {
  return (
    <GlassCard className="dashboard-wide" title="CPU" subtitle={cpu.deviceLabel} icon={Cpu} tone="blue">
      <div className="grid grid-cols-[minmax(148px,188px)_minmax(0,1fr)] gap-4 max-md:grid-cols-1">
        <Gauge value={cpu.utilization.value} valueLabel={cpu.utilization.label} label="Utilization" tone="blue" size={186} />
        <div className="grid grid-cols-2 content-start gap-3">
          <PlainStat label="Current Clock" value={cpu.currentClock.label} />
          <PlainStat label="Package Power" value={cpu.packagePower.label} />
          <PlainStat label="Max Boost" value={cpu.maxBoost.label} />
          <PlainStat label="Temperature" value={cpu.temperature.label} />
        </div>
      </div>

      <div className="mt-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-ink">Per-Core Usage</span>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <LegendDot tone="blue" label={`P-Core ${cpu.pCoreUsageAveragePercent.label}`} />
            <LegendDot tone="cyan" label={`E-Core ${cpu.eCoreUsageAveragePercent.label}`} />
            <span className={clsx('ml-1', toneClass[cpu.status.tone ?? 'green'].text)}>Status: {cpu.status.label}</span>
          </div>
        </div>
        <div className="flex h-[74px] items-end gap-1.5 border-b border-white/10 pb-1.5">
          {cpu.perCoreUsage.map((core) => (
            <div key={core.id} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-[56px] w-full items-end rounded-sm bg-white/[0.035]">
                <div
                  className={clsx('w-full rounded-sm transition-all duration-500', core.tone === 'blue' ? 'bg-cpu shadow-glowBlue' : 'bg-net/80')}
                  style={{ height: `${core.usagePercent}%` }}
                  title={core.usageLabel}
                />
              </div>
              <span className="text-[9px] text-muted">{core.label}</span>
            </div>
          ))}
        </div>
      </div>

      <ChartBlock title="Utilization Over Time (60 sec)" tone="blue" data={cpu.utilizationHistory} />

      <div className="mt-2.5 grid grid-cols-5 divide-x divide-white/10 rounded-lg border border-white/10 bg-white/[0.022] max-lg:grid-cols-3">
        <FooterMetric label="Load" value={cpu.load.label} />
        <FooterMetric label="P-Core Avg." value={cpu.pCoreAverage.label} />
        <FooterMetric label="E-Core Avg." value={cpu.eCoreAverage.label} />
        <FooterMetric label="Threads" value={cpu.threads.label} />
        <FooterMetric label="Processes" value={cpu.processes.label} />
      </div>
    </GlassCard>
  );
}

function GpuCard({ gpu }: { gpu: DisplayGpuCardModel }) {
  return (
    <GlassCard className="dashboard-wide" title="GPU" subtitle={gpu.deviceLabel} icon={Zap} tone="green">
      <div className="grid grid-cols-[minmax(148px,188px)_minmax(0,1fr)_minmax(180px,250px)] gap-4 max-2xl:grid-cols-[minmax(148px,188px)_minmax(0,1fr)] max-lg:grid-cols-1">
        <Gauge value={gpu.utilization.value} valueLabel={gpu.utilization.label} label="Utilization" tone="green" size={186} />
        <div className="space-y-2.5">
          <div className="grid grid-cols-2 gap-3">
            <PlainStat label="Core Clock" value={gpu.coreClock.label} />
            <PlainStat label="Memory Clock" value={gpu.memoryClock.label} />
            <PlainStat label="Power Draw" value={gpu.powerDraw.label} />
            <PlainStat label="Temperature" value={gpu.temperature.label} />
          </div>
          <ChartBlock title="Frametime (ms)" tone="green" data={gpu.frametimeHistory} yDomain={[0, 50]} />
          <div className="flex items-center gap-2 text-[12px]">
            <span className="size-2 rounded-full bg-warn" />
            <span className="text-muted">Status</span>
            <span className="text-ink">{gpu.status.label}</span>
          </div>
        </div>
        <div className="space-y-4 border-l border-white/10 pl-4 max-2xl:col-span-2 max-2xl:border-l-0 max-2xl:pl-0 max-lg:col-span-1">
          <div className="space-y-3">
            <Meter label="Core Usage" value={gpu.coreUsage.value} valueLabel={gpu.coreUsage.label} tone="green" />
            <Meter label="VRAM Usage" value={gpu.vramUsagePercent.value} valueLabel={gpu.vramUsagePercent.label} tone="green" rightLabel={gpu.vramUsage.label} />
            <Meter label="Encoder Usage" value={gpu.encoderUsage.value} valueLabel={gpu.encoderUsage.label} tone="green" />
          </div>
          <ProcessMiniList title="Top GPU Processes" processes={gpu.topProcesses} value={(process) => process.gpuLabel} />
          <button onClick={() => reportInteraction('View all GPU processes clicked')} className="text-[12px] text-cpu transition hover:text-white">View all</button>
        </div>
      </div>
    </GlassCard>
  );
}

function RamCard({ ram }: { ram: DisplayRamCardModel }) {
  return (
    <GlassCard title="RAM" icon={MemoryStick} tone="purple">
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div>
          <div className="text-[30px] font-semibold leading-none text-ink">{ram.inUse.label}</div>
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>In Use</span>
            <span className="text-ink">{ram.usedTotalLabel}</span>
          </div>
          <div className="mt-3 space-y-2.5">
            <Meter label="In Use" value={ram.inUse.value} valueLabel={ram.inUse.label} tone="purple" rightLabel={ram.used.label} compact />
            <Meter label="Cached" value={ram.cachedPercent.value} valueLabel={ram.cachedPercent.label} tone="blue" rightLabel={ram.cached.label} compact />
            <Meter label="Free" value={ram.freePercent.value} valueLabel={ram.freePercent.label} tone="slate" rightLabel={ram.free.label} compact />
          </div>
        </div>
        <div>
          <p className="mb-2 text-[12px] font-medium text-ink">Top Memory Processes</p>
          <div className="space-y-1.5">
            {ram.topProcesses.map((process) => (
              <ProcessLine key={process.id} id={process.id} name={process.name} value={process.memoryLabel} />
            ))}
          </div>
        </div>
      </div>
      <div className="mt-4 flex items-center justify-between">
        <span className="text-[12px] font-medium text-ink">Memory Trend (60 min)</span>
        <span className={clsx('inline-flex items-center gap-1 text-[11px]', toneClass[ram.stability.tone ?? 'green'].text)}><CheckCircle2 size={12} /> {ram.stability.label}</span>
      </div>
      <Sparkline data={ram.trendHistory} tone="purple" height={76} area />
    </GlassCard>
  );
}

function StorageCard({ storage }: { storage: DisplayStorageCardModel }) {
  return (
    <GlassCard title="Storage" subtitle={storage.deviceLabel} icon={HardDrive} tone="lime">
      <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-3">
        <div className="grid grid-cols-2 gap-2.5">
          <Stat label="Read Speed" value={storage.readSpeed.label} tone="slate" />
          <Stat label="Write Speed" value={storage.writeSpeed.label} tone="slate" />
          <Stat label="Latency" value={storage.latency.label} tone="slate" />
          <Stat label="Queue Depth" value={storage.queueDepth.label} tone="slate" />
          <Stat label="Temperature" value={storage.temperature.label} tone="slate" />
        </div>
        <div className="rounded-lg border border-disk/25 bg-disk/10 p-2.5 text-center">
          <p className="text-[11px] text-muted">Health</p>
          <div className="mt-1 text-[25px] font-semibold text-disk">{storage.health.label}</div>
          <p className="text-[11px] text-disk">{storage.healthGrade.label}</p>
          <div className="mt-4 border-t border-white/10 pt-3 text-[11px] text-muted">
            <p>TBW</p>
            <p className="mt-1 text-ink">{storage.tbw.label}</p>
            <p className="mt-3">Power On Hours</p>
            <p className="mt-1 text-ink">{storage.powerOnHours.label}</p>
          </div>
        </div>
      </div>
      <ChartBlock title="Disk Activity (60 sec)" tone="blue" secondaryTone="purple" data={storage.activityHistory} />
      {storage.activeProcess ? (
        <div className="mt-2.5 text-[11px] text-muted">
          <p>Active Process</p>
          <p className="mt-1 truncate text-ink">{storage.activeProcess.name}</p>
          <p className="mt-1">Read: <span className="text-ink">{storage.activeProcess.readLabel}</span> <span className="ml-4">Write: <span className="text-ink">{storage.activeProcess.writeLabel}</span></span></p>
        </div>
      ) : null}
    </GlassCard>
  );
}

function NetworkCard({ network }: { network: DisplayNetworkCardModel }) {
  return (
    <GlassCard title="Network" subtitle={network.adapterLabel} icon={Network} tone="cyan">
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
          <div className="flex items-center gap-2 text-cpu"><Download size={23} /><span className="text-[11px] text-muted">Download</span></div>
          <div className="mt-1.5 text-[20px] font-semibold text-cpu">{network.downloadRate.label}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
          <div className="flex items-center gap-2 text-gpu"><Upload size={23} /><span className="text-[11px] text-muted">Upload</span></div>
          <div className="mt-1.5 text-[20px] font-semibold text-gpu">{network.uploadRate.label}</div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2.5">
        <TinyMetric label="Latency" value={network.latency.label} />
        <TinyMetric label="Jitter" value={network.jitter.label} />
        <TinyMetric label="Packet Loss" value={network.packetLoss.label} />
        <TinyMetric label="Signal" value={network.signal.label} extra={network.signalLabel.label} />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <NetworkUsageList items={network.topUsage} />
        <div>
          <p className="mb-1.5 text-[12px] font-medium text-ink">Live Graph (60 sec)</p>
          <Sparkline data={network.history} tone="blue" secondaryTone="green" height={78} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-4 divide-x divide-white/10 rounded-lg border border-white/10 bg-white/[0.022]">
        <FooterMetric label="Connections" value={network.connections.label} />
        <FooterMetric label="DNS" value={network.dns.label} />
        <FooterMetric label="IPv4" value={network.ipv4.label} />
        <FooterMetric label="Public IP" value={network.publicIp.label} />
      </div>
    </GlassCard>
  );
}

function PowerBatteryCard({ power }: { power: DisplayPowerBatteryCardModel }) {
  return (
    <GlassCard title="Power & Battery" icon={BatteryCharging} tone="green" action={<span className={clsx('text-[11px]', toneClass[power.acStatus.tone ?? 'green'].text)}>{power.acStatus.label}</span>}>
      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div>
          <div className="text-[30px] font-semibold leading-none text-ink">{power.batteryLevel.label}</div>
          <p className="mt-1 text-[11px] text-muted">Battery Level</p>
          <div className="mt-2.5 h-1.5 rounded-full bg-white/10">
            <div className="h-full rounded-full bg-gpu transition-all" style={{ width: `${power.batteryLevel.value ?? 0}%` }} />
          </div>
          <div className="mt-4 space-y-2.5">
            <TinyMetric label="Battery Health" value={power.batteryHealth.label} />
            <TinyMetric label="Cycle Count" value={power.cycleCount.label} />
            <TinyMetric label="Full Charge Capacity" value={power.fullChargeCapacity.label} />
          </div>
        </div>
        <div className="border-l border-white/10 pl-4">
          <p className="text-[11px] text-muted">Total System Power</p>
          <div className="text-[25px] font-semibold text-ink">{power.totalSystemPower.label}</div>
          <Sparkline data={power.powerHistory} tone="green" height={46} />
          <div className="grid grid-cols-2 gap-2.5">
            <TinyMetric label="CPU" value={power.cpuPower.label} />
            <TinyMetric label="GPU" value={power.gpuPower.label} />
          </div>
          <div className="mt-4">
            <p className="text-[11px] text-muted">Estimated Remaining</p>
            <p className="mt-1 text-[20px] font-semibold text-ink">{power.estimatedRemaining.label}</p>
            <p className="text-[11px] text-muted">At current usage</p>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

function ThermalsFansCard({ thermals }: { thermals: DisplayThermalsFansCardModel }) {
  return (
    <GlassCard title="Thermals & Fans" icon={Fan} tone="orange">
      <div className="grid grid-cols-3 gap-2.5">
        {thermals.sensors.map((sensor) => (
          <TempBox key={sensor.id} sensor={sensor} />
        ))}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_1fr_1.35fr] gap-3">
        <RadialMini label="CPU Fan" value={thermals.cpuFan.label} />
        <RadialMini label="GPU Fan" value={thermals.gpuFan.label} />
        <div className="border-l border-white/10 pl-3">
          <p className="text-[11px] text-muted">Cooling vs Efficiency</p>
          <p className={clsx('mt-1 text-[15px] font-semibold', toneClass[thermals.coolingLabel.tone ?? 'green'].text)}>{thermals.coolingLabel.label}</p>
          <Sparkline data={thermals.coolingHistory} tone="green" height={54} />
        </div>
      </div>
      <div className="mt-3 flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] text-muted">Noise Level</p>
          <p className="mt-1 text-[18px] font-semibold text-gpu">{thermals.noiseLevel.label}</p>
        </div>
        <div className="flex-1">
          <Sparkline data={thermals.noiseHistory} tone="green" height={34} yDomain={[20, 50]} />
        </div>
      </div>
    </GlassCard>
  );
}

function TopProcessesCard({ processes }: { processes: DisplayProcessMetric[] }) {
  return (
    <GlassCard title="Top Processes" icon={ListChecks} tone="blue">
      <div className="grid grid-cols-[1fr_58px_68px_52px] border-b border-white/10 pb-1.5 text-[11px] text-muted">
        <span>Process</span>
        <span className="text-right">CPU</span>
        <span className="text-right">RAM</span>
        <span className="text-right">GPU</span>
      </div>
      <div className="mt-2 space-y-1.5">
        {processes.slice(0, 6).map((process) => (
          <button
            key={process.id}
            onClick={() => reportInteraction('Process selected', { id: process.id, name: process.name })}
            className="grid grid-cols-[1fr_58px_68px_52px] items-center gap-2 rounded-md px-1 py-0.5 text-left text-[12px] transition hover:bg-white/[0.05]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ProcessIcon name={process.name} />
              <span className="truncate text-ink">{process.name}</span>
            </span>
            <span className="text-right text-muted">{process.cpuLabel}</span>
            <span className="text-right text-muted">{process.ramLabel}</span>
            <span className="text-right text-muted">{process.gpuLabel}</span>
          </button>
        ))}
      </div>
      <button onClick={() => reportInteraction('View all processes clicked')} className="mt-4 h-9 w-full rounded-lg border border-white/10 bg-white/[0.025] text-[12px] text-cpu transition hover:bg-white/[0.06] hover:text-white">View All Processes</button>
    </GlassCard>
  );
}

function SystemHealthCard({ health }: { health: DisplaySystemHealthCardModel }) {
  return (
    <GlassCard title="System Health" icon={ShieldCheck} tone="blue">
      <div className="grid grid-cols-[1fr_1.2fr] gap-4">
        <div className="space-y-2.5">
          {health.items.map((item) => (
            <div key={item.label} className="flex items-start gap-2.5">
              <CheckCircle2 className={toneClass[item.tone].text} size={16} />
              <div>
                <p className="text-[11px] text-muted">{item.label}</p>
                <p className={clsx('text-[12px] font-medium', toneClass[item.tone].text)}>{item.status}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
          <p className="text-[12px] font-medium text-ink">Recent Alerts</p>
          {health.recentAlerts.map((alert) => (
            <div key={alert.id} className="mt-3">
              <div className={clsx('flex items-center gap-2', alert.severity === 'info' ? 'text-gpu' : 'text-warn')}>
                {alert.severity === 'info' ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
                <span className="text-[11px] font-medium">{alert.title}</span>
              </div>
              <p className="mt-1.5 text-[11px] text-muted">{alert.detail}</p>
            </div>
          ))}
          <button onClick={() => reportInteraction('View all alerts clicked')} className="mt-5 text-[11px] text-cpu hover:text-white">View all alerts</button>
        </div>
      </div>
    </GlassCard>
  );
}

function TrendsCard({ trends }: { trends: DisplayTrendsCardModel }) {
  return (
    <GlassCard title="Trends" subtitle="Last 60 Minutes" icon={LineChartIcon} tone="blue">
      <div className="space-y-2.5">
        {trends.lines.map((line) => (
          <div key={line.label} className="grid grid-cols-[40px_44px_1fr] items-center gap-2.5">
            <span className="text-[13px] font-medium text-ink">{line.label}</span>
            <span className={clsx('text-[12px]', toneClass[line.tone].text)}>{line.value.label}</span>
            <Sparkline data={line.history} tone={line.tone} height={34} />
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function SystemInformationCard({ info }: { info: DisplaySystemInformationCardModel }) {
  return (
    <GlassCard title="System Information" icon={Info} tone="blue">
      <div className="space-y-0.5">
        <MetricRow label="Device Name" value={info.deviceName.label} />
        <MetricRow label="Operating System" value={info.operatingSystem.label} />
        <MetricRow label="Motherboard" value={info.motherboard.label} />
        <MetricRow label="BIOS Version" value={info.biosVersion.label} />
        <MetricRow label="Uptime" value={info.uptime.label} />
        <MetricRow label="Last Boot" value={info.lastBoot.label} />
        <MetricRow label="Drivers" value={<span className={clsx('inline-flex items-center gap-1', toneClass[info.driversStatus.tone ?? 'green'].text)}>{info.driversStatus.label} <CheckCircle2 size={12} /></span>} />
      </div>
    </GlassCard>
  );
}

function FooterStrip({ cards }: { cards: DisplayOverviewCards }) {
  const footer = cards.footer;

  return (
    <footer className="glass-card rounded-2xl px-5 py-3.5">
      <div className="relative z-10 grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr] items-center gap-4 max-lg:grid-cols-2">
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-gpu/20 text-gpu"><CheckCircle2 size={20} /></span>
          <div>
            <p className="text-[14px] font-semibold text-ink">{footer.healthLabel}</p>
            <p className="text-[12px] text-muted">{footer.statusLine}</p>
          </div>
        </div>
        <FooterSummary label="Total Uptime" value={footer.uptime.label} />
        <FooterSummary label="Total Data Read" value={footer.totalDataRead.label} />
        <FooterSummary label="Total Data Written" value={footer.totalDataWritten.label} />
        <div className="flex items-center justify-end gap-3">
          <span className="grid size-9 place-items-center rounded-full bg-cpu text-white"><Activity size={18} /></span>
          <div>
            <p className="text-[12px] text-muted">Activity</p>
            <div className="mt-1 flex gap-1">
              {Array.from({ length: footer.activityDotTotal }).map((_, index) => (
                <span key={index} className={clsx('size-2 rounded-full', index < footer.activityDotCount ? 'bg-cpu' : 'bg-white/10')} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}

function ChartBlock({ title, data, tone, secondaryTone, yDomain }: { title: string; data: TimePoint[]; tone: Tone; secondaryTone?: Tone; yDomain?: [number, number] }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-[12px] font-medium text-ink">{title}</p>
      <Sparkline data={data} tone={tone} secondaryTone={secondaryTone} height={72} yDomain={yDomain} />
      <div className="mt-0.5 flex justify-between text-[9px] text-muted">
        <span>60 sec</span>
        <span>45 sec</span>
        <span>30 sec</span>
        <span>15 sec</span>
        <span>0 sec</span>
      </div>
    </div>
  );
}

function ProcessMiniList({ title, processes, value }: { title: string; processes: DisplayProcessMetric[]; value: (process: DisplayProcessMetric) => string }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-ink">{title}</p>
      <div className="space-y-1.5">
        {processes.slice(0, 4).map((process) => (
          <button
            key={process.id}
            onClick={() => reportInteraction('Process selected', { id: process.id, name: process.name })}
            className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left text-[12px] transition hover:bg-white/[0.05]"
          >
            <span className="flex min-w-0 items-center gap-2">
              <ProcessIcon name={process.name} />
              <span className="truncate text-muted">{process.name}</span>
            </span>
            <span className="shrink-0 text-ink">{value(process)}</span>
          </button>
        ))}
        {!processes.length ? <p className="text-[11px] text-muted">No process telemetry available</p> : null}
      </div>
    </div>
  );
}

function NetworkUsageList({ items }: { items: Array<{ id: string; name: string; rateLabel: string }> }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-ink">Top Network Usage</p>
      <div className="space-y-1.5">
        {items.map((item) => (
          <button key={item.id} onClick={() => reportInteraction('Network usage row selected', item)} className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left text-[12px] transition hover:bg-white/[0.05]">
            <span className="flex min-w-0 items-center gap-2">
              <ProcessIcon name={item.name} />
              <span className="truncate text-muted">{item.name}</span>
            </span>
            <span className="shrink-0 text-ink">{item.rateLabel}</span>
          </button>
        ))}
        {!items.length ? <p className="text-[11px] text-muted">No network process telemetry available</p> : null}
      </div>
    </div>
  );
}

function ProcessLine({ id, name, value }: { id: string; name: string; value: string }) {
  return (
    <button onClick={() => reportInteraction('Process selected', { id, name })} className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-0.5 text-left text-[12px] transition hover:bg-white/[0.05]">
      <span className="flex min-w-0 items-center gap-2">
        <ProcessIcon name={name} />
        <span className="truncate text-muted">{name}</span>
      </span>
      <span className="shrink-0 text-ink">{value}</span>
    </button>
  );
}

function LegendDot({ tone, label }: { tone: 'blue' | 'cyan'; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={clsx('size-2 rounded-full', tone === 'blue' ? 'bg-cpu' : 'bg-net')} />
      {label}
    </span>
  );
}

function PlainStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[18px] font-semibold leading-5 text-ink">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  );
}

function FooterMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 px-2.5 py-2">
      <p className="truncate text-[10px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[13px] font-medium text-ink">{value}</p>
    </div>
  );
}

function TinyMetric({ label, value, extra }: { label: string; value: string; extra?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[10px] text-muted">{label}</p>
      <p className="mt-0.5 truncate text-[14px] font-semibold text-ink">{value}</p>
      {extra ? <p className="mt-0.5 truncate text-[10px] text-gpu">{extra}</p> : null}
    </div>
  );
}

function TempBox({ sensor }: { sensor: DisplayThermalSensor }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-2.5 text-center">
      <p className="text-[11px] text-muted">{sensor.label}</p>
      <p className="mt-1 text-[18px] font-semibold text-ink">{sensor.temperature.label}</p>
      <p className={clsx('mt-0.5 text-[11px]', toneClass[sensor.status.tone ?? 'green'].text)}>{sensor.status.label}</p>
    </div>
  );
}

function RadialMini({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="mb-1.5 text-center text-[11px] text-muted">{label}</p>
      <div className="mx-auto grid size-[70px] place-items-center rounded-full border border-cpu/25 bg-cpu/10 shadow-glowBlue">
        <div className="text-center">
          <p className="text-[17px] font-semibold leading-5 text-ink">{value}</p>
        </div>
      </div>
    </div>
  );
}

function FooterSummary({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-0.5 text-[15px] font-semibold text-ink">{value}</p>
    </div>
  );
}
