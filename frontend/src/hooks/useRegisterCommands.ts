import { useEffect, useRef } from 'react';
import { useCommandStore, resolveCommands, type Command, type RegisterOptions } from '@/state/commandStore';

/**
 * Registers `commands` under `source` while the calling component is mounted (WORKSTATION_V2 §9.2).
 * Titles, groups and shortcuts are re-read when `deps` change; `run`, `when` and `preview` always call the
 * latest closure, so they never go stale between re-registrations.
 *
 *   useRegisterCommands('risk', [{ id: 'vessel.explain.LAD', group: 'vessels', title: 'Explain LAD',
 *     run: () => useUiStore.getState().openDrawer('explain') }], []);
 */
export function useRegisterCommands(
  source: string,
  commands: Command[],
  deps: unknown[],
  options?: RegisterOptions,
): void {
  const latest = useRef(commands);
  latest.current = commands;
  const priority = options?.priority ?? 0;

  useEffect(() => {
    const byId = () => new Map(latest.current.map((c) => [c.id, c]));
    const proxy = (c: Command): Command => ({
      ...c,
      run: () => (byId().get(c.id) ?? c).run(),
      when: c.when ? () => (byId().get(c.id) ?? c).when?.() ?? true : undefined,
      preview: c.preview ? () => (byId().get(c.id) ?? c).preview?.() ?? '' : undefined,
    });
    useCommandStore.getState().register(source, latest.current.map(proxy), { priority });
    return () => useCommandStore.getState().unregister(source);
    // `deps` is the caller's dependency list (like useMemo); `latest` carries the closures.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, priority, ...deps]);
}

/** Every registered command (duplicates resolved), re-rendering when registrations change. */
export function useCommands(): Command[] {
  const sources = useCommandStore((s) => s.sources);
  return resolveCommands(sources);
}

/** The shortcut string of a command id, for "Name · key" tooltips (undefined when unregistered). */
export function useCommandShortcut(id: string): string | undefined {
  return useCommandStore((s) => resolveCommands(s.sources).find((c) => c.id === id)?.shortcut);
}
