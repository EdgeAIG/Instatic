import React from 'react';
import type { IconProps } from '../types';

export function AlignStartVerticalIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M22 5v4h-2V5zm-2-2v2H8V3zM8 5v4H6V5zm12 4v2H8V9zm-5 6v4h-2v-4zm-2-2v2H8v-2zm-5 2v4H6v-4zm5 4v2H8v-2zM4 2v20H2V2z"/>
    </svg>
  );
}
