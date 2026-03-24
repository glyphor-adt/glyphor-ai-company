import type { ReactNode } from 'react';
import { ArrowUp } from 'lucide-react';
import { MovingBorderContainer } from './ui/MovingBorder';
import { cn } from '../lib/utils';

/** One radius + shell everywhere we use the animated composer border */
export const COMPOSER_BORDER_RADIUS = '1rem';

export function ChatComposerFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <MovingBorderContainer
      borderRadius={COMPOSER_BORDER_RADIUS}
      containerClassName={cn('w-full', className)}
      innerClassName="flex-col items-stretch chat-composer-glass"
    >
      {children}
    </MovingBorderContainer>
  );
}

/** Main multiline field — shared typography, padding, and height limits */
export const composerTextareaClassName =
  'w-full resize-none border-0 bg-transparent px-3.5 pt-3 pb-1 text-[14px] leading-relaxed text-txt-secondary placeholder:text-txt-faint outline-none ring-0 transition-colors focus:ring-0 focus-visible:ring-1 focus-visible:ring-border-hover/35 disabled:opacity-50 min-h-[72px] max-h-[180px] sm:px-4';

/** Top row inside the same frame (e.g. Deep Dive target) */
export const composerInputLineClassName =
  'w-full border-0 border-b border-white/[0.06] bg-transparent px-3.5 py-3 text-[14px] text-txt-secondary placeholder:text-txt-faint outline-none transition-colors disabled:opacity-50 sm:px-4';

/** Bottom bar under the field(s) — icon row (Chat / Ora) */
export const composerFooterRowClassName =
  'flex items-center justify-between gap-2 px-3 pb-2 pt-0.5';

/** Bottom bar — Strategy-style controls + primary action */
export const composerFooterStrategyClassName =
  'flex flex-col gap-3 px-3 pb-2 pt-0.5 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between';

/** Right-aligned actions only */
export const composerFooterEndClassName =
  'flex items-center justify-end px-3 pb-2 pt-0.5';

/** Single row that wraps (e.g. Cascade: perspective + run) */
export const composerFooterToolbarClassName =
  'flex flex-wrap items-end justify-between gap-3 px-3 pb-2 pt-0.5';

/** Inline selects / checkbox row inside strategy footer */
export const composerSelectClassName =
  'w-full rounded-lg border border-border/70 bg-base px-3 py-2 text-[13px] text-txt-primary outline-none focus:border-border-hover';

export const composerFieldLabelClassName =
  'mb-1 block text-[10px] font-medium text-txt-muted';

/** Checkbox + label row inside strategy composer footer */
export const composerCheckboxRowClassName =
  'flex min-h-[42px] min-w-[200px] cursor-pointer items-center gap-2 rounded-lg border border-border/70 bg-base/80 px-3 py-2 text-[12px] text-txt-secondary sm:mb-0';

/** Circular icon control — Chat / Ora toolbars */
export const composerIconButtonClassName =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-transparent text-txt-muted transition-colors hover:border-border hover:bg-white/[0.04] hover:text-cyan disabled:opacity-40 dark:border-white/[0.1]';

export const composerIconButtonActiveMenuClassName =
  'border-cyan/30 bg-cyan/5 text-cyan';

export const composerIconButtonDangerActiveClassName =
  'animate-pulse border-red-400/35 bg-red-500/10 text-red-200';

export const composerIconButtonVoiceLiveClassName =
  'border-cyan/35 bg-cyan/10 text-cyan hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-100';

export const composerIconButtonVoiceConnectingClassName =
  'border-prism-elevated/30 bg-prism-elevated/10 animate-pulse text-prism-elevated';

/** Send / submit circle — same shape as other composer icons */
export const composerSendButtonClassName =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border/70 bg-raised/50 text-txt-muted transition-colors hover:border-cyan/30 hover:bg-cyan/10 hover:text-cyan disabled:cursor-not-allowed disabled:opacity-25 dark:border-white/[0.12] dark:bg-white/[0.04]';

/** Same circular ↑ control as Agent Chat / Ora (Strategy + anywhere else) */
export function ComposerSendButton({
  onClick,
  disabled,
  'aria-label': ariaLabel,
  title,
}: {
  onClick: () => void | Promise<void>;
  disabled?: boolean;
  'aria-label': string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
      className={composerSendButtonClassName}
    >
      <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.25} />
    </button>
  );
}
