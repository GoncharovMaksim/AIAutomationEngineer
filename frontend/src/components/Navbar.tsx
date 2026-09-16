import React from 'react';
import { Gamepad2, Activity, Play, Sparkles, Terminal } from 'lucide-react';
import type { CrawlState } from '../types';

interface NavbarProps {
  crawlState: CrawlState | null;
  isRunning: boolean;
  totalGames: number;
  onOpenMonitor: () => void;
  onForceRun: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  crawlState,
  isRunning,
  totalGames,
  onOpenMonitor,
  onForceRun
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-950/80 backdrop-blur-md border-b border-slate-800/80 transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center shadow-lg shadow-orange-500/20 ring-1 ring-white/20">
            <Gamepad2 className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent">
                Metacritic AI Engine
              </span>
              <span className="hidden sm:inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Sparkles className="w-3 h-3" /> Gemini 2.5 Flash Lite
              </span>
            </div>
            <p className="text-xs text-slate-400 hidden sm:block">
              Автоматический сбор игр, AI-анализ отзывов и летсплеев
            </p>
          </div>
        </div>

        {/* Actions & Status */}
        <div className="flex items-center gap-3">
          {/* Status Chip */}
          <button
            onClick={onOpenMonitor}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 transition-all cursor-pointer group"
            title="Открыть мониторинг работы воркера"
          >
            <span className="relative flex h-2.5 w-2.5">
              {isRunning && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isRunning
                    ? 'bg-sky-500'
                    : crawlState?.status === 'error'
                    ? 'bg-rose-500'
                    : 'bg-emerald-500'
                }`}
              ></span>
            </span>
            <span className="text-xs font-medium text-slate-300 group-hover:text-white">
              {isRunning ? 'Парсинг...' : 'Воркер: Ожидание'}
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 font-mono">
              {totalGames} игр в базе
            </span>
          </button>

          {/* Quick Monitor Drawer Button */}
          <button
            onClick={onOpenMonitor}
            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer"
            title="Консоль мониторинга воркера"
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* Force Run Button */}
          <button
            onClick={onForceRun}
            disabled={isRunning}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium text-xs transition-all shadow-md cursor-pointer ${
              isRunning
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-semibold shadow-orange-500/20 active:scale-95'
            }`}
          >
            {isRunning ? (
              <>
                <Activity className="w-3.5 h-3.5 animate-spin" />
                <span>Идет сбор...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current" />
                <span className="hidden sm:inline">Собрать 20 игр</span>
                <span className="sm:hidden">Собрать</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
