import { Modal, Shortcut } from '@/design';
import { useCommands } from '@/hooks/useRegisterCommands';
import { useUiStore } from '@/state/uiStore';
import { SHEET_COLUMNS, sheetRows, type SheetRow } from './shortcutSections';

function Row({ row }: { row: SheetRow }) {
  return (
    <div className="flex min-h-7 items-center justify-between gap-4 py-0.5">
      {/* Wraps instead of truncating: every action is read in full at 1280 (no ellipsis anywhere). */}
      <dt className="min-w-0 text-pretty text-body-s leading-5 text-secondary">{row.action}</dt>
      <dd className="flex shrink-0 items-center gap-1">
        {row.shortcuts.map((s) => (
          <Shortcut key={s} shortcut={s} all />
        ))}
      </dd>
    </div>
  );
}

/**
 * Shortcut sheet v2 (WORKSTATION_V2 §5.19), opened with "?" or the top bar's help button: a 560 px modal
 * with two columns, Navigate · Inspect and Edit · View, generated from the same command registry as the
 * palette (`shortcutSections.ts`), so the two can never drift apart.
 */
export default function ShortcutSheet() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const commands = useCommands();
  const rows = sheetRows(commands);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" width={560}>
      <div className="grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-2">
        {SHEET_COLUMNS.map((col) => (
          <div key={col.sections[0]!.id} className="flex flex-col gap-5">
            {col.sections.map((section) =>
              rows[section.id].length ? (
                <section key={section.id} aria-labelledby={`keys-${section.id}`} data-region={`keys-${section.id}`}>
                  <h3 id={`keys-${section.id}`} className="eyebrow mb-1.5 text-tertiary">
                    {section.title}
                  </h3>
                  <dl className="flex flex-col">
                    {rows[section.id].map((row) => (
                      <Row key={row.key} row={row} />
                    ))}
                  </dl>
                </section>
              ) : null,
            )}
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-hairline pt-3 text-label font-normal text-tertiary">
        Single-key shortcuts pause while you type in a field. Every command is also in the palette:{' '}
        <Shortcut shortcut="Mod+K" className="align-middle" />
      </p>
    </Modal>
  );
}
