import React from 'react';
import type { IconProps } from '../types';

export function AlignVerticalSpaceBetweenIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M4 19v-3h2v3zm-2 2v-2h20v2zm16-2v-3h2v3zM6 16v-2h12v2zm1-8V5h2v3zm2 2V8h6v2zm6-2V5h2v3zM2 5V3h20v2z"/>
    </svg>
  );
}
