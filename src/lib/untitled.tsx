/**
 * DSECT-wrapped Untitled UI React components.
 *
 * The vendored components live in vendor/untitled (see NOTICE.md for the MIT
 * attribution). These wrappers apply DSECT defaults measured in the
 * design-system's untitled/README.md:
 *
 *  - Buttons and inputs default to size "lg" (44px — the hub touch floor).
 *    Upstream defaults are sm/md (36/40px), too small for a phone app.
 *  - No pill badges: DSECT badges are flat rectangles. For status, use the
 *    kit's Badge / StateIndicator from @dsect/ui — Untitled badges are not
 *    re-exported here at all.
 */
import { Button as UntitledButton } from '@/components/base/buttons/button';
import type { ButtonProps as UntitledButtonProps } from '@/components/base/buttons/button';
import { Input as UntitledInput } from '@/components/base/input/input';
import type { InputProps as UntitledInputProps } from '@/components/base/input/input';
import { Toggle as UntitledToggle } from '@/components/base/toggle/toggle';
import type { ComponentProps } from 'react';

export function QButton({ size = 'lg', color = 'primary', ...props }: UntitledButtonProps) {
  return <UntitledButton size={size} color={color} {...props} />;
}

export function QInput({ size = 'lg', ...props }: UntitledInputProps) {
  return <UntitledInput size={size} {...props} />;
}

type UntitledToggleProps = ComponentProps<typeof UntitledToggle>;

/** Toggle only ships sm/md upstream; DSECT defaults to the larger one. */
export function QToggle({ size = 'md', ...props }: UntitledToggleProps) {
  return <UntitledToggle size={size} {...props} />;
}
