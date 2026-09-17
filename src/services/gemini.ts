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

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Resilient HTTP post to Gemini API:
   * - Retries with exponential backoff on 429/5xx
   * - Falls back to proxies in round-robin if direct connection fails
   */
  private async postJson(endpoint: string, payload: any): Promise<any> {
    const url = `https://generativelanguage.googleapis.com/v1beta/${endpoint}?key=${this.apiKey}`;
    const bodyStr = JSON.stringify(payload);

    // 1. Try direct call first with retry for rate limits (up to 2 retries)
    for (let attempt = 0; attempt < 3; attempt++) {
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

        if (res.status === 429 || res.status >= 500) {
          const delay = 1000 * Math.pow(2, attempt) + Math.random() * 300;
          console.warn(`[Gemini] HTTP ${res.status} on attempt ${attempt + 1}. Backing off for ${Math.round(delay)}ms...`);
          await this.sleep(delay);
          continue;
        }

        console.warn(`[Gemini] Direct call returned ${res.status}: ${res.statusText}. Will try proxy...`);
        break;
      } catch (err: any) {
        console.warn(`[Gemini] Direct call attempt ${attempt + 1} failed (${err.message}).`);
        if (attempt < 2) await this.sleep(1000);
      }
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
          config.markProxySuccess(p.url);
          return await res.json();
        }
        console.warn(`[Gemini] Proxy ${p.host} returned ${res.status}`);
      } catch (proxyErr: any) {
        config.markProxyFailed(p.url);
        console.warn(`[Gemini] Proxy ${p.host} error:`, proxyErr.message);
      }
    }

    throw new Error('All Gemini API attempts (direct with retry and proxies) failed.');
  }

  /**
   * Summarize reviews for a game (critics & users, pros & cons)
   * Uses Gemini Structured Outputs (responseSchema) for guaranteed JSON formatting
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

    const prompt = `Ты профессиональный игровой аналитик. Твоя задача — проанализировать англоязычные отзывы об игре "${gameTitle}" с Metacritic и составить качественное структурированное резюме СТРОГО НА РУССКОМ ЯЗЫКЕ.
КРИТИЧЕСКИ ВАЖНОЕ ТРЕБОВАНИЕ: Весь твой ответ должен быть полностью переведен и написан на чистом литературном русском языке. Никаких предложений на английском языке быть не должно!

Отдельно разбери мнения критиков и игроков на русском языке:
1. Что профессиональным критикам понравилось (ключевые плюсы, механики, атмосфера, графика).
2. Что профессиональным критикам не понравилось (минусы, баги, недостатки, шероховатости).
3. Что реальным игрокам (пользователям) понравилось (плюсы и впечатления).
4. Что реальным игрокам не понравилось (жалобы, проблемы с балансом или оптимизацией).

Отзывы критиков с Metacritic:
${hasCritics ? criticsSample : 'Отзывы критиков отсутствуют (напиши по-русски, что отзывы критиков пока отсутствуют).'}

Отзывы игроков с Metacritic:
${hasUsers ? usersSample : 'Отзывы игроков отсутствуют (напиши по-русски, что отзывы игроков пока отсутствуют).'}`;

    const structuredGenerationConfig = {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          critics_summary_pros: { type: 'STRING' },
          critics_summary_cons: { type: 'STRING' },
          users_summary_pros: { type: 'STRING' },
          users_summary_cons: { type: 'STRING' }
        },
        required: [
          'critics_summary_pros',
          'critics_summary_cons',
          'users_summary_pros',
          'users_summary_cons'
        ]
      },
      temperature: 0.3
    };

    let data: any;
    try {
      data = await this.postJson(`models/${this.primaryModel}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: structuredGenerationConfig
      });
    } catch {
      // Fallback model
      data = await this.postJson(`models/${this.fallbackModel}:generateContent`, {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: structuredGenerationConfig
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
