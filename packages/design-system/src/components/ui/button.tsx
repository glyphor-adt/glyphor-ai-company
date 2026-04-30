/**
 * Shared Button component for glyphor-site.
 *
 * Consolidates the 7 ad-hoc button patterns found across header.tsx, footer.tsx,
 * theme-switch.tsx, and theme-toggle.tsx into a single typed API.
 *
 * VARIANT MAP (matches the 7 patterns from the audit):
 *
 * | variant      | replaces                                                      |
 * |--------------|---------------------------------------------------------------|
 * | primary      | component-library default CTA (bg-primary)                    |
 * | secondary    | outlined / border CTA                                         |
 * | ghost        | theme-toggle row button (focus-ring, hover:bg-muted)           |
 * | icon         | theme-switch square / hamburger (focus-ring, 10×10 / 12×12)   |
 * | nav          | header nav links (hover:bg-foreground/5, text-foreground/80)  |
 * | nav-mobile   | header mobile accordion row (full-width, justify-between)     |
 * | hero         | layered "Try Today!" CTA — caller composes spans internally   |
 * | cta-circular | footer circular CTA (rounded-full, bg-foreground)             |
 *
 * INTENTIONAL BRANDING NOTE
 * text-black / text-neutral-900 / bg-white usages that sit over /BG.jpg MUST stay
 * as-is in dark mode. See packages/design-system/src/globals.css for the full list
 * of intentional overrides. Do NOT convert them to semantic tokens.
 *
 * USAGE
 * import { Button } from '@glyphor/design-system';
 *
 * <Button variant="nav">Docs</Button>
 * <Button variant="icon" aria-label="Toggle theme"><SunIcon /></Button>
 * <Button variant="hero" asChild><a href="/signup">Try Today!</a></Button>
 */

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

// ─── Utility ────────────────────────────────────────────────────────────────

function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}

// ─── Variants ────────────────────────────────────────────────────────────────

export const buttonVariants = cva(
  // Base: shared resets and accessible focus ring
  [
    'inline-flex items-center justify-center',
    'font-medium leading-none select-none',
    'transition-colors duration-150',
    'outline-none',
    'focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-ring',
    'disabled:pointer-events-none disabled:opacity-50',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        /**
         * primary — main CTA; sits on any surface.
         * bg-accent and text-accent-foreground keep it on-brand.
         */
        primary: 'bg-accent text-accent-foreground rounded-md px-5 py-2.5 text-sm hover:bg-accent/90',

        /**
         * secondary — outlined CTA; lighter visual weight.
         */
        secondary:
          'border border-border bg-background text-foreground rounded-md px-5 py-2.5 text-sm hover:bg-muted',

        /**
         * ghost — used by theme-toggle row buttons.
         * Pattern 4: focus-ring inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted
         */
        ghost: 'gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted hover:text-foreground',

        /**
         * icon — square icon-only button; used by theme-switch and hamburger.
         * Pattern 3: focus-ring inline-flex h-10 w-10 items-center justify-center rounded-md border border-border bg-background
         * Pattern 5: hidden max-[850px]:flex items-center justify-center w-10 h-10
         * Callers add size classes (h-10 w-10 / h-12 w-12) to control dimensions.
         */
        icon: 'rounded-md border border-border bg-background hover:bg-muted',

        /**
         * nav — desktop header nav links.
         * Pattern 1: flex items-center gap-1 px-4 py-2 text-sm font-medium text-foreground/80 hover:bg-foreground/5
         */
        nav: 'gap-1 rounded-md px-4 py-2 text-sm text-foreground/80 hover:bg-foreground/5',

        /**
         * nav-mobile — full-width accordion trigger in mobile menu.
         * Pattern 2: flex items-center justify-between py-4 w-full text-base font-medium text-foreground
         */
        'nav-mobile': 'w-full justify-between py-4 text-base text-foreground',

        /**
         * hero — layered "Try Today!" CTA wrapper.
         * Pattern 7: caller composes the three stacked <span> layers internally
         * (bg-accent bar → bg-foreground body → icon). The variant only provides
         * the outer shell resets so callers can freely compose layers.
         */
        hero: 'relative overflow-hidden rounded-lg',

        /**
         * cta-circular — footer circular arrow CTA.
         * Pattern 6: w-12 h-12 rounded-full bg-foreground text-background
         */
        'cta-circular': 'h-12 w-12 rounded-full bg-foreground text-background hover:opacity-90',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
);

// ─── Component ───────────────────────────────────────────────────────────────

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /**
   * Render as a different element or component (e.g. `<a>` for link-buttons).
   * When true the component renders its children directly, forwarding all props.
   * Requires the child to accept ref and className.
   *
   * Note: the ref forwarded to the host component is still typed as
   * HTMLButtonElement. When the child is not a <button> (e.g. an <a>),
   * attach a separate ref on the child element instead of relying on
   * Button's ref.
   */
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild = false, children, ...props }, ref) => {
    if (asChild && React.isValidElement(children)) {
      // Merge buttonVariants classes into the child element's className.
      const child = children as React.ReactElement<{ className?: string }>;
      return React.cloneElement(child, {
        className: cn(buttonVariants({ variant }), child.props.className, className),
      });
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant }), className)}
        {...props}
      >
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';

export { Button };
