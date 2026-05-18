import React from 'react';
import type { IconProps } from '../types';

export function ImageXSolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M14 10h8v10h-2v2H4v-2H2V4h2V2h10v8Zm2 4h-2v2h2v2h-2v-2h-2v-2h-2v2H8v2H6v2h10v-2h2v2h2v-6h-2v-2h-2v2ZM8 8H6v2h2v2h2v-2h2V8h-2V6H8v2Zm10 0h-2V6h2v2Zm4 0h-2V6h2v2Zm-2-2h-2V4h2v2Zm-2-2h-2V2h2v2Zm4 0h-2V2h2v2Z"/>
    </svg>
  );
}
