import React, { useState } from 'react';
import { Package, Pill, Activity, Sparkles } from 'lucide-react';

interface ProductImageProps {
  src?: string;
  alt: string;
  category?: string;
  className?: string;
}

export const ProductImage: React.FC<ProductImageProps> = ({ src, alt, category = '', className = 'w-full h-36' }) => {
  const [failed, setFailed] = useState(false);

  if (src && !failed) {
    return (
      <div className={`overflow-hidden bg-slate-100 dark:bg-slate-800 ${className}`}>
        <img
          src={src}
          alt={alt}
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  const lower = `${category} ${alt}`.toLowerCase();
  const Icon = lower.includes('device') || lower.includes('monitor')
    ? Activity
    : lower.includes('tablet') || lower.includes('capsule') || lower.includes('medicine') || lower.includes('syrup')
      ? Pill
      : lower.includes('skin') || lower.includes('vitamin')
        ? Sparkles
        : Package;

  return (
    <div className={`flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br from-slate-100 to-slate-200/70 dark:from-slate-800 dark:to-slate-900 text-slate-500 dark:text-slate-400 px-3 text-center ${className}`}>
      <Icon className="w-7 h-7 text-teal-700 dark:text-teal-400 opacity-80" />
      <span className="text-[11px] font-medium line-clamp-1 max-w-full">{alt}</span>
    </div>
  );
};
