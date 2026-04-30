/**
 * Section — shared collapsible section primitive.
 *
 * Extracted from ClassComposer.tsx so that PropertiesPanel can reuse the
 * same section header + toggle + content styling (PP-6 acceptance criterion).
 *
 * Used by:
 *   - PropertiesPanel.tsx (Module settings)
 *   - ClassComposer.tsx (assigned class style categories)
 *
 * The optional `indicator` prop renders a small dot next to the title to
 * signal state (e.g. breakpoint overrides active) — mirrors ClassComposer's
 * bpOverrideDot style (Spec §4.1 / Architect footnote #456).
 */

import { useState } from "react";
import { Icon } from "../../../ui/icons/Icon";
import { cn } from "@ui/cn";
import styles from "./Section.module.css";

export interface SectionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  /** Render a small accent dot next to the title (e.g. 'bp' = breakpoint active). */
  indicator?: "bp" | undefined;
  icon?: string;
  meta?: React.ReactNode;
  forceOpen?: boolean;
}

export function Section({
  title,
  children,
  defaultOpen = false,
  indicator,
  icon,
  meta,
  forceOpen = false,
}: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const expanded = forceOpen || open;

  return (
    <div className={cn(styles.section, expanded && styles.sectionOpen)}>
      <button
        onClick={() => {
          if (!forceOpen) setOpen((o) => !o);
        }}
        className={styles.sectionToggle}
        aria-expanded={expanded}
      >
        {icon && (
          <span className={styles.sectionIcon}>
            <Icon name={icon} size={13} />
          </span>
        )}
        <span className={styles.sectionTitle}>{title}</span>
        {meta && <span className={styles.sectionMeta}>{meta}</span>}
        {indicator === "bp" && (
          <span className={styles.sectionIndicatorDot} aria-hidden="true" />
        )}
      </button>
      {expanded && <div className={styles.sectionContent}>{children}</div>}
    </div>
  );
}
