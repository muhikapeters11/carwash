import React, { useState } from 'react';
import type { Category } from '../types';

/**
 * Fills the parent frame. Default fit is "contain" so the whole image stays visible
 * (letterboxed if needed). Parent must set width/height on the frame.
 */
export default function ProductImage({
  src,
  name,
  category,
  className = '',
  fit = 'contain',
}: {
  src?: string;
  name: string;
  category: Category;
  className?: string;
  fit?: 'cover' | 'contain';
}) {
  const [failed, setFailed] = useState(false);
  const fallback = category === 'beer' ? '🍺' : category === 'spirits' ? '🥃' : '🥤';

  if (!src || failed) {
    return (
      <div
        className={`w-full h-full flex items-center justify-center text-4xl opacity-60 bg-gray-50 ${className}`}
        aria-label={`${name} image unavailable`}
      >
        {fallback}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className={`w-full h-full ${
        fit === 'cover' ? 'object-cover' : 'object-contain'
      } object-center ${className}`}
    />
  );
}
