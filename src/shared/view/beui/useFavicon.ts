import { useCallback, useState } from 'react';

/** Resolve a website URL to its conventional root favicon location. */
export function getFaviconUrl(value: string) {
  try {
    return new URL('/favicon.ico', value).toString();
  } catch {
    return null;
  }
}

/**
 * beUI use-favicon (vendored for Citations): resolves a site favicon and drops
 * it once it is known to be unusable, so callers can draw their own glyph
 * instead of a broken image. Plenty of sites answer `/favicon.ico` with a 403
 * or 404, and `onError` is not enough to catch it: an image the browser starts
 * loading before React attaches a handler fails silently, and that event is
 * never replayed. `decode()` settles on the image's final state instead.
 *
 * Departure from the donor: React 18 ignores cleanup functions returned from
 * callback refs, so a late rejection simply records the failed src — harmless,
 * since a src that has since changed no longer matches the current one.
 */
export function useFavicon(url?: string) {
  const resolved = url ? getFaviconUrl(url) : null;
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const src = resolved && resolved !== failedSrc ? resolved : null;

  const ref = useCallback(
    (img: HTMLImageElement | null) => {
      if (!img || !src) return;
      img.decode().catch(() => setFailedSrc(src));
    },
    [src],
  );

  return { src, ref };
}
