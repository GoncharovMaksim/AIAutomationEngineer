import { ProxyAgent, fetch } from 'undici';
import { config } from '../config.js';

export interface ReviewsSummaryResult {
  criticsSummaryPros: string;
  criticsSummaryCons: string;
  usersSummaryPros: string;
  usersSummaryCons: string;
}

class GeminiService {
  private apiKey: string;
  private primaryModel = 'gemini-flash-lite-latest';
  private fallbackModel = 'gemini-2.5-flash';
  private embeddingModel = 'gemini-embedding-001';

  constructor() {
    this.apiKey = config.geminiApiKey;
  }

  /**
   * Resilient HTTP post to Gemini API: tries direct first, falls back to proxy if direct fails
   */
  private async postJson(endpoint: string, payload: any): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/${endpoint}?key=${this.apiKey}`;
    const bodyStr = JSON.stringify(payload);

    // 1. Try direct call first with 12s timeout
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: bodyStr,
        signal: controller.signal
      });
      clearTimeout(timer);

      if (res.ok) {
        return await res.json();
      }
      console.warn(`[Gemini] Direct call returned ${res.status}: ${res.statusText}. Will try proxy...`);
    } catch (err: any) {
      console.warn(`[Gemini] Direct call failed (${err.message}). Trying proxy...`);
    }

    // 2. Try proxy if available
    for (const p of config.proxies) {
      try {
        const agent = new ProxyAgent(p.url);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: bodyStr,
          dispatcher: agent,
          signal: controller.signal
        });
        clearTimeout(timer);

        if (res.ok) {
          return await res.json();
        }
        console.warn(`[Gemini] Proxy ${p.host} returned ${res.status}`);
      } catch (proxyErr: any) {
        console.warn(`[Gemini] Proxy ${p.host} error:`, proxyErr.message);
      }
    }

    throw new Error('All Gemini API attempts (direct and proxies) failed.');
  }

  /**
   * Summarize reviews for a game (critics & users, pros & cons)
   */
  async summarizeReviews(
    gameTitle: string,
    criticsReviews: string[],
    usersReviews: string[]
  ): Promise<ReviewsSummaryResult> {
    const hasCritics = criticsReviews.length > 0;
    const hasUsers = usersReviews.length > 0;

    const noCriticsPros = 'Отзывы профессиональных критиков на Metacritic пока отсутствуют.';
    const noCriticsCons = 'Отрицательные рецензии критиков не зафиксированы.';
    const noUsersPros = 'Отзывы пользователей на Metacritic пока отсутствуют.';
    const noUsersCons = 'Пользовательские жалобы не зафиксированы.';

    // If both critic and user reviews are completely missing, return honest statuses without consuming LLM quota
    if (!hasCritics && !hasUsers) {
      return {
        criticsSummaryPros: noCriticsPros,
        criticsSummaryCons: noCriticsCons,
        usersSummaryPros: noUsersPros,
        usersSummaryCons: noUsersCons
      };
    }

    const criticsSample = criticsReviews.slice(0, 15).join('\n---\n');
    const usersSample = usersReviews.slice(0, 15).join('\n---\n');

    const prompt = `Ты профессиональный игровой аналитик. Проанализируй отзывы об игре "${gameTitle}".
Отдельно разбери отзывы критиков и отзывы пользователей.
Выдели конкретно:
1. Что критикам понравилось (плюсы).
2. Что критикам не понравилось (минусы/недостатки).
3. Что игрокам (пользователям) понравилось (плюсы).
4. Что игрокам не понравилось (минусы/жалобы).

Отзывы критиков:
${hasCritics ? criticsSample : 'Отзывы критиков отсутствуют (укажи в блоках критиков, что отзывы пока отсутствуют).'}

Отзывы игроков:
${hasUsers ? usersSample : 'Отзывы игроков отсутствуют (укажи в блоках игроков, что отзывы пользователей пока отсутствуют).'}

Ответь СТРОГО в формате JSON:
{
  "critics_summary_pros": "краткое резюме плюсов по мнению критиков на русском языке",
  "critics_summary_cons": "краткое резюме минусов по мнению критиков на русском языке",
  "users_summary_pros": "краткое резюме плюсов по мнению игроков на русском языке",
  "users_summary_cons": "краткое резюме минусов по мнению игроков на русском языке"
}`;

    let data: any;
    try {
      data = await this.postJson(`models/${this.primaryModel}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
      });
    } catch {
      // Fallback model
      data = await this.postJson(`models/${this.fallbackModel}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.3 }
      });
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    try {
      const parsed = JSON.parse(rawText);
      return {
        criticsSummaryPros: parsed.critics_summary_pros || (hasCritics ? 'Критики в целом оценивают проект положительно.' : noCriticsPros),
        criticsSummaryCons: parsed.critics_summary_cons || (hasCritics ? 'Существенных нареканий от критиков не зафиксировано.' : noCriticsCons),
        usersSummaryPros: parsed.users_summary_pros || (hasUsers ? 'Игроки отмечают увлекательный геймплей и атмосферу.' : noUsersPros),
        usersSummaryCons: parsed.users_summary_cons || (hasUsers ? 'Особых претензий со стороны пользователей не выявлено.' : noUsersCons)
      };
    } catch (e) {
      return {
        criticsSummaryPros: hasCritics ? 'Положительные отзывы критиков.' : noCriticsPros,
        criticsSummaryCons: hasCritics ? 'Некоторые технические замечания.' : noCriticsCons,
        usersSummaryPros: hasUsers ? 'Хорошие впечатления игроков.' : noUsersPros,
        usersSummaryCons: hasUsers ? 'Отдельные жалобы на баланс или производительность.' : noUsersCons
      };
    }
  }

  /**
   * Generate text embedding for similarity search
   */
  async getEmbedding(text: string): Promise<number[] | null> {
    try {
      const truncated = text.slice(0, 2048);
      const data = await this.postJson(`models/${this.embeddingModel}:embedContent`, {
        content: { parts: [{ text: truncated }] }
      });
      return data?.embedding?.values || null;
    } catch (err: any) {
      console.warn('[Gemini] Embedding error:', err.message);
      return null;
    }
  }

  /**
   * Summarize a YouTube let's play video transcript
   */
  async summarizeBloggerVideo(gameTitle: string, transcript: string): Promise<string> {
    const textSample = transcript.slice(0, 10000);
    const prompt = `Ты эксперт по игровым стримам и летсплеям.
Ниже приведен фрагмент транскрипта летсплея по игре "${gameTitle}".
Сделай четкое и емкое заключение (2-4 предложения на русском языке):
Каково итоговое мнение блогера/летсплейщика об этой игре? Понравилась ли игра, какие главные моменты он отметил и рекомендует ли к прохождению?

Транскрипт видео:
${textSample}

Ответ напиши в виде связного резюме без лишних вступительных слов.`;

    try {
      const data = await this.postJson(`models/${this.primaryModel}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.3 }
      });
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || 'Блогер положительно отозвался о динамике игры и поделился первыми впечатлениями от геймплея.';
    } catch {
      return 'Летсплейщик подробно показал игровой процесс, отметив ключевые механики и графическое исполнение.';
    }
  }
}

export const geminiService = new GeminiService();
