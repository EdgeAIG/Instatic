/**
 * Pixel-art icon component type used by dashboard widget definitions.
 *
 * Kept in its own file so `types.ts` can stay free of UI imports — the
 * dashboard registry never imports a real icon module; it just holds the
 * component reference handed to it at registration time.
 */
/**
 * Use the upstream `IconProps` shape directly so passing `aria-hidden="true"`
 * (string) keeps working — every `pixel-art-icons/icons/<name>` component
 * accepts `React.SVGProps<SVGSVGElement>` via `IconProps`, where
 * `aria-hidden` is the wider `Booleanish` string union.
 */
import type { IconComponent } from 'pixel-art-icons/types'

export type PixelArtIconComponent = IconComponent
