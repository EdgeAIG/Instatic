import React from 'react';
import type { IconProps } from '../types';

export function ArrowBarUpIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M4 4h16V2H4zm7 18h2V6h-2zm2-12h2V8h-2zm2 2h2v-2h-2zm2 2h2v-2h-2zm-8-4h2V8H9zm-2 2h2v-2H7zm-2 2h2v-2H5z"/>
    </svg>
  );
}
