import React from 'react';
import { Search, SlidersHorizontal, ArrowUpDown, X } from 'lucide-react';

interface FilterBarProps {
  search: string;
  onSearchChange: (val: string) => void;
  selectedPlatform: string;
  onPlatformChange: (val: string) => void;
  availablePlatforms: string[];
  sortBy: 'recent' | 'metascore' | 'userscore' | 'title';
  onSortByChange: (val: 'recent' | 'metascore' | 'userscore' | 'title') => void;
  totalFiltered: number;
}

export const FilterBar: React.FC<FilterBarProps> = ({
  search,
  onSearchChange,
  selectedPlatform,
  onPlatformChange,
  availablePlatforms,
  sortBy,
  onSortByChange,
  totalFiltered
}) => {
  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-4 shadow-xl backdrop-blur-sm mb-6 flex flex-col md:flex-row gap-4 items-stretch md:items-center justify-between">
      {/* Search Input */}
      <div className="relative flex-1">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Поиск игры по названию..."
          className="w-full pl-10 pr-9 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 transition-all"
        />
        {search && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Filters & Sorting */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Platform Dropdown */}
        <div className="relative flex items-center">
          <SlidersHorizontal className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <select
            value={selectedPlatform}
            onChange={(e) => onPlatformChange(e.target.value)}
            className="pl-9 pr-8 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-300 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 appearance-none cursor-pointer"
          >
            <option value="">Все платформы</option>
            {availablePlatforms.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>

        {/* Sort Dropdown */}
        <div className="relative flex items-center">
          <ArrowUpDown className="w-4 h-4 text-slate-400 absolute left-3 pointer-events-none" />
          <select
            value={sortBy}
            onChange={(e) => onSortByChange(e.target.value as any)}
            className="pl-9 pr-8 py-2 bg-slate-950/70 border border-slate-800 rounded-xl text-xs sm:text-sm text-slate-300 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/50 appearance-none cursor-pointer"
          >
            <option value="recent">Сначала новые добавленные</option>
            <option value="metascore">По рейтингу Metascore (критики)</option>
            <option value="userscore">По рейтингу Userscore (игроки)</option>
            <option value="title">По названию (А-Я)</option>
          </select>
        </div>

        {/* Count Badge */}
        <div className="text-xs text-slate-400 px-3 py-1 rounded-lg bg-slate-950/50 border border-slate-800/50 font-mono">
          Найдено: <span className="font-bold text-amber-400">{totalFiltered}</span>
        </div>
      </div>
    </div>
  );
};
