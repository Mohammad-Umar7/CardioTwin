import { Modal, Shortcut } from '@/design';
import { useCommands } from '@/hooks/useRegisterCommands';
import { CMD } from '@/state/commandIds';
import type { Command, CommandGroup } from '@/state/commandStore';
import { useUiStore } from '@/state/uiStore';

/** Keys that act on the focused canvas or a layer, not through a registered command. */
const STATIC: Record<'navigate' | 'view', { shortcut: string; action: string }[]> = {
  navigate: [{ shortcut: 'Esc', action: 'Close the top layer: palette, menu, drawer, isolate, selection, focus' }],
  view: [
    { shortcut: 'ArrowLeft', action: 'Orbit 15° (canvas focused; also ↑ ↓ →)' },
    { shortcut: '+', action: 'Zoom in (canvas focused; − zooms out)' },
  ],
};

const COLUMNS: { id: 'navigate' | 'view'; title: string; groups: CommandGroup[] }[] = [
  { id: 'navigate', title: 'Navigate & inspect', groups: ['suggested', 'vessels', 'patients', 'pages'] },
  { id: 'view', title: 'Edit & view', groups: ['inputs', 'views', 'actions'] },
];

function Row({ shortcut, action }: { shortcut: string; action: string }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4">
      <dt className="min-w-0 text-body-s text-secondary">{action}</dt>
      <dd className="shrink-0">
        <Shortcut shortcut={shortcut} all />
      </dd>
    </div>
  );
}

/**
 * Shortcut sheet v2 (WORKSTATION_V2 §5.19), opened with "?": two columns generated from the same command
 * registry as the palette, so the two can never drift apart.
 */
export default function ShortcutSheet() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const commands = useCommands().filter((c): c is Command & { shortcut: string } => !!c.shortcut && c.id !== CMD.shortcuts);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width={560}>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {COLUMNS.map((col) => (
          <section key={col.id} aria-labelledby={`keys-${col.id}`}>
            <h3 id={`keys-${col.id}`} className="eyebrow mb-2 text-tertiary">
              {col.title}
            </h3>
            <dl className="flex flex-col gap-1">
              {commands
                .filter((c) => col.groups.includes(c.group))
                .map((c) => (
                  <Row key={c.id} shortcut={c.shortcut} action={c.title} />
                ))}
              {STATIC[col.id].map((s) => (
                <Row key={s.action} shortcut={s.shortcut} action={s.action} />
              ))}
            </dl>
          </section>
        ))}
      </div>
      <p className="mt-4 text-label font-normal text-tertiary">
        Single-key shortcuts pause while you type in a field. <Shortcut shortcut="?" className="align-middle" /> opens
        this sheet.
      </p>
    </Modal>
  );
}
