import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
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
import type { DisplayOverviewCards, DisplayProcessMetric, PerformanceSnapshot, StatusChip, TimePoint, Tone, WindowAction } from '@shared/models';
import { useMonitorStore } from '@renderer/store/useMonitorStore';
import { OverviewPage } from '@renderer/pages/OverviewPage';
import { GlassCard, MetricRow, Sparkline, TinyButton, toneClass } from '@renderer/components/Primitives';
import { actionNoticeEvent, notifyAction, type ActionNoticeDetail } from '@renderer/actionNotice';

type TopPanelId = 'menu' | 'notifications' | 'settings' | 'overflow';

export default function App() {
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [activeTopPanel, setActiveTopPanel] = useState<TopPanelId | null>(null);
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

  useEffect(() => {
    const handleActionNotice = (event: Event) => {
      const detail = (event as CustomEvent<ActionNoticeDetail>).detail;
      setActionNotice(detail.message);
    };

    window.addEventListener(actionNoticeEvent, handleActionNotice);
    return () => window.removeEventListener(actionNoticeEvent, handleActionNotice);
  }, []);

  useEffect(() => {
    if (!actionNotice) {
      return;
    }

    const timer = window.setTimeout(() => setActionNotice(null), 2600);
    return () => window.clearTimeout(timer);
  }, [actionNotice]);

  if (!snapshot) {
    return <LoadingShell error={error} onRefresh={fetchSnapshot} />;
  }

  const selectTab = (tab: TabId) => {
    setTab(tab);
    setActiveTopPanel(null);
    notifyAction(`${tab} view selected`);
  };
  const toggleTopPanel = (panel: TopPanelId) => {
    setActiveTopPanel((current) => (current === panel ? null : panel));
  };

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-app text-ink">
      <TopBar snapshot={snapshot} activePanel={activeTopPanel} onTogglePanel={toggleTopPanel} />
      <TopActionPanel activePanel={activeTopPanel} snapshot={snapshot} onClose={() => setActiveTopPanel(null)} onSelectTab={selectTab} onRefresh={fetchSnapshot} />
      <TabBar
        selectedTab={selectedTab}
        onSelect={selectTab}
        snapshot={snapshot}
        isRefreshing={isRefreshing}
        onRefresh={fetchSnapshot}
        onOpenTopPanel={toggleTopPanel}
      />
      <main className="scrollbar-dark min-w-0 flex-1 overflow-auto px-3 pb-5 pt-4 sm:px-5">
        {selectedTab === 'Overview' ? (
          <OverviewPage
            cards={snapshot.display.overview}
            visiblePanels={settings.visiblePanels}
            onTogglePanel={togglePanel}
            onOpenProcesses={() => selectTab('Processes')}
            onOpenLogs={() => selectTab('Logs')}
          />
        ) : (
          <StubPage tab={selectedTab} cards={snapshot.display.overview} />
        )}
      </main>
      {actionNotice ? (
        <div className="pointer-events-none fixed right-5 top-[124px] z-50 max-w-[min(360px,calc(100vw-2rem))] rounded-lg border border-white/10 bg-[#111d2c] px-3.5 py-2 text-[12px] text-ink shadow-[0_14px_36px_rgba(0,0,0,0.28)]">
          {actionNotice}
        </div>
      ) : null}
    </div>
  );
}

function LoadingShell({ error, onRefresh }: { error: string | null; onRefresh: () => Promise<void> }) {
  return (
    <div className="grid h-screen place-items-center bg-app text-ink">
      <div className="glass-card w-[min(92vw,420px)] rounded-2xl p-6 text-center">
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

function TopBar({
  snapshot,
  activePanel,
  onTogglePanel
}: {
  snapshot: PerformanceSnapshot;
  activePanel: TopPanelId | null;
  onTogglePanel: (panel: TopPanelId) => void;
}) {
  return (
    <header className="app-drag grid min-h-[68px] shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 px-3 py-2 sm:px-5 xl:grid-cols-[minmax(190px,260px)_minmax(280px,1fr)_auto]">
      <button
        onClick={() => onTogglePanel('menu')}
        className={clsx(
          'no-drag flex min-w-0 items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-white/[0.045]',
          activePanel === 'menu' && 'bg-cpu/10 ring-1 ring-cpu/25'
        )}
        aria-expanded={activePanel === 'menu'}
      >
        <div className="grid size-9 place-items-center rounded-lg bg-cpu text-white shadow-glowBlue">
          <Activity size={20} />
        </div>
        <div className="truncate text-[17px] font-semibold tracking-normal">Performance Monitor</div>
      </button>

      <div className="order-3 col-span-2 grid min-w-0 grid-cols-1 overflow-hidden rounded-xl border border-white/10 bg-white/[0.045] shadow-glass sm:grid-cols-3 xl:order-none xl:col-span-1">
        {snapshot.display.chips.map((chip, index) => (
          <StatusChipView key={chip.id} chip={chip} divided={index > 0} />
        ))}
      </div>

      <div className="no-drag flex min-w-0 items-center justify-end gap-1.5 sm:gap-2">
        <TinyButton title="Notifications" onClick={() => onTogglePanel('notifications')} className={activePanel === 'notifications' ? 'border-cpu/30 bg-cpu/10 text-ink' : undefined}>
          <span className="relative">
            <Bell size={16} />
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-red-400" />
          </span>
        </TinyButton>
        <TinyButton title="Settings" onClick={() => onTogglePanel('settings')} className={activePanel === 'settings' ? 'border-cpu/30 bg-cpu/10 text-ink' : undefined}>
          <Settings size={16} />
        </TinyButton>
        <TinyButton title="More" onClick={() => onTogglePanel('overflow')} className={activePanel === 'overflow' ? 'border-cpu/30 bg-cpu/10 text-ink' : undefined}>
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

function TopActionPanel({
  activePanel,
  snapshot,
  onClose,
  onSelectTab,
  onRefresh
}: {
  activePanel: TopPanelId | null;
  snapshot: PerformanceSnapshot;
  onClose: () => void;
  onSelectTab: (tab: TabId) => void;
  onRefresh: () => Promise<void>;
}) {
  if (!activePanel) {
    return null;
  }

  const overview = snapshot.display.overview;
  const isLeftPanel = activePanel === 'menu';

  return (
    <div className={clsx('no-drag fixed top-[76px] z-50 w-[min(380px,calc(100vw-1.5rem))]', isLeftPanel ? 'left-3 sm:left-5' : 'right-3 sm:right-5')}>
      <div className="rounded-2xl border border-white/10 bg-[#0d1828] p-3 shadow-[0_18px_48px_rgba(0,0,0,0.38)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] font-semibold text-ink">
              {activePanel === 'menu' ? 'App Menu' : activePanel === 'notifications' ? 'Notifications' : activePanel === 'settings' ? 'Dashboard Settings' : 'More Actions'}
            </p>
            <p className="text-[11px] text-muted">Snapshot update: {snapshot.display.updateAgeLabel}</p>
          </div>
          <button onClick={onClose} className="grid size-7 place-items-center rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-ink" title="Close panel">
            <X size={14} />
          </button>
        </div>

        {activePanel === 'menu' ? (
          <div className="grid grid-cols-2 gap-2">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => onSelectTab(tab)}
                className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-[12px] text-ink transition hover:bg-white/[0.065]"
              >
                {tab}
              </button>
            ))}
          </div>
        ) : null}

        {activePanel === 'notifications' ? (
          <div className="space-y-2">
            {overview.systemHealth.recentAlerts.length ? (
              overview.systemHealth.recentAlerts.map((alert) => (
                <div key={alert.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-2.5">
                  <p className="text-[12px] font-medium text-ink">{alert.title}</p>
                  <p className="mt-1 text-[11px] text-muted">{alert.detail}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3 text-[12px] text-muted">No alerts in the current snapshot.</div>
            )}
            <button onClick={() => onSelectTab('Logs')} className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.025] text-[12px] text-cpu transition hover:bg-white/[0.06]">
              Open Logs
            </button>
          </div>
        ) : null}

        {activePanel === 'settings' ? (
          <div className="space-y-2">
            <MetricRow label="Refresh Rate" value={`${snapshot.raw.timestamp ? 'Live' : 'Unavailable'}`} />
            <MetricRow label="CPU Panel" value={overview.cpu.utilization.label} />
            <MetricRow label="GPU Panel" value={overview.gpu.utilization.label} />
            <button
              onClick={() => {
                void onRefresh();
              }}
              className="h-8 w-full rounded-lg border border-white/10 bg-white/[0.025] text-[12px] text-cpu transition hover:bg-white/[0.06]"
            >
              Refresh Snapshot
            </button>
          </div>
        ) : null}

        {activePanel === 'overflow' ? (
          <div className="grid gap-2">
            <button onClick={() => onSelectTab('System')} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-[12px] text-ink transition hover:bg-white/[0.065]">
              Open System Summary
            </button>
            <button onClick={() => onSelectTab('Processes')} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-[12px] text-ink transition hover:bg-white/[0.065]">
              Open Processes
            </button>
            <button onClick={() => onSelectTab('Sensors')} className="rounded-lg border border-white/10 bg-white/[0.025] px-3 py-2 text-left text-[12px] text-ink transition hover:bg-white/[0.065]">
              Open Sensors
            </button>
          </div>
        ) : null}
      </div>
    </div>
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
  onRefresh,
  onOpenTopPanel
}: {
  selectedTab: TabId;
  onSelect: (tab: TabId) => void;
  snapshot: PerformanceSnapshot;
  isRefreshing: boolean;
  onRefresh: () => Promise<void>;
  onOpenTopPanel: (panel: TopPanelId) => void;
}) {
  return (
    <div className="flex h-[48px] min-w-0 shrink-0 items-end justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
      <nav className="scrollbar-dark flex h-full min-w-0 flex-1 items-end gap-5 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              onSelect(tab);
            }}
            className={clsx(
              'relative h-full shrink-0 px-1 pt-4 text-[12px] transition',
              selectedTab === tab ? 'text-ink' : 'text-muted hover:text-ink'
            )}
          >
            {tab}
            {selectedTab === tab ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-cpu shadow-glowBlue" /> : null}
          </button>
        ))}
      </nav>
      <div className="flex h-full shrink-0 items-center gap-1.5 text-[11px] text-muted sm:gap-2.5">
        <span className="hidden sm:inline">Update: {snapshot.display.updateAgeLabel}</span>
        <button
          onClick={() => {
            notifyAction('Snapshot refresh requested');
            void onRefresh();
          }}
          className="grid size-8 place-items-center rounded-lg text-muted transition hover:bg-white/[0.06] hover:text-ink"
          title="Refresh"
        >
          <RefreshCw size={15} className={clsx(isRefreshing && 'animate-spin')} />
        </button>
        <TinyButton title="Grid" onClick={() => onOpenTopPanel('overflow')}>
          <Grid2X2 size={15} />
        </TinyButton>
        <TinyButton title="Theme" onClick={() => onOpenTopPanel('settings')}>
          <Moon size={15} />
        </TinyButton>
      </div>
    </div>
  );
}

function StubPage({ tab, cards }: { tab: TabId; cards: DisplayOverviewCards }) {
  if (tab === 'Processes') {
    return <ProcessesPage processes={cards.topProcesses} />;
  }

  const panels = getStubPanels(tab, cards);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold">{tab}</h1>
        <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[11px] text-muted">Snapshot-backed summary</span>
      </div>
      <div className="dashboard-grid">
        {panels.map((panel) => (
          <GlassCard key={panel.title} title={panel.title} subtitle={panel.subtitle} icon={panel.icon} tone={panel.tone}>
            {panel.chart ? <Sparkline data={panel.chart.data} tone={panel.chart.tone} secondaryTone={panel.chart.secondaryTone} height={92} /> : null}
            <div className="mt-2 space-y-0.5">
              {panel.rows.map((row) => (
                <MetricRow key={row.label} label={row.label} value={row.value} />
              ))}
            </div>
          </GlassCard>
        ))}
        {!panels.length ? (
          <GlassCard title="No Telemetry" subtitle="This view has no current snapshot-backed entries" icon={Activity} tone="slate">
            <p className="text-[12px] text-muted">Open Overview or wait for the next collector sample.</p>
          </GlassCard>
        ) : null}
      </div>
    </div>
  );
}

function ProcessesPage({ processes }: { processes: DisplayProcessMetric[] }) {
  const [selectedProcessId, setSelectedProcessId] = useState<string | null>(null);
  const selectedProcess = processes.find((process) => process.id === selectedProcessId) ?? processes[0] ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold">Processes</h1>
        <span className="rounded-full border border-white/10 bg-white/[0.035] px-3 py-1 text-[11px] text-muted">Snapshot-backed process table</span>
      </div>
      <div className="glass-card rounded-2xl p-3">
        <div className="relative z-10 overflow-x-auto">
          <div className="min-w-[860px]">
            <div className="grid grid-cols-[minmax(180px,1.4fr)_72px_70px_90px_100px_100px_70px_minmax(110px,1fr)] gap-3 border-b border-white/10 px-2 pb-2 text-[11px] text-muted">
              <span>Name</span>
              <span className="text-right">PID</span>
              <span className="text-right">CPU</span>
              <span className="text-right">Memory</span>
              <span className="text-right">Disk</span>
              <span className="text-right">Network</span>
              <span className="text-right">GPU</span>
              <span>GPU engine</span>
            </div>
            <div className="mt-1 space-y-1">
              {processes.map((process) => (
                <button
                  key={process.id}
                  onClick={() => setSelectedProcessId(process.id)}
                  className={clsx(
                    'grid w-full grid-cols-[minmax(180px,1.4fr)_72px_70px_90px_100px_100px_70px_minmax(110px,1fr)] items-center gap-3 rounded-lg px-2 py-2 text-left text-[12px] transition hover:bg-white/[0.05]',
                    selectedProcess?.id === process.id && 'bg-cpu/10 ring-1 ring-cpu/25'
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0"><Activity size={13} /></span>
                    <span className="truncate text-ink">{process.name}</span>
                  </span>
                  <span className="text-right text-muted">{process.pid ?? '—'}</span>
                  <span className="text-right text-muted">{process.cpuLabel}</span>
                  <span className="text-right text-muted">{process.ramLabel}</span>
                  <span className="text-right text-muted">{(process.diskReadLabel ?? process.diskWriteLabel) ? `R ${process.diskReadLabel ?? '—'} / W ${process.diskWriteLabel ?? '—'}` : '—'}</span>
                  <span className="text-right text-muted">{process.networkRateLabel ?? '—'}</span>
                  <span className="text-right text-muted">{process.gpuLabel}</span>
                  <span className="truncate text-muted">{process.gpuEngineLabel ?? '—'}</span>
                </button>
              ))}
              {!processes.length ? <div className="rounded-lg border border-white/10 bg-white/[0.02] p-4 text-[12px] text-muted">No process telemetry available yet.</div> : null}
            </div>
          </div>
        </div>
      </div>
      {selectedProcess ? (
        <div className="glass-card rounded-2xl p-4">
          <div className="relative z-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricRow label="Selected Process" value={selectedProcess.name} />
            <MetricRow label="PID" value={selectedProcess.pid ?? '—'} />
            <MetricRow label="CPU" value={selectedProcess.cpuLabel} />
            <MetricRow label="GPU Engine" value={selectedProcess.gpuEngineLabel ?? '—'} />
          </div>
        </div>
      ) : null}
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
