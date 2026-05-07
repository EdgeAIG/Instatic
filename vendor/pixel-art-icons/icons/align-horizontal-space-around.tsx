import React from 'react';
import type { IconProps } from '../types';

export function AlignHorizontalSpaceAroundIcon({ size = 24, color = 'currentColor', className, style }: IconProps): React.ReactElement {
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
      <path d="M10 6h4v2h-4zM8 8h2v8H8zm2 8h4v2h-4zm4-8h2v8h-2zM4 2v20h2V2zm14 0v20h2V2z"/>
    </svg>
  );
}
