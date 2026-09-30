import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge must know the custom LUMEN font-size tokens; otherwise `text-overline` and
 * `text-secondary` look like the same "text-*" group and one of them is silently dropped.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display-1',
            'display-2',
            'title-1',
            'title-2',
            'body',
            'narrative',
            'body-s',
            'label',
            'overline',
            'numeral-xl',
            'numeral-xl-compact',
            'numeral-l',
            'numeral-label',
            'numeral-m',
            'mono-s',
          ],
        },
      ],
      shadow: [{ shadow: ['e1', 'e2', 'e3', 'hud', 'focus'] }],
    },
  },
});

/** Compose class names: conditional (clsx) + conflict-aware (tailwind-merge). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
