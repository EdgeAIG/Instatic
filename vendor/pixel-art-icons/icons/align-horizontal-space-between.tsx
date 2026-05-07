import React from 'react';
import type { IconProps } from '../types';

export function AlignHorizontalSpaceBetweenIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M5 4h3v2H5zM3 2h2v20H3zm2 16h3v2H5zM8 6h2v12H8zm8 1h3v2h-3zm-2 2h2v6h-2zm2 6h3v2h-3zm3-13h2v20h-2z"/>
    </svg>
  );
}
