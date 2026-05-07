import React from 'react';
import type { IconProps } from '../types';

export function AlignStartHorizontalIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M5 22h4v-2H5zm-2-2h2V8H3zM5 8h4V6H5zm4 12h2V8H9zm6-5h4v-2h-4zm-2-2h2V8h-2zm2-5h4V6h-4zm4 5h2V8h-2zM2 4h20V2H2z"/>
    </svg>
  );
}
