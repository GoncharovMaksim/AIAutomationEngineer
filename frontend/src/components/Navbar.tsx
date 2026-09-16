import React from 'react';
import { Gamepad2, Activity, Play, Sparkles, Terminal, ShieldCheck, Key } from 'lucide-react';
import type { CrawlState } from '../types';

interface NavbarProps {
  crawlState: CrawlState | null;
  isRunning: boolean;
  totalGames: number;
  isAdmin: boolean;
  freeRunsRemaining: number;
  onOpenMonitor: () => void;
  onForceRun: () => void;
  onOpenAuth: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  crawlState,
  isRunning,
  totalGames,
  isAdmin,
  freeRunsRemaining,
  onOpenMonitor,
  onForceRun,
  onOpenAuth
}) => {
  return (
    <header className="sticky top-0 z-30 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 transition-all">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2">
        {/* Brand */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-tr from-amber-500 via-orange-500 to-rose-500 flex items-center justify-center shadow-lg shadow-orange-500/20 ring-1 ring-white/20 shrink-0">
            <Gamepad2 className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
          </div>
          <div className="flex flex-col justify-center">
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="font-extrabold text-sm sm:text-lg tracking-tight bg-gradient-to-r from-white via-slate-200 to-slate-400 bg-clip-text text-transparent whitespace-nowrap">
                Metacritic <span className="text-amber-400">AI</span>
              </span>
              <span className="hidden md:inline-flex items-center gap-1 text-[11px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                <Sparkles className="w-3 h-3" /> Gemini 2.5
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden lg:block leading-tight">
              Автоматический сбор игр, AI-анализ отзывов и летсплеев
            </p>
          </div>
        </div>

        {/* Actions & Status */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Admin / Quota Badge in Corner */}
          <button
            onClick={onOpenAuth}
            className={`flex items-center gap-1 sm:gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg text-xs font-semibold border transition-all cursor-pointer ${
              isAdmin
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                : 'bg-slate-900 border-slate-800 text-slate-300 hover:text-amber-400 hover:border-amber-500/30'
            }`}
            title={isAdmin ? 'Режим Администратора (Безлимит)' : 'Нажмите для авторизации админа'}
          >
            {isAdmin ? (
              <>
                <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="hidden sm:inline">Админ (∞)</span>
                <span className="sm:hidden">Админ</span>
              </>
            ) : (
              <>
                <Key className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="hidden sm:inline">Гость ({freeRunsRemaining}/3)</span>
                <span className="sm:hidden">{freeRunsRemaining}/3</span>
              </>
            )}
          </button>

          {/* Status & Counter Chip */}
          <button
            onClick={onOpenMonitor}
            className="flex items-center gap-1.5 sm:gap-2 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-900/90 hover:bg-slate-800 border border-slate-800 transition-all cursor-pointer group"
            title="Открыть мониторинг работы воркера"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
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
            <span className="text-xs font-medium text-slate-300 group-hover:text-white hidden lg:inline">
              {isRunning ? 'Парсинг...' : 'Ожидание'}
            </span>
            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-mono font-medium whitespace-nowrap">
              {totalGames} <span className="hidden sm:inline text-slate-400">игр</span>
            </span>
          </button>

          {/* Terminal Logs Button */}
          <button
            onClick={onOpenMonitor}
            className="p-1.5 sm:p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 hover:text-white transition-all cursor-pointer shrink-0"
            title="Консоль мониторинга воркера"
          >
            <Terminal className="w-4 h-4" />
          </button>

          {/* Force Run Button */}
          <button
            onClick={onForceRun}
            disabled={isRunning}
            className={`flex items-center gap-1 sm:gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg font-medium text-xs transition-all shadow-md cursor-pointer whitespace-nowrap shrink-0 ${
              isRunning
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
                : 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-semibold shadow-orange-500/20 active:scale-95'
            }`}
          >
            {isRunning ? (
              <>
                <Activity className="w-3.5 h-3.5 animate-spin shrink-0" />
                <span className="hidden sm:inline">Идет сбор...</span>
                <span className="sm:hidden text-[11px]">Сбор...</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                <span className="hidden sm:inline">Собрать 20 игр</span>
                <span className="sm:hidden text-[11px]">Собрать</span>
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
