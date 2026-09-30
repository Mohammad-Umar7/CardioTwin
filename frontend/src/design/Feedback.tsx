import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/cn';

/** Loading placeholder with a slow shimmer (static under reduced motion). */
export function Skeleton({ className, style, label }: { className?: string; style?: CSSProperties; label?: string }) {
  return (
    <div
      className={cn('skeleton h-4 w-full', className)}
      style={style}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Keyboard key chip used in hints and the shortcut sheet. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'mono inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-line-strong bg-surface-2 px-1 text-[0.6875rem] text-secondary',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface ProgressRingProps {
  /** 0–1; undefined renders an indeterminate quarter arc. */
  value?: number;
  size?: number;
  stroke?: number;
  label: string;
  className?: string;
}

/** Determinate progress ring (accent on border/default). Used for step progress, never as a spinner. */
export function ProgressRing({ value, size = 20, stroke = 2, label, className }: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = value === undefined ? 0.25 : Math.min(1, Math.max(0, value));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === undefined ? undefined : Math.round(v * 100)}
      className={cn('-rotate-90', className)}
    >
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-line" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - v)}
        className="stroke-accent transition-[stroke-dashoffset] duration-data ease-data"
      />
    </svg>
  );
}

/** 1 px accent hairline progress bar (GLB loading under the breadcrumb, "Verifying" under the top bar). */
export function HairlineProgress({ value, className, label }: { value?: number | null; className?: string; label: string }) {
  const determinate = typeof value === 'number' && Number.isFinite(value);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={determinate ? Math.round((value as number) * 100) : undefined}
      className={cn('relative h-px w-full overflow-hidden bg-transparent', className)}
    >
      {determinate ? (
        <div
          className="h-full bg-accent transition-[width] duration-base ease-out"
          style={{ width: `${Math.round((value as number) * 100)}%` }}
        />
      ) : (
        <div className="h-full w-1/4 animate-indeterminate bg-accent" />
      )}
    </div>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** CI, CV mean ± sd, definition — text/tertiary. */
  sub?: ReactNode;
  className?: string;
  loading?: boolean;
}

/** KPI tile (DESIGN_SYSTEM §5 KPITile): overline label, numeral-l value, tertiary sub-line. */
export function Stat({ label, value, sub, className, loading }: StatProps) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1', className)}>
      <div className="overline text-tertiary">{label}</div>
      {loading ? (
        <Skeleton className="h-6 w-20" />
      ) : (
        <div className="font-numeral text-numeral-l text-primary">{value}</div>
      )}
      {sub && <div className="num text-label font-normal text-tertiary">{sub}</div>}
    </div>
  );
}

/** Friendly empty / missing-data state. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-start gap-2 rounded-md border border-dashed border-line p-4', className)}>
      {icon && <div className="text-tertiary [&>svg]:size-5 [&>svg]:stroke-[1.5]">{icon}</div>}
      <div className="text-body-s font-semibold text-primary">{title}</div>
      {children && <div className="text-body-s text-secondary">{children}</div>}
      {action}
    </div>
  );
}
