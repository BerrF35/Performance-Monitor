import type { ComponentType, ReactNode } from 'react';
import clsx from 'clsx';
import { ResponsiveContainer, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid } from 'recharts';
import type { LucideProps } from 'lucide-react';
import { Activity, Cpu, Monitor, TerminalSquare } from 'lucide-react';
import type { TimePoint, Tone } from '@shared/models';

export const toneClass: Record<Tone, { text: string; bg: string; border: string; stroke: string; fill: string }> = {
  green: {
    text: 'text-gpu',
    bg: 'bg-gpu/10',
    border: 'border-gpu/25',
    stroke: '#64e45e',
    fill: 'rgba(100, 228, 94, 0.18)'
  },
  blue: {
    text: 'text-cpu',
    bg: 'bg-cpu/10',
    border: 'border-cpu/25',
    stroke: '#2f81ff',
    fill: 'rgba(47, 129, 255, 0.18)'
  },
  purple: {
    text: 'text-ram',
    bg: 'bg-ram/10',
    border: 'border-ram/25',
    stroke: '#8b5cf6',
    fill: 'rgba(139, 92, 246, 0.18)'
  },
  orange: {
    text: 'text-thermal',
    bg: 'bg-thermal/10',
    border: 'border-thermal/25',
    stroke: '#ff8a3d',
    fill: 'rgba(255, 138, 61, 0.18)'
  },
  cyan: {
    text: 'text-net',
    bg: 'bg-net/10',
    border: 'border-net/25',
    stroke: '#31d0ff',
    fill: 'rgba(49, 208, 255, 0.18)'
  },
  lime: {
    text: 'text-disk',
    bg: 'bg-disk/10',
    border: 'border-disk/25',
    stroke: '#74d14c',
    fill: 'rgba(116, 209, 76, 0.18)'
  },
  yellow: {
    text: 'text-warn',
    bg: 'bg-warn/10',
    border: 'border-warn/25',
    stroke: '#ffcc45',
    fill: 'rgba(255, 204, 69, 0.18)'
  },
  red: {
    text: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-400/25',
    stroke: '#fb7185',
    fill: 'rgba(251, 113, 133, 0.18)'
  },
  slate: {
    text: 'text-muted',
    bg: 'bg-white/5',
    border: 'border-white/10',
    stroke: '#8ea0b9',
    fill: 'rgba(142, 160, 185, 0.16)'
  }
};

interface GlassCardProps {
  title: string;
  subtitle?: string;
  icon: ComponentType<LucideProps>;
  tone?: Tone;
  className?: string;
  children: ReactNode;
  action?: ReactNode;
}

export function GlassCard({ title, subtitle, icon: Icon, tone = 'blue', className, children, action }: GlassCardProps) {
  const toneStyle = toneClass[tone];

  return (
    <section className={clsx('glass-card card-hover rounded-2xl p-4', className)}>
      <div className="relative z-10 flex h-full flex-col">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className={clsx('grid size-8 shrink-0 place-items-center rounded-lg border', toneStyle.bg, toneStyle.border, toneStyle.text)}>
              <Icon size={19} strokeWidth={2.1} />
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[18px] font-semibold leading-5 tracking-normal text-ink">{title}</h2>
              {subtitle ? <p className="mt-0.5 truncate text-[11px] text-muted">{subtitle}</p> : null}
            </div>
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
        {children}
      </div>
    </section>
  );
}

interface GaugeProps {
  value: number;
  valueLabel: string;
  tone?: Tone;
  label: string;
  size?: number;
}

export function Gauge({ value, valueLabel, tone = 'blue', label, size = 174 }: GaugeProps) {
  const normalized = Math.max(0, Math.min(100, value));
  const radius = 76;
  const circumference = 2 * Math.PI * radius;
  const dash = (normalized / 100) * circumference * 0.78;
  const gap = circumference - dash;
  const color = toneClass[tone].stroke;

  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="-rotate-[132deg]">
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke="rgba(108, 130, 164, 0.2)"
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${circumference * 0.78} ${circumference}`}
        />
        <circle
          cx="100"
          cy="100"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="12"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${gap}`}
          className="drop-shadow-[0_0_10px_rgba(47,129,255,0.5)] transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center">
          <div className="text-[38px] font-semibold leading-none text-white">{valueLabel}</div>
          <div className="mt-1.5 text-[13px] text-white">{label}</div>
        </div>
      </div>
    </div>
  );
}

interface SparklineProps {
  data: TimePoint[];
  tone?: Tone;
  secondaryTone?: Tone;
  height?: number;
  area?: boolean;
  yDomain?: [number, number];
}

export function Sparkline({ data, tone = 'blue', secondaryTone, height = 96, area = false, yDomain = [0, 100] }: SparklineProps) {
  const primary = toneClass[tone];
  const secondary = secondaryTone ? toneClass[secondaryTone] : null;
  const xDomain = data.length ? (['dataMin', 'dataMax'] as const) : ([0, 1] as const);

  if (area) {
    return (
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 2, bottom: 0, left: -30 }}>
            <defs>
              <linearGradient id={`fill-${tone}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={primary.stroke} stopOpacity={0.32} />
                <stop offset="100%" stopColor={primary.stroke} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid className="chart-grid" vertical={false} />
            <XAxis dataKey="timestamp" type="number" domain={xDomain} hide />
            <YAxis domain={yDomain} hide />
            <Area type="linear" dataKey="value" stroke={primary.stroke} fill={`url(#fill-${tone})`} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 2, bottom: 0, left: -30 }}>
          <CartesianGrid className="chart-grid" vertical={false} />
          <XAxis dataKey="timestamp" type="number" domain={xDomain} hide />
          <YAxis domain={yDomain} hide />
          <Line type="linear" dataKey="value" stroke={primary.stroke} strokeWidth={1.8} dot={false} isAnimationActive={false} />
          {secondary ? <Line type="linear" dataKey="secondary" stroke={secondary.stroke} strokeWidth={1.8} dot={false} isAnimationActive={false} /> : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

interface MeterProps {
  label: string;
  value: number;
  valueLabel: string;
  tone?: Tone;
  rightLabel?: string;
  compact?: boolean;
}

export function Meter({ label, value, valueLabel, tone = 'blue', rightLabel, compact = false }: MeterProps) {
  const toneStyle = toneClass[tone];

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-center justify-between gap-3 text-[11px] text-muted">
        <span>{label}</span>
        <span className="text-ink">{rightLabel ?? valueLabel}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${Math.max(0, Math.min(100, value))}%`,
            background: `linear-gradient(90deg, ${toneStyle.stroke}, rgba(255,255,255,0.55))`
          }}
        />
      </div>
    </div>
  );
}

interface StatProps {
  label: string;
  value: ReactNode;
  tone?: Tone;
}

export function Stat({ label, value, tone = 'slate' }: StatProps) {
  return (
    <div className="min-w-0 rounded-lg border border-white/10 bg-white/[0.025] px-2.5 py-2">
      <p className="truncate text-[11px] text-muted">{label}</p>
      <div className={clsx('mt-0.5 truncate text-[18px] font-semibold leading-5', toneClass[tone].text)}>{value}</div>
    </div>
  );
}

interface MetricRowProps {
  label: string;
  value: ReactNode;
  tone?: Tone;
}

export function MetricRow({ label, value, tone = 'slate' }: MetricRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/10 py-1.5 last:border-0">
      <span className="truncate text-[12px] text-muted">{label}</span>
      <span className={clsx('shrink-0 text-[13px] font-medium text-ink', toneClass[tone].text)}>{value}</span>
    </div>
  );
}

export function ProcessIcon({ name }: { name: string }) {
  const lower = name.toLowerCase();
  let Icon: ComponentType<LucideProps> = Monitor;
  let tone: Tone = 'slate';

  if (lower.endsWith('.exe')) {
    Icon = TerminalSquare;
    tone = 'cyan';
  } else if (lower.includes('system')) {
    Icon = Cpu;
    tone = 'blue';
  } else if (lower.includes('service')) {
    Icon = Activity;
    tone = 'purple';
  }

  return (
    <span className={clsx('grid size-5 shrink-0 place-items-center rounded-md border', toneClass[tone].bg, toneClass[tone].border, toneClass[tone].text)}>
      <Icon size={12} />
    </span>
  );
}

export function TinyButton({ children, className, onClick, title }: { children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={clsx(
        'no-drag grid size-8 place-items-center rounded-lg border border-white/10 bg-white/[0.03] text-muted transition hover:border-white/20 hover:bg-white/[0.06] hover:text-ink',
        className
      )}
    >
      {children}
    </button>
  );
}
