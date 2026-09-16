import React from 'react';
import type { GameItem } from '../types';
import { ScoreBadge } from './ScoreBadge';
import { Layers, Sparkles } from 'lucide-react';

interface GameCardProps {
  game: GameItem;
  onClick: () => void;
}

export const GameCard: React.FC<GameCardProps> = ({ game, onClick }) => {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Открыть карточку игры ${game.title}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
      className="group relative bg-slate-900/70 hover:bg-slate-800/80 border border-slate-800 hover:border-slate-700/80 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:shadow-orange-500/10 transition-all duration-300 flex flex-col cursor-pointer transform hover:-translate-y-1"
    >
      {/* Cover Image */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-950">
        {game.cover_image ? (
          <img
            src={game.cover_image}
            alt={game.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
            onError={(e) => {
              (e.target as HTMLImageElement).src =
                'https://images.unsplash.com/photo-1550745165-9bc0b252726f?auto=format&fit=crop&w=600&q=80';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-900 to-slate-950 text-slate-600">
            <Layers className="w-10 h-10 opacity-30" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/20 to-transparent opacity-80" />

        {/* Floating Scores */}
        <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-slate-950/80 backdrop-blur-md px-2 py-1 rounded-xl border border-white/10 shadow-lg">
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Meta</span>
            <ScoreBadge score={game.max_metascore} type="meta" size="sm" />
          </div>
          <div className="w-[1px] h-6 bg-slate-800 my-auto" />
          <div className="flex flex-col items-center">
            <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">User</span>
            <ScoreBadge score={game.avg_userscore} type="user" size="sm" />
          </div>
        </div>

        {/* AI Analyzed badge indicator */}
        <div className="absolute bottom-2 left-3 flex items-center gap-1 text-[11px] text-amber-400 font-medium">
          <Sparkles className="w-3 h-3 text-amber-400" />
          <span>AI Insight</span>
        </div>
      </div>

      {/* Card Content */}
      <div className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-bold text-base text-slate-100 group-hover:text-amber-400 transition-colors line-clamp-1">
            {game.title}
          </h3>
          <p className="text-xs text-slate-400 mt-1 line-clamp-1">
            {game.developer || 'Разработчик не указан'}
          </p>
        </div>

        {/* Platforms Badges */}
        <div className="mt-3 pt-3 border-t border-slate-800/80 flex flex-wrap gap-1.5">
          {game.platforms && game.platforms.length > 0 ? (
            game.platforms.slice(0, 3).map((p) => (
              <span
                key={p.platform}
                className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 text-slate-300 border border-slate-800"
              >
                {p.platform}
              </span>
            ))
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-slate-950 text-slate-400 border border-slate-800">
              Все платформы
            </span>
          )}
          {game.platforms && game.platforms.length > 3 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-slate-800 text-slate-400">
              +{game.platforms.length - 3}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
