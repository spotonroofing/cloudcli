import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Minus, Plus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TransformComponent, TransformWrapper, useControls } from 'react-zoom-pan-pinch';

const controlButtonClass =
  'grid size-9 place-items-center rounded-full text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60';

/**
 * Zoom controls pill: zoom out, the current scale (click to reset), zoom in.
 * Lives inside TransformWrapper so useControls can reach the transform state.
 */
function LightboxControls({ scale }: { scale: number }) {
  const { t } = useTranslation('chat');
  const { zoomIn, zoomOut, resetTransform } = useControls();

  return (
    <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-white/10 p-1 backdrop-blur-sm">
      <button
        type="button"
        onClick={() => zoomOut()}
        aria-label={t('imagePreview.zoomOut', { defaultValue: 'Zoom out' })}
        className={controlButtonClass}
      >
        <Minus className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => resetTransform()}
        aria-label={t('imagePreview.resetZoom', { defaultValue: 'Reset zoom' })}
        className="h-9 min-w-14 rounded-full px-2 text-xs tabular-nums text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/60"
      >
        {Math.round(scale * 100)}%
      </button>
      <button
        type="button"
        onClick={() => zoomIn()}
        aria-label={t('imagePreview.zoomIn', { defaultValue: 'Zoom in' })}
        className={controlButtonClass}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Fullscreen image overlay in the claude.ai style: dark backdrop, centered
 * image, closes on backdrop click, close button, or Escape. The image is
 * zoomable everywhere it appears: wheel and double-click zoom with drag-pan
 * on desktop, pinch-to-zoom and pan on touch (the transform layer takes
 * touch-action: none so the browser never steals the gesture), with a reset
 * control in the bottom pill.
 */
export function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const [scale, setScale] = useState(1);
  // Backdrop-click guard: a drag that ends over the backdrop still fires a
  // click, so only close when the pointer barely moved since pointerdown.
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onPointerDownCapture={(event) => {
        pointerDownAt.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event) => {
        const down = pointerDownAt.current;
        const dragged = down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5;
        const onControl = (event.target as HTMLElement).closest('img, button');
        if (!dragged && !onControl) {
          onClose();
        }
      }}
    >
      <TransformWrapper
        minScale={1}
        maxScale={8}
        centerOnInit
        centerZoomedOut
        doubleClick={{ mode: 'toggle' }}
        onTransform={(_ref, state) => setScale(state.scale)}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%', touchAction: 'none' }}
          contentStyle={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="max-h-[90dvh] max-w-[92vw] select-none rounded-lg object-contain shadow-2xl"
            style={{ cursor: scale > 1 ? 'grab' : 'zoom-in' }}
          />
        </TransformComponent>
        <LightboxControls scale={scale} />
      </TransformWrapper>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close image preview"
        className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
    </div>,
    document.body,
  );
}
