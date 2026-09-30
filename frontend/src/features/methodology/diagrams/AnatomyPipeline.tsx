import type { AnatomyStep } from '../content';

/**
 * The anatomy build as one horizontal chain (BodyParts3D → Blender → territories → centrelines →
 * SCCT segments → glTF). Each stage names what it contributes to the heart on screen.
 */
export function AnatomyPipeline({ steps }: { steps: AnatomyStep[] }) {
  return (
    <figure className="flex flex-col gap-3" aria-labelledby="anatomy-caption">
      <ol className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3 min-[1100px]:grid-cols-6 min-[1100px]:gap-x-0">
        {steps.map((s, i) => (
          <li key={s.title} className="relative flex min-w-0 flex-col gap-1.5 min-[1100px]:pr-5">
            <div className="relative flex h-5 items-center">
              <span aria-hidden className="relative z-[1] size-2.5 rounded-full border-2 border-secondary bg-panel" />
              {i < steps.length - 1 && (
                <span aria-hidden className="absolute left-4 right-2 top-1/2 hidden h-px bg-line-strong min-[1100px]:block">
                  <span className="absolute -right-px -top-[3px] size-[7px] rotate-45 border-r border-t border-line-strong" />
                </span>
              )}
            </div>
            <span className="font-mono text-mono-s text-tertiary">{String(i + 1).padStart(2, '0')}</span>
            <span className="text-body-s font-semibold text-primary">{s.title}</span>
            <span className="text-label font-normal text-tertiary text-pretty">{s.detail}</span>
          </li>
        ))}
      </ol>
      <figcaption id="anatomy-caption" className="text-label font-normal text-tertiary">
        One scripted, reproducible build: re-running it leaves the published model byte-for-byte unchanged.
      </figcaption>
    </figure>
  );
}
