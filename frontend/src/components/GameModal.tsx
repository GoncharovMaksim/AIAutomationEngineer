import React, { useEffect, useState } from 'react';
import type { GameDetail } from '../types';
import { ScoreBadge } from './ScoreBadge';
import {
  X,
  ExternalLink,
  ThumbsUp,
  ThumbsDown,
  Video,
  Play,
  Sparkles,
  Users,
  Award,
  Layers,
  Eye
} from 'lucide-react';
import { getProxiedImageUrl } from '../utils/imageUrl';

interface GameModalProps {
  gameId: string | null;
  onClose: () => void;
  onSelectGame: (id: string) => void;
}

export const GameModal: React.FC<GameModalProps> = ({ gameId, onClose, onSelectGame }) => {
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameId) {
      setGame(null);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/api/games/${gameId}`)
      .then((res) => {
        if (!res.ok) throw new Error('Не удалось загрузить данные игры');
        return res.json();
      })
      .then((data) => {
        if (data.success) {
          setGame(data.data);
        } else {
          setError(data.error || 'Ошибка загрузки');
        }
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gameId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (gameId) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [gameId, onClose]);

  if (!gameId) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md overflow-y-auto animate-fadeIn"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto max-h-[90vh] flex flex-col">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-20 p-2 rounded-full bg-slate-950/70 hover:bg-slate-800 border border-white/10 text-slate-300 hover:text-white transition-all cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="p-16 flex flex-col items-center justify-center gap-3">
            <div className="w-10 h-10 border-4 border-amber-500/20 border-t-amber-500 rounded-full animate-spin" />
            <p className="text-sm text-slate-400">Загрузка информации об игре...</p>
          </div>
        ) : error || !game ? (
          <div className="p-12 text-center">
            <p className="text-rose-400">{error || 'Игра не найдена'}</p>
            <button
              onClick={onClose}
              className="mt-4 px-4 py-2 bg-slate-800 rounded-xl text-sm text-slate-200"
            >
              Закрыть
            </button>
          </div>
        ) : (
          <div className="overflow-y-auto flex-1">
            {/* Hero Header with Backdrop & Prominent Cover Art */}
            <div className="relative w-full bg-slate-950 overflow-hidden border-b border-slate-800/80">
              {/* Blurred Background Banner */}
              {game.cover_image && (
                <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  <img
                    src={getProxiedImageUrl(game.cover_image)}
                    alt=""
                    aria-hidden="true"
                    className="w-full h-full object-cover blur-xl opacity-25 scale-110 transform"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-900 via-slate-900/80 to-transparent" />
                </div>
              )}

              {/* Main Game Header Info */}
              <div className="relative p-6 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
                {/* Prominent Game Poster */}
                <div className="relative w-28 sm:w-36 aspect-[3/4] rounded-2xl overflow-hidden shadow-2xl border-2 border-white/10 bg-slate-950 flex-shrink-0 group">
                  {game.cover_image ? (
                    <img
                      src={getProxiedImageUrl(game.cover_image)}
                      alt={game.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.opacity = '0';
                      }}
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-slate-900 text-slate-500 p-2 text-center">
                      <Layers className="w-8 h-8 opacity-40 mb-1" />
                      <span className="text-[10px]">Нет постера</span>
                    </div>
                  )}
                </div>

                {/* Title & Key Attributes */}
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-amber-500/10 text-amber-300 border border-amber-500/20">
                      Metacritic Game
                    </span>
                    {game.platforms && game.platforms.length > 0 && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
                        {game.platforms.length} {game.platforms.length === 1 ? 'платформа' : 'платформы'}
                      </span>
                    )}
                  </div>

                  <h1 id="game-modal-title" className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight leading-snug">
                    {game.title}
                  </h1>

                  <p className="text-sm text-slate-400">
                    Разработчик:{' '}
                    <strong className="text-slate-200 font-semibold">
                      {game.developer || 'Не указан'}
                    </strong>
                  </p>

                  {/* Actions & Links */}
                  <div className="flex flex-wrap items-center gap-2.5 pt-1">
                    {game.video_url ? (
                      <a
                        href={game.video_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-orange-600 hover:bg-orange-500 text-white text-xs font-bold shadow-lg shadow-orange-500/20 transition-all cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" />
                        <span>Смотреть трейлер</span>
                        <ExternalLink className="w-3.5 h-3.5 opacity-80" />
                      </a>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 text-slate-400 text-xs border border-slate-700/50">
                        <Video className="w-3.5 h-3.5 text-slate-500" />
                        <span>Трейлер не предоставлен</span>
                      </span>
                    )}

                    <a
                      href={`https://www.metacritic.com/game/${game.slug}/`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium border border-slate-700 transition-all cursor-pointer"
                    >
                      <span>Открыть на Metacritic</span>
                      <ExternalLink className="w-3.5 h-3.5 opacity-70" />
                    </a>
                  </div>
                </div>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Platforms & Ratings Matrix */}
              <div className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                  <Layers className="w-4 h-4 text-amber-400" />
                  <span>Платформы и рейтинги Metacritic</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {game.platforms.map((p) => (
                    <div
                      key={p.platform}
                      className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex flex-col justify-between"
                    >
                      <span className="text-xs font-bold text-slate-200 line-clamp-1">
                        {p.platform}
                      </span>
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-800/80">
                        <div className="flex flex-col">
                          <span className="text-[10px] text-slate-400 uppercase">Metascore</span>
                          <ScoreBadge score={p.metascore} type="meta" size="sm" />
                        </div>
                        <div className="flex flex-col items-end">
                          <span className="text-[10px] text-slate-400 uppercase">Userscore</span>
                          <ScoreBadge score={p.userscore} type="user" size="sm" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Description */}
              {game.description && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
                    Об игре
                  </h2>
                  <p className="text-sm text-slate-300 leading-relaxed bg-slate-950/40 p-4 rounded-xl border border-slate-800/50">
                    {game.description}
                  </p>
                </div>
              )}

              {/* AI Reviews Summary */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-200">
                    AI-резюме отзывов (Gemini 2.5 Flash Lite)
                  </h2>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Critics Reviews */}
                  <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3 text-slate-200 font-semibold text-sm">
                      <Award className="w-4 h-4 text-sky-400" />
                      <span>Отзывы критиков</span>
                    </div>
                    <div className="space-y-3 flex-1">
                      <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mb-1">
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Что понравилось:</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-normal">
                          {game.reviews?.critics_summary_pros || 'Критики высоко оценили атмосферу и стиль.'}
                        </p>
                      </div>
                      <div className="bg-rose-950/20 border border-rose-900/30 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400 mb-1">
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>Что не понравилось:</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-normal">
                          {game.reviews?.critics_summary_cons || 'Существенных нареканий со стороны критиков нет.'}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Users Reviews */}
                  <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4 flex flex-col">
                    <div className="flex items-center gap-2 mb-3 text-slate-200 font-semibold text-sm">
                      <Users className="w-4 h-4 text-purple-400" />
                      <span>Отзывы игроков</span>
                    </div>
                    <div className="space-y-3 flex-1">
                      <div className="bg-emerald-950/20 border border-emerald-900/30 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400 mb-1">
                          <ThumbsUp className="w-3.5 h-3.5" />
                          <span>Что понравилось:</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-normal">
                          {game.reviews?.users_summary_pros || 'Игроки отмечают увлекательный геймплей.'}
                        </p>
                      </div>
                      <div className="bg-rose-950/20 border border-rose-900/30 rounded-xl p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-rose-400 mb-1">
                          <ThumbsDown className="w-3.5 h-3.5" />
                          <span>Что не понравилось:</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-normal">
                          {game.reviews?.users_summary_cons || 'Особых жалоб от игроков не зафиксировано.'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Bonus 1: YouTube Let's Play & Blogger Conclusion */}
              <div className="bg-slate-950/70 border border-slate-800/90 rounded-2xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Video className="w-5 h-5 text-red-500" />
                    <span className="text-sm font-bold text-white">
                      Популярный летсплей YouTube
                    </span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-medium">
                      Доп. часть 1
                    </span>
                  </div>
                  <a
                    href={game.youtube?.video_url || `https://www.youtube.com/results?search_query=${encodeURIComponent(game.title + ' gameplay lets play')}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                  >
                    <span>Открыть на YouTube</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>

                {game.youtube ? (
                  <div className="flex flex-col md:flex-row gap-4 items-start">
                    {/* Video Embed or Thumbnail */}
                    <div className="w-full md:w-5/12 aspect-video bg-black rounded-xl overflow-hidden shadow-md flex items-center justify-center">
                      {game.youtube.video_id ? (
                        <iframe
                          src={`https://www.youtube-nocookie.com/embed/${game.youtube.video_id}`}
                          title={game.youtube.video_title}
                          className="w-full h-full border-0"
                          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                          allowFullScreen
                        />
                      ) : (
                        <a
                          href={game.youtube.video_url}
                          target="_blank"
                          rel="noreferrer"
                          className="w-full h-full flex flex-col items-center justify-center bg-slate-900 hover:bg-slate-850 p-4 text-center group cursor-pointer"
                        >
                          <div className="w-12 h-12 rounded-full bg-red-600 flex items-center justify-center mb-2 group-hover:scale-110 transition-transform shadow-lg shadow-red-600/30">
                            <Play className="w-6 h-6 text-white fill-current ml-0.5" />
                          </div>
                          <span className="text-xs font-semibold text-slate-200 group-hover:text-white">Смотреть летсплей на YouTube</span>
                        </a>
                      )}
                    </div>

                    {/* Blogger conclusion */}
                    <div className="flex-1 space-y-2">
                      <h4 className="text-xs font-bold text-slate-100 line-clamp-2">
                        {game.youtube.video_title}
                      </h4>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>Автор: <strong className="text-slate-200">{game.youtube.channel_name || 'YouTube Блогер'}</strong></span>
                        <span>•</span>
                        <span className="flex items-center gap-1 font-mono">
                          <Eye className="w-3 h-3 text-slate-400" />
                          {game.youtube.views_count ? game.youtube.views_count.toLocaleString() : '10,000+'} просмотров
                        </span>
                      </div>
                      <div className="mt-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-300 mb-1">
                          <Sparkles className="w-3.5 h-3.5" />
                          <span>Заключение блогера об игре:</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">
                          {game.youtube.blogger_conclusion}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 bg-slate-900/60 rounded-xl border border-slate-800">
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Поиск и аналитика самого популярного летсплея игры <strong>{game.title}</strong> на YouTube:
                    </p>
                    <a
                      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(game.title + ' gameplay walkthrough lets play')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-500 text-white text-xs font-semibold shadow-md shadow-red-500/20 transition-all cursor-pointer whitespace-nowrap"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Искать на YouTube</span>
                      <ExternalLink className="w-3 h-3 ml-0.5 opacity-80" />
                    </a>
                  </div>
                )}
              </div>

              {/* Similar Games */}
              {game.similarGames && game.similarGames.length > 0 && (
                <div>
                  <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-1.5">
                    <span>Похожие игры в сервисе</span>
                    <span className="text-[10px] font-mono text-slate-500">(по векторным эмбеддингам)</span>
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {game.similarGames.map((sim) => (
                      <div
                        key={sim.id}
                        role="button"
                        tabIndex={0}
                        aria-label={`Перейти к похожей игре ${sim.title}`}
                        onClick={() => onSelectGame(sim.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            onSelectGame(sim.id);
                          }
                        }}
                        className="group p-2.5 rounded-xl bg-slate-950/80 hover:bg-slate-800 border border-slate-800/80 hover:border-amber-500/40 focus:border-amber-500 focus:outline-none transition-all cursor-pointer flex flex-col"
                      >
                        <div className="aspect-[16/10] w-full rounded-lg overflow-hidden bg-slate-900 mb-2 relative">
                          {sim.cover_image ? (
                            <img
                              src={sim.cover_image}
                              alt={sim.title}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-600">
                              <Layers className="w-6 h-6" />
                            </div>
                          )}
                          {sim.similarityScore > 0 && (
                            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-slate-950/90 text-[10px] font-mono text-amber-400 border border-white/10">
                              {Math.round(sim.similarityScore * 100)}% совпадение
                            </span>
                          )}
                        </div>
                        <h4 className="text-xs font-bold text-slate-200 group-hover:text-amber-400 line-clamp-1">
                          {sim.title}
                        </h4>
                        <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">
                          {sim.developer || 'Разработчик не указан'}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
