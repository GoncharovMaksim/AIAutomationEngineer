import React, { useRef, useEffect } from 'react';
import type { CrawlState, WorkerLog, WorkerProgressPayload } from '../types';
import {
  Activity,
  Play,
  Terminal,
  Calendar,
  Layers,
  Database,
  X
} from 'lucide-react';

interface WorkerDashboardProps {
  isOpen: boolean;
  onClose: () => void;
  crawlState: CrawlState | null;
  progress: WorkerProgressPayload | null;
  logs: WorkerLog[];
  isRunning: boolean;
  totalGames: number;
  onForceRun: () => void;
}

export const WorkerDashboard: React.FC<WorkerDashboardProps> = ({
  isOpen,
  onClose,
  crawlState,
  progress,
  logs,
  isRunning,
  totalGames,
  onForceRun
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom of logs
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [logs]);

  if (!isOpen) return null;

  const currentStep = progress?.currentStep || crawlState?.current_step || 'Ожидание запуска';
  const currentGame = progress?.currentGame || crawlState?.current_game || '';
  const processedCount = progress?.processedCount || (isRunning ? 1 : 0);
  const totalTarget = progress?.totalTarget || 20;
  const percent = Math.min(100, Math.round((processedCount / totalTarget) * 100));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto animate-fadeIn">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold text-white">Мониторинг Воркера</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20">
                  Доп. часть 2
                </span>
              </div>
              <p className="text-xs text-slate-400">Реальное время (WebSocket поток)</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Status & Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Status */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-400">Статус воркера</span>
              <div className="flex items-center gap-2 mt-2">
                <span className="relative flex h-3 w-3">
                  {isRunning && (
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                  )}
                  <span
                    className={`relative inline-flex rounded-full h-3 w-3 ${
                      isRunning
                        ? 'bg-sky-500'
                        : crawlState?.status === 'error'
                        ? 'bg-rose-500'
                        : 'bg-emerald-500'
                    }`}
                  ></span>
                </span>
                <span className="font-bold text-sm text-white">
                  {isRunning ? 'Работает' : crawlState?.status === 'error' ? 'Ошибка' : 'В ожидании'}
                </span>
              </div>
            </div>

            {/* Today Date */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <Calendar className="w-3 h-3 text-amber-400" />
                <span>Текущая дата</span>
              </span>
              <span className="font-mono font-bold text-sm text-slate-200 mt-2">
                {crawlState?.last_run_date || new Date().toISOString().split('T')[0]}
              </span>
            </div>

            {/* Total Today */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <Layers className="w-3 h-3 text-purple-400" />
                <span>Собрано сегодня</span>
              </span>
              <span className="font-mono font-bold text-sm text-amber-400 mt-2">
                {crawlState?.total_processed_today || 0} игр
              </span>
            </div>

            {/* Total in DB */}
            <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between">
              <span className="text-[11px] font-medium text-slate-400 flex items-center gap-1">
                <Database className="w-3 h-3 text-emerald-400" />
                <span>Всего в базе SQLite</span>
              </span>
              <span className="font-mono font-bold text-sm text-emerald-400 mt-2">
                {totalGames} игр
              </span>
            </div>
          </div>

          {/* Current Job Progress */}
          <div className="bg-slate-950/80 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-300">Текущий процесс:</span>
                <span className="text-xs text-amber-400 font-medium">
                  {currentStep}
                </span>
                {currentGame && (
                  <span className="text-xs text-slate-400 font-mono truncate max-w-xs">
                    ({currentGame})
                  </span>
                )}
              </div>
              <span className="text-xs font-mono font-bold text-slate-400">
                {isRunning ? `${processedCount} / ${totalTarget}` : 'Готов к работе'}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2.5 bg-slate-900 rounded-full overflow-hidden border border-slate-800 relative">
              <div
                className={`h-full transition-all duration-500 rounded-full ${
                  isRunning
                    ? 'bg-gradient-to-r from-sky-500 via-amber-500 to-orange-500 animate-pulse'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${isRunning ? percent : 100}%` }}
              />
            </div>

            {/* Force Run Button */}
            <div className="mt-4 flex items-center justify-between pt-3 border-t border-slate-800/80">
              <div className="text-xs text-slate-400">
                Авто-запуск настроен: <strong>1 раз в час</strong> (0 * * * *). Ротация по дням активна.
              </div>
              <button
                onClick={onForceRun}
                disabled={isRunning}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold transition-all shadow-lg cursor-pointer ${
                  isRunning
                    ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                    : 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 active:scale-95 shadow-orange-500/20'
                }`}
              >
                {isRunning ? (
                  <>
                    <Activity className="w-4 h-4 animate-spin" />
                    <span>Идет обработка...</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4 fill-current" />
                    <span>Запустить сбор 20 игр прямо сейчас</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Live Log Terminal */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-300">
                <Terminal className="w-4 h-4 text-emerald-400" />
                <span>Живой лог событий воркера (Live Stream)</span>
              </div>
              <span className="text-[11px] text-slate-500 font-mono">
                {logs.length} сообщений
              </span>
            </div>

            <div
              ref={terminalRef}
              className="bg-black/90 border border-slate-800 rounded-2xl p-4 font-mono text-xs h-64 overflow-y-auto space-y-1.5 shadow-inner"
            >
              {logs.length === 0 ? (
                <div className="text-slate-500 text-center py-8">
                  Логи пока отсутствуют. Нажмите кнопку запуска сбора выше.
                </div>
              ) : (
                logs.map((log, idx) => {
                  const time = log.timestamp ? log.timestamp.split('T')[1]?.slice(0, 8) : '';
                  let levelColor = 'text-sky-400';
                  let icon = 'ℹ';
                  if (log.level === 'success') {
                    levelColor = 'text-emerald-400';
                    icon = '✓';
                  } else if (log.level === 'warn') {
                    levelColor = 'text-amber-400';
                    icon = '⚠';
                  } else if (log.level === 'error') {
                    levelColor = 'text-rose-400';
                    icon = '✕';
                  }

                  return (
                    <div key={idx} className="flex items-start gap-2 leading-relaxed">
                      <span className="text-slate-600 select-none">[{time}]</span>
                      <span className={`font-bold ${levelColor} select-none`}>
                        {icon} [{log.level.toUpperCase()}]:
                      </span>
                      <span className="text-slate-300 flex-1 break-all">{log.message}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
