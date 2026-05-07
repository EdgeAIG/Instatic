import React from 'react';
import type { IconProps } from '../types';

export function TextWrapIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M9 19H3v-2h6v2Zm6 0h-2v-2h-2v-2H9v-2h2v-2h2V9h2v4h4v2h-4v4Zm-8-4H3v-2h4v2Zm14-2h-2V7h2v6ZM9 11H3V9h6v2Zm10-4H3V5h16v2Z"/>
    </svg>
  );
}
