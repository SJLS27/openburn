import { useEffect, useState } from 'react';

export interface SystemFontFamily {
  family: string;
  /** Styles available for the family, e.g. ['regular', 'bold']. */
  styles: string[];
}

/** Families used when the app runs outside Electron or the OS list is empty. */
export const FALLBACK_FAMILIES = [
  'Inter',
  'Arial',
  'Helvetica',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
];

/** Collapse the flat face list into sorted, unique families. */
export function toFamilies(faces: { family: string; style: string }[]): SystemFontFamily[] {
  const map = new Map<string, Set<string>>();
  for (const face of faces) {
    const family = face.family.trim();
    if (!family) continue;
    let styles = map.get(family);
    if (!styles) {
      styles = new Set();
      map.set(family, styles);
    }
    styles.add(face.style);
  }
  return [...map.entries()]
    .map(([family, styles]) => ({ family, styles: [...styles].sort() }))
    .sort((a, b) => a.family.localeCompare(b.family));
}

/**
 * Filter families for the picker. The typed term matches anywhere in the name
 * and the bundled font always stays available at the top.
 */
export function filterFamilies(
  families: SystemFontFamily[],
  query: string,
  limit = 200,
): SystemFontFamily[] {
  const q = query.trim().toLowerCase();
  const sorted = q
    ? families.filter((f) => f.family.toLowerCase().includes(q))
    : families;
  const pinned = families.filter((f) => f.family.toLowerCase() === 'inter');
  const rest = sorted.filter((f) => f.family.toLowerCase() !== 'inter');
  return [...pinned, ...rest].slice(0, limit);
}

/**
 * Load the installed font families. Falls back to a fixed list in the browser
 * and when the OS exposes nothing, so the picker is never empty.
 */
export function useSystemFonts(): { families: string[]; loading: boolean; error?: string } {
  const [families, setFamilies] = useState<string[]>(FALLBACK_FAMILIES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let cancelled = false;
    const api = typeof window !== 'undefined' ? window.openburn?.fonts : undefined;
    if (!api) {
      setLoading(false);
      return;
    }
    void api
      .list()
      .then((result) => {
        if (cancelled) return;
        if (result.error) setError(result.error);
        const list = toFamilies(result.fonts ?? []).map((f) => f.family);
        if (list.length > 0) setFamilies(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { families, loading, error };
}
