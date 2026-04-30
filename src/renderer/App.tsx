import { useEffect, type ComponentType, type ReactNode } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Bell,
  CheckCircle2,
  Grid2X2,
  HardDrive,
  Maximize,
  MemoryStick,
  Minus,
  Moon,
  MoreVertical,
  Network,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  Thermometer,
  X,
  Zap
} from 'lucide-react';
import type { LucideProps } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { tabs, type TabId } from '@shared/navigation';
import type { DisplayOverviewCards, PerformanceSnapshot, StatusChip, TimePoint, Tone, WindowAction } from '@shared/models';
import { useMonitorStore } from '@renderer/store/useMonitorStore';
import { OverviewPage } from '@renderer/pages/OverviewPage';
import { GlassCard, MetricRow, Sparkline, TinyButton, toneClass } from '@renderer/components/Primitives';

export default function App() {
  const { snapshot, selectedTab, settings, isRefreshing, error, setTab, fetchSnapshot, togglePanel } = useMonitorStore(
    useShallow((state) => ({
      snapshot: state.snapshot,
      selectedTab: state.selectedTab,
      settings: state.settings,
      isRefreshing: state.isRefreshing,
      error: state.error,
      setTab: state.setTab,
      fetchSnapshot: state.fetchSnapshot,
      togglePanel: state.togglePanel
    }))
  );

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchSnapshot();
    }, settings.fastRefreshMs);

    return () => window.clearInterval(interval);
  }, [fetchSnapshot, settings.fastRefreshMs]);

  if (!snapshot) {
    return <LoadingShell error={error} onRefresh={fetchSnapshot} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-app text-ink">
      <TopBar snapshot={snapshot} />
      <TabBar selectedTab={selectedTab} onSelect={setTab} snapshot={snapshot} isRefreshing={isRefreshing} onRefresh={fetchSnapshot} />
      <main className="scrollbar-dark flex-1 overflow-auto px-5 pb-5 pt-4">
        {selectedTab === 'Overview' ? (
          <OverviewPage cards={snapshot.display.overview} visiblePanels={settings.visiblePanels} onTogglePanel={togglePanel} />
        ) : (
          <StubPage tab={selectedTab} cards={snapshot.display.overview} />
        )}
      </main>
    </div>
  );
}

function LoadingShell({ error, onRefresh }: { error: string | null; onRefresh: () => Promise<void> }) {
  return (
    <div className="grid h-screen place-items-center bg-app text-ink">
      <div className="glass-card w-[420px] rounded-2xl p-6 text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-xl bg-cpu text-white">
          <Activity size={24} />
        </div>
        <h1 className="mt-4 text-xl font-semibold">Performance Monitor</h1>
        <p className="mt-2 text-sm text-muted">{error ?? 'Loading system snapshot'}</p>
        <button onClick={() => void onRefresh()} className="mt-5 h-10 rounded-lg border border-white/10 bg-white/[0.05] px-5 text-sm text-ink hover:bg-white/[0.08]">
          Refresh
        </button>
      </div>
    </div>
  );
}

function TopBar({ snapshot }: { snapshot: PerformanceSnapshot }) {
  return (
    <header className="app-drag flex h-[68px] shrink-0 items-center border-b border-white/10 px-5">
      <div className="flex w-[250px] items-center gap-3">
        <div className="grid size-9 place-items-center rounded-lg bg-cpu text-white shadow-glowBlue">
          <Activity size={20} />
        </div>
        <div className="text-[17px] font-semibold tracking-normal">Performance Monitor</div>
      </div>

      <div className="mx-auto grid min-w-[620px] max-w-[730px] flex-1 grid-cols-3 overflow-hidden rounded-xl border border-white/10 bg-white/[0.035] shadow-glass">
        {snapshot.display.chips.map((chip, index) => (
          <StatusChipView key={chip.id} chip={chip} divided={index > 0} />
        ))}
      </div>

      <div className="no-drag ml-5 flex w-[252px] items-center justify-end gap-2">
        <TinyButton title="Notifications">
          <span className="relative">
            <Bell size={16} />
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-400" />
          </span>
        </TinyButton>
        <TinyButton title="Settings">
          <Settings size={16} />
        </TinyButton>
        <TinyButton title="More">
          <MoreVertical size={16} />
        </TinyButton>
        <WindowButton action="minimize">
          <Minus size={15} />
        </WindowButton>
        <WindowButton action="maximize">
          <Maximize size={14} />
        </WindowButton>
        <WindowButton action="close" danger>
          <X size={15} />
        </WindowButton>
      </div>
    </header>
  );
}

function StatusChipView({ chip, divided }: { chip: StatusChip; divided: boolean }) {
  const Icon = chip.id === 'health' ? CheckCircle2 : chip.id === 'power' ? Zap : SlidersHorizontal;
  const tone = toneClass[chip.tone];

  return (
    <div className={clsx('flex items-center gap-2.5 px-4 py-2.5', divided && 'border-l border-white/10')}>
      <span className={clsx('grid size-7 shrink-0 place-items-center rounded-full', tone.bg, tone.text)}>
        <Icon size={16} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] text-muted">{chip.label}</p>
        <p className={clsx('truncate text-[14px] font-semibold leading-5', tone.text)}>{chip.value}</p>
        <p className="truncate text-[10px] text-ink/80">{chip.detail}</p>
      </div>
    </div>
  );
}

function WindowButton({ action, danger, children }: { action: WindowAction; danger?: boolean; children: ReactNode }) {
  return (
    <button
      onClick={() => void window.performanceMonitor.windowAction(action)}
      className={clsx(
        'grid size-8 place-items-center rounded-lg text-muted transition',
        danger ? 'hover:bg-red-500 hover:text-white' : 'hover:bg-white/[0.08] hover:text-ink'
      )}
      title={action}
    >
      {children}
    </button>
  );
}

function TabBar({
  selectedTab,
  onSelect,
  snapshot,
  isRefreshing,
  onRefresh
}: {
  selectedTab: TabId;
  onSelect: (tab: TabId) => void;
  snapshot: PerformanceSnapshot;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
}) {
  return (
    <div className="flex h-[48px] shrink-0 items-end justify-between border-b border-white/10 px-5">
      <nav className="flex h-full items-end gap-6">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => onSelect(tab)}
            className={clsx(
              'relative h-full px-1 pt-4 text-[12px] transition',
              selectedTab === tab ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            {tab}
            {selectedTab === tab ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cpu shadow-glowBlue" /> : null}
          </button>
        ))}
      </nav>
      <div className="flex h-full items-center gap-2.5 text-[11px] text-muted">
        <span>Update: {snapshot.display.updateAgeLabel}</span>
        <button
          onClick={() => void onRefresh()}
          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={15} className={clsx(isRefreshing && 'animate-spin')} />
        </button>
        <TinyButton title="Grid">
          <Grid2X2 size={15} />
        </TinyButton>
        <TinyButton title="Theme">
          <Moon size={15} />
        </TinyButton>
      </div>
    </div>
  );
}

function StubPage({ tab, cards }: { tab: TabId; cards: DisplayOverviewCards }) {
  const panels = getStubPanels(tab, cards);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold">{tab}</h1>
        <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[11px] text-muted">Snapshot-backed summary</span>
      </div>
      <div className="grid grid-cols-12 gap-4">
        {panels.map((panel) => (
          <GlassCard key={panel.title} className="col-span-12 lg:col-span-4" title={panel.title} subtitle={panel.subtitle} icon={panel.icon} tone={panel.tone}>
            {panel.chart ? <Sparkline data={panel.chart.data} tone={panel.chart.tone} secondaryTone={panel.chart.secondaryTone} height={92} /> : null}
            <div className="mt-2 space-y-0.5">
              {panel.rows.map((row) => (
                <MetricRow key={row.label} label={row.label} value={row.value} />
              ))}
            </div>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}

interface StubPanel {
  title: string;
  subtitle: string;
  icon: ComponentType<LucideProps>;
  tone: Tone;
  chart?: {
    data: TimePoint[];
    tone: Tone;
    secondaryTone?: Tone;
  };
  rows: Array<{
    label: string;
    value: ReactNode;
  }>;
}

function getStubPanels(tab: TabId, cards: DisplayOverviewCards): StubPanel[] {
  if (tab === 'System') {
    return [
      {
        title: 'Processor',
        subtitle: cards.cpu.deviceLabel,
        icon: Activity,
        tone: 'blue',
        chart: { data: cards.cpu.utilizationHistory, tone: 'blue' },
        rows: [
          { label: 'Utilization', value: cards.cpu.utilization.label },
          { label: 'Current Clock', value: cards.cpu.currentClock.label },
          { label: 'Temperature', value: cards.cpu.temperature.label }
        ]
      },
      {
        title: 'Memory',
        subtitle: cards.ram.usedTotalLabel,
        icon: MemoryStick,
        tone: 'purple',
        chart: { data: cards.ram.trendHistory, tone: 'purple' },
        rows: [
          { label: 'In Use', value: cards.ram.inUse.label },
          { label: 'Cached', value: cards.ram.cached.label },
          { label: 'Free', value: cards.ram.free.label }
        ]
      },
      {
        title: 'Platform',
        subtitle: cards.systemInformation.deviceName.label,
        icon: CheckCircle2,
        tone: 'green',
        rows: [
          { label: 'Operating System', value: cards.systemInformation.operatingSystem.label },
          { label: 'Uptime', value: cards.systemInformation.uptime.label },
          { label: 'Drivers', value: cards.systemInformation.driversStatus.label }
        ]
      }
    ];
  }

  if (tab === 'Processes') {
    return cards.topProcesses.slice(0, 6).map((process) => ({
      title: process.name,
      subtitle: process.source,
      icon: Activity,
      tone: 'blue' as const,
      rows: [
        { label: 'CPU', value: process.cpuLabel },
        { label: 'RAM', value: process.ramLabel },
        { label: 'GPU', value: process.gpuLabel }
      ]
    }));
  }

  if (tab === 'Network') {
    return [
      {
        title: 'Adapter',
        subtitle: cards.network.adapterLabel,
        icon: Network,
        tone: 'cyan',
        chart: { data: cards.network.history, tone: 'blue', secondaryTone: 'green' },
        rows: [
          { label: 'Download', value: cards.network.downloadRate.label },
          { label: 'Upload', value: cards.network.uploadRate.label },
          { label: 'Latency', value: cards.network.latency.label }
        ]
      },
      {
        title: 'Connection',
        subtitle: cards.network.ipv4.label,
        icon: Network,
        tone: 'cyan',
        rows: [
          { label: 'DNS', value: cards.network.dns.label },
          { label: 'Public IP', value: cards.network.publicIp.label },
          { label: 'Connections', value: cards.network.connections.label }
        ]
      }
    ];
  }

  if (tab === 'Storage') {
    return [
      {
        title: 'Primary Disk',
        subtitle: cards.storage.deviceLabel,
        icon: HardDrive,
        tone: 'lime',
        chart: { data: cards.storage.activityHistory, tone: 'blue', secondaryTone: 'purple' },
        rows: [
          { label: 'Read', value: cards.storage.readSpeed.label },
          { label: 'Write', value: cards.storage.writeSpeed.label },
          { label: 'Health', value: `${cards.storage.health.label} ${cards.storage.healthGrade.label}` }
        ]
      }
    ];
  }

  if (tab === 'Sensors') {
    return [
      {
        title: 'Thermal Sensors',
        subtitle: cards.thermalsFans.coolingLabel.label,
        icon: Thermometer,
        tone: 'orange',
        rows: cards.thermalsFans.sensors.map((sensor) => ({
          label: sensor.label,
          value: `${sensor.temperature.label} ${sensor.status.label}`
        }))
      },
      {
        title: 'Fans',
        subtitle: 'Reported sensor values',
        icon: Thermometer,
        tone: 'orange',
        rows: [
          { label: 'CPU Fan', value: cards.thermalsFans.cpuFan.label },
          { label: 'GPU Fan', value: cards.thermalsFans.gpuFan.label },
          { label: 'Noise', value: cards.thermalsFans.noiseLevel.label }
        ]
      }
    ];
  }

  return [
    {
      title: 'Event Stream',
      subtitle: 'Current snapshot',
      icon: Activity,
      tone: 'slate',
      rows: [
        { label: 'Latest Health', value: cards.systemHealth.overallStatus.label },
        { label: 'CPU Status', value: cards.cpu.status.label },
        { label: 'GPU Status', value: cards.gpu.status.label }
      ]
    },
    {
      title: 'Collector Sources',
      subtitle: 'Current source attribution',
      icon: CheckCircle2,
      tone: 'green',
      rows: [
        { label: 'CPU Temperature', value: cards.cpu.temperature.source },
        { label: 'GPU Utilization', value: cards.gpu.utilization.source },
        { label: 'Storage Health', value: cards.storage.health.source }
      ]
    }
  ];
}
