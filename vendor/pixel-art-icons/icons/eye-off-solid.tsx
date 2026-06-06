import React from 'react';
import type { IconProps } from '../types';

export function EyeOffSolidIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M22 22h-2v-2h2v2ZM6 10h2v4h2v2h4v2h2v2H8v-2H4v-2H2v-2H0v-4h2V8h4v2Zm14 10h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm0-10h4v2h2v2h2v4h-2v2h-4v-2h-2v-4h-2V8h-4V6H8V4h8v2Zm-2 8h-2v-2h2v2Zm-2-2h-2v-2h2v2Zm-2-2H8V8h2v2ZM8 8H6V6h2v2ZM6 6H4V4h2v2ZM4 4H2V2h2v2Z"/>
    </svg>
  );
}
