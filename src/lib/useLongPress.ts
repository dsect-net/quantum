/**
 * useLongPress — press-and-hold (default 500 ms) as a first-class gesture.
 *
 * Returns props to spread onto the interactive element: pointer handlers
 * plus `data-longpress` (which disables the iOS callout / text selection
 * via CSS). A completed long-press suppresses the subsequent click so a
 * hold never also triggers the tap action.
 *
 * Works with mouse, touch, and pen via Pointer Events.
 */
import { useRef } from 'react';

export interface LongPressOptions {
  /** Hold duration in ms before firing. Default 500. */
  delay?: number;
  /** Fired once when the hold duration elapses while still pressed. */
  onLongPress: (event: React.PointerEvent<HTMLElement>) => void;
}

export interface LongPressProps {
  'data-longpress': true;
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
  onClickCapture: (event: React.MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLElement>) => void;
}

export function useLongPress({ delay = 500, onLongPress }: LongPressOptions): LongPressProps {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);

  const clear = () => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  return {
    'data-longpress': true,
    onPointerDown: (event) => {
      fired.current = false;
      clear();
      const target = event.currentTarget;
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        try {
          target.releasePointerCapture?.(event.pointerId);
        } catch {
          // not captured — fine
        }
        onLongPress(event);
      }, delay);
    },
    onPointerUp: clear,
    onPointerLeave: clear,
    onPointerCancel: clear,
    // A long-press must not ALSO fire the tap action.
    onClickCapture: (event) => {
      if (fired.current) {
        event.stopPropagation();
        event.preventDefault();
        fired.current = false;
      }
    },
    // Don't let the OS context menu fight the gesture on long-pressable rows.
    onContextMenu: (event) => {
      event.preventDefault();
    },
  };
}
