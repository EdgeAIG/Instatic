import React from 'react';
import type { IconProps } from '../types';

export function UsersSolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M12 16h2v2h2v4H0v-4h2v-2h2v-2h8v2Zm10 2h2v4h-6v-6h-2v-2h4v2h2v2ZM11 4h2v6h-2v2H5v-2H3V4h2V2h6v2Zm8 0h2v6h-2v2h-4V2h4v2Z"/>
    </svg>
  );
}
