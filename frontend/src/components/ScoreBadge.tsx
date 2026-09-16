import React from 'react';

interface ScoreBadgeProps {
  score: number | null | undefined;
  type: 'meta' | 'user';
  size?: 'sm' | 'md' | 'lg';
}

export const ScoreBadge: React.FC<ScoreBadgeProps> = ({ score, type, size = 'md' }) => {
  if (score === null || score === undefined || isNaN(score)) {
    return (
      <span className={`inline-flex items-center justify-center font-bold rounded text-gray-400 bg-gray-800 ${
        size === 'sm' ? 'px-1.5 py-0.5 text-xs' : size === 'lg' ? 'px-3 py-1.5 text-base' : 'px-2 py-1 text-xs'
      }`}>
        tbd
      </span>
    );
  }

  const isMeta = type === 'meta';
  // Metascore is 0-100, Userscore is 0-10
  const normalized = isMeta ? score : score * 10;

  let colorClasses = 'bg-red-500/20 text-red-400 border border-red-500/30';
  if (normalized >= 75) {
    colorClasses = 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  } else if (normalized >= 50) {
    colorClasses = 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
  }

  const sizeClasses = {
    sm: 'px-1.5 py-0.5 text-xs min-w-[24px]',
    md: 'px-2 py-0.5 text-xs font-semibold min-w-[32px]',
    lg: 'px-3 py-1 text-sm font-bold min-w-[40px]'
  }[size];

  return (
    <span className={`inline-flex items-center justify-center rounded font-mono ${colorClasses} ${sizeClasses}`}>
      {isMeta ? Math.round(score) : score.toFixed(1)}
    </span>
  );
};
