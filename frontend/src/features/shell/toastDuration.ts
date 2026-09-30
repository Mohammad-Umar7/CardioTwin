import type { Toast } from '@/state/uiStore';

/**
 * Auto-dismiss delay of a toast: 4 s for a plain message, 6 s when it carries an action (Undo after a
 * reset, WORKSTATION_V2 §5.7) so the action stays reachable, and never for a danger toast (it persists
 * until dismissed). The Toaster pauses the timer while the toast is hovered or focused.
 */
export function toastDuration(toast: Pick<Toast, 'tone' | 'action'>): number | null {
  if (toast.tone === 'danger') return null;
  return toast.action ? 6000 : 4000;
}
