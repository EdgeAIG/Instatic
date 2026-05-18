import React from 'react';
import type { IconProps } from '../types';

export function LockSolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M9 8h6V4h2v4h2v2h2v10h-2v2H5v-2H3V10h2V8h2V4h2v4Zm6-4H9V2h6v2Z"/>
    </svg>
  );
}
