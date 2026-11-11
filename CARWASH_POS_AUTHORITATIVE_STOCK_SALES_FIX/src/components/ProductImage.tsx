import React, { useState } from 'react';
import type { Category } from '../types';

export default function ProductImage({ src, name, category, className = '' }: {
  src?: string; name: string; category: Category; className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const fallback = category === 'beer' ? '🍺' : category === 'spirits' ? '🥃' : '🥤';
  if (!src || failed) {
    return <div className={`flex items-center justify-center text-4xl opacity-60 ${className}`} aria-label={`${name} image unavailable`}>{fallback}</div>;
  }
  return <img src={src} alt={name} loading="lazy" decoding="async" onError={() => setFailed(true)} className={className} />;
}
