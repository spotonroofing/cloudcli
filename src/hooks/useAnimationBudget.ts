import { useEffect } from 'react';

const ANIMATED_SELECTOR = [
  '[data-beam]',
  '.animate-counter-breathe',
  '.animate-row-breathe',
  '.animate-segment-glow',
  '.animate-spinner-ramp',
  '.animate-spin',
  '.bui-pixel-cell',
  '.beui-text-shimmer',
  '.chat-activity-enter',
].join(',');

/** Pause indefinite CSS motion when it cannot be seen or the tab is hidden. */
export function useAnimationBudget() {
  useEffect(() => {
    const root = document.documentElement;
    const observed = new WeakSet<Element>();
    const intersection = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        entry.target.toggleAttribute('data-animation-offscreen', !entry.isIntersecting);
      }
    });
    const observe = (element: ParentNode) => {
      if (element instanceof Element && element.matches(ANIMATED_SELECTOR) && !observed.has(element)) {
        observed.add(element);
        intersection.observe(element);
      }
      for (const candidate of element.querySelectorAll(ANIMATED_SELECTOR)) {
        if (observed.has(candidate)) continue;
        observed.add(candidate);
        intersection.observe(candidate);
      }
    };
    const syncDocumentVisibility = () => {
      root.toggleAttribute('data-document-hidden', document.hidden);
    };
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) observe(node);
        }
      }
    });

    observe(document);
    syncDocumentVisibility();
    document.addEventListener('visibilitychange', syncDocumentVisibility);
    mutations.observe(document.body, { childList: true, subtree: true });
    return () => {
      root.removeAttribute('data-document-hidden');
      document.removeEventListener('visibilitychange', syncDocumentVisibility);
      mutations.disconnect();
      intersection.disconnect();
    };
  }, []);
}
