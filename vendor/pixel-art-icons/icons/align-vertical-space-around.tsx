import React from 'react';
import type { IconProps } from '../types';

export function AlignVerticalSpaceAroundIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M18 10v4h-2v-4zm-2-2v2H8V8zm-8 2v4H6v-4zm8 4v2H8v-2zm6-10H2v2h20zm0 14H2v2h20z"/>
    </svg>
  );
}
