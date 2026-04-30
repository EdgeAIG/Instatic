/**
 * Button — shared action button primitive for the editor UI.
 *
 * Replaces 33+ one-off button classes across 37 files.
 *
 * Variants:  ghost | secondary | primary | destructive
 * Sizes:     micro (18px) | xs (26px) | sm (28px, default) | md (32px) | lg (44px touch target)
 * Icon-only: iconOnly={true} → square, requires aria-label
 * Pressed:   pressed={true} → aria-pressed + active bg (toolbar toggles)
 *
 * Constraints:
 *   - CSS Modules only — no Tailwind, no inline styles (#402/#403)
 *   - Strictly achromatic tokens (#376) — all colours via --editor-* vars
 *   - @motion/icons only (#350)
 *   - No !important (#403)
 *   - default type="button" (never accidentally submits forms)
 */
import { forwardRef } from "react";
import { cn } from "@ui/cn";
import styles from "./Button.module.css";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant: "ghost" | "secondary" | "primary" | "destructive";
  size?: "micro" | "xs" | "sm" | "md" | "lg";
  align?: "center" | "start" | "between";
  shape?: "default" | "pill" | "flush";
  tone?: "default" | "danger";
  iconOnly?: boolean;
  pressed?: boolean;
  active?: boolean;
  accentFill?: boolean;
  fullWidth?: boolean;
  menuItem?: boolean;
  navItem?: boolean;
  dangerHover?: boolean;
  numeric?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant,
      size = "sm",
      align = "center",
      shape = "default",
      tone = "default",
      iconOnly = false,
      pressed,
      active = false,
      accentFill = false,
      fullWidth = false,
      menuItem = false,
      navItem = false,
      dangerHover = false,
      numeric = false,
      className,
      children,
      type = "button",
      "aria-label": ariaLabel,
      ...rest
    },
    ref,
  ) {
    if (process.env.NODE_ENV !== "production" && iconOnly && !ariaLabel) {
      console.warn(
        "[Button] iconOnly={true} requires an aria-label prop for accessibility.",
      );
    }

    return (
      <button
        ref={ref}
        type={type}
        aria-label={ariaLabel}
        aria-pressed={pressed !== undefined ? pressed : undefined}
        data-active={active ? "true" : undefined}
        data-tone={tone !== "default" ? tone : undefined}
        data-danger-hover={dangerHover ? "true" : undefined}
        className={cn(
          styles.btn,
          styles[`variant-${variant}`],
          styles[`size-${size}`],
          styles[`align-${align}`],
          shape !== "default" && styles[`shape-${shape}`],
          iconOnly && styles.iconOnly,
          fullWidth && styles.fullWidth,
          menuItem && styles.menuItem,
          navItem && styles.navItem,
          numeric && styles.numeric,
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
