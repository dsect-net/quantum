/**
 * useLongPress: fires onLongPress after a 500 ms hold; a completed
 * long-press suppresses the follow-up click; releasing early fires nothing.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLongPress } from './useLongPress';

function pointerEvent(currentTarget: object = {}) {
  return {
    currentTarget: {
      releasePointerCapture: vi.fn(),
      ...currentTarget,
    },
    pointerId: 7,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  } as unknown as React.PointerEvent<HTMLElement>;
}

describe('useLongPress', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires onLongPress after the hold delay', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    act(() => {
      result.current.onPointerDown(pointerEvent());
    });
    expect(onLongPress).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it('fires nothing when released before the delay', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    act(() => {
      result.current.onPointerDown(pointerEvent());
      vi.advanceTimersByTime(200);
      result.current.onPointerUp(pointerEvent());
      vi.advanceTimersByTime(1000);
    });
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it('suppresses the click that follows a completed long-press', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    const down = pointerEvent();
    act(() => {
      result.current.onPointerDown(down);
      vi.advanceTimersByTime(500);
    });
    const click = pointerEvent();
    act(() => {
      result.current.onClickCapture(click as unknown as React.MouseEvent<HTMLElement>);
    });
    expect(click.stopPropagation).toHaveBeenCalled();
    expect(click.preventDefault).toHaveBeenCalled();
  });

  it('lets a normal tap click through (no suppression)', () => {
    const onLongPress = vi.fn();
    const { result } = renderHook(() => useLongPress({ onLongPress }));
    const click = pointerEvent();
    act(() => {
      result.current.onPointerDown(pointerEvent());
      result.current.onPointerUp(pointerEvent());
      result.current.onClickCapture(click as unknown as React.MouseEvent<HTMLElement>);
    });
    expect(onLongPress).not.toHaveBeenCalled();
    expect(click.stopPropagation).not.toHaveBeenCalled();
  });

  it('marks the element with data-longpress for the CSS callout guard', () => {
    const { result } = renderHook(() => useLongPress({ onLongPress: () => {} }));
    expect(result.current['data-longpress']).toBe(true);
  });
});
