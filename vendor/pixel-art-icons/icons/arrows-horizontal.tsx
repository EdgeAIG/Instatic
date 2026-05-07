import React from 'react';
import type { IconProps } from '../types';

export function ArrowsHorizontalIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={color}
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
    >
      <path d="M7 17H5v-2H3v-2H1v-2h2V9h2V7h2v4h4v2H7v4Zm12-8h2v2h2v2h-2v2h-2v2h-2v-4h-4v-2h4V7h2v2Z"/>
    </svg>
  );
}
