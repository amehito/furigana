import { furiganaService } from '@/util/common';

type ReadingContext = { prev: string; next: string };

const DEFAULT_CONTEXT: ReadingContext = { prev: '', next: '' };

export const service = {
  async getReading(word: string, context: ReadingContext = DEFAULT_CONTEXT) {
    const html = await furiganaService.convert(word, context);
    return extractReadingFromRuby(html);
  },

  async getRuby(word: string, context: ReadingContext = DEFAULT_CONTEXT) {
    return furiganaService.convert(word, context);
  },
};

function extractReadingFromRuby(html: string) {
  const readings = Array.from(html.matchAll(/<rt>(.*?)<\/rt>/g)).map((match) => match[1] ?? '');
  if (readings.length > 0) {
    return readings.join('');
  }

  return html.replace(/<[^>]+>/g, '').trim();
}
