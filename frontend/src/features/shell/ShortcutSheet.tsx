import { Kbd, Modal } from '@/design';
import { useUiStore } from '@/state/uiStore';

const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ['1', '2', '3'], action: 'Select LAD / LCX / RCA' },
  { keys: ['0', 'H'], action: 'Fly home' },
  { keys: ['Esc'], action: 'Clear selection, close dialogs' },
  { keys: ['←', '→', '↑', '↓'], action: 'Orbit 15° (canvas focused)' },
  { keys: ['+', '−'], action: 'Zoom (canvas focused)' },
  { keys: ['[', ']'], action: 'Previous / next projection' },
  { keys: ['P'], action: 'Run the peel (dissect / assemble)' },
  { keys: ['B'], action: 'Heartbeat on / off' },
  { keys: ['F'], action: 'Blood flow on / off' },
  { keys: ['T'], action: 'Territory tint on / off' },
  { keys: ['C'], action: 'Calm mode (reduced motion)' },
  { keys: ['?'], action: 'This sheet' },
];

/** Keyboard shortcut sheet (DESIGN_SYSTEM §10.3), opened with "?". */
export default function ShortcutSheet() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width={440}>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-body-s">
        {SHORTCUTS.map((s) => (
          <div key={s.action} className="contents">
            <dt className="flex gap-1">
              {s.keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </dt>
            <dd className="text-secondary">{s.action}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
