import React from 'react';
import type { IconProps } from '../types';

export function AlignEndVerticalIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M2 5v4h2V5zm2-2v2h12V3zm12 2v4h2V5zM4 9v2h12V9zm5 6v4h2v-4zm2-2v2h5v-2zm5 2v4h2v-4zm-5 4v2h5v-2zm9-17v20h2V2z"/>
    </svg>
  );
}
