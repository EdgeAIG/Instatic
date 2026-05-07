import React from 'react';
import type { IconProps } from '../types';

export function ArrowsVerticalIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M13 17h4v2h-2v2h-2v2h-2v-2H9v-2H7v-2h4v-4h2v4Zm0-14h2v2h2v2h-4v4h-2V7H7V5h2V3h2V1h2v2Z"/>
    </svg>
  );
}
