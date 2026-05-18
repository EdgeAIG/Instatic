import React from 'react';
import type { IconProps } from '../types';

export function CalendarSolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M17 4h2v2h2v14h-2v2H5v-2H3V6h2V4h2V2h2v2h6V2h2v2ZM5 10h14V8H5v2Z"/>
    </svg>
  );
}
