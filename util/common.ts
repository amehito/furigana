import * as wanakana from 'wanakana';
import { browser } from 'wxt/browser';
import { KANJI_FIXED_READING_MAP, NUMERIC_COUNTER_READING_MAP, JAPAN_CITY_MAP } from './specials';

interface KanjiEntry {
  readings_on: string[];
  readings_kun: string[];
  [key: string]: any;
}


type KanjiDict = Record<string, KanjiEntry>;
type EntityType = 'place' | 'person' | 'place-or-person' | null;
type ConvertContext = { prev: string; next: string };
type RemoteOverride = {
  text: string;
  reading: string;
  suffix?: string;
  prefix?: string;
};
type NumericCounterConfig = typeof NUMERIC_COUNTER_READING_MAP;

const DEFAULT_CONTEXT: ConvertContext = { prev: '', next: '' };
const KANJI_PATTERN = /[\u4E00-\u9FFF]/;
const ALL_KANJI_PATTERN = /^[\u4E00-\u9FFF]+$/;
const OKURIGANA_PATTERN = /^([\u4E00-\u9FFF]+)([ぁ-ん]+)$/;

class FuriganaProcessor {
  private readonly segmenter = new Intl.Segmenter('ja-JP', { granularity: 'word' });
  private readonly entityMap: Map<string, string>;
  private readonly fixedReadingMap: Map<string, string>;
  private readonly fixedReadingKeys: string[];
  private readonly numericCounterConfig: NumericCounterConfig;
  private overridesCache: RemoteOverride[] = [];
  private overridesPromise: Promise<RemoteOverride[]> | null = null;
  private overridesLoaded = false;
  private readonly kunyomiTable: Record<string, string[]> = {
    行く: ['いく'],
    行う: ['おこなう'],
    食べる: ['たべる'],
    見る: ['みる'],
    下: ['した', 'くだ', 'さ'],
    人: ['ひと', 'じん', 'にん'],
    日: ['ひ', 'にち', 'じつ'],
    生: ['い', 'う', 'せい'],
    上: ['うえ', 'あ', 'じょう'],
    中: ['なか', 'ちゅう'],
  };

  constructor(
    private readonly dict: KanjiDict,
    cityDict: Record<string, string>,
    fixedReadings: Record<string, string>,
    numericCounterConfig: NumericCounterConfig,
    private readonly fallbackConvert: (text: string) => string,
  ) {
    this.fixedReadingMap = new Map(Object.entries(fixedReadings));
    this.fixedReadingKeys = Object.keys(fixedReadings).sort((a, b) => b.length - a.length);
    this.numericCounterConfig = numericCounterConfig;
    this.entityMap = new Map(Object.entries({
      瑞安: 'ずいあん',
      新宿: 'しんじゅく',
      ...cityDict,
    }));

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.remote_overrides) {
        this.overridesCache = this.normalizeOverrides(changes.remote_overrides.newValue);
        this.overridesLoaded = true;
        this.overridesPromise = Promise.resolve(this.overridesCache);
      }
    });
  }

  async process(text: string, context: ConvertContext = DEFAULT_CONTEXT): Promise<string> {
    if (!text.trim()) return text;

    const overrides = await this.getRemoteOverrides();
    let html = '';
    let cursor = 0;

    while (cursor < text.length) {
      const overrideMatch = this.matchRemoteOverrideAt(text, cursor, context, overrides);
      if (overrideMatch) {
        html += this.renderRuby(overrideMatch.text, overrideMatch.reading);
        cursor += overrideMatch.text.length;
        continue;
      }

      const numericMatch = this.matchNumericCounterAt(text, cursor);
      if (numericMatch) {
        html += this.renderRuby(numericMatch.text, numericMatch.reading);
        cursor += numericMatch.text.length;
        continue;
      }

      const fixedMatch = this.matchFixedReadingAt(text, cursor);
      if (fixedMatch) {
        html += this.renderRuby(fixedMatch.text, fixedMatch.reading);
        cursor += fixedMatch.text.length;
        continue;
      }

      const iterator = this.segmenter.segment(text.slice(cursor))[Symbol.iterator]();
      const nextSegment = iterator.next();
      if (nextSegment.done) break;

      const { segment, isWordLike } = nextSegment.value;
      const segmentIndex = text.indexOf(segment, cursor);
      cursor = Math.max(cursor, segmentIndex) + segment.length;

      if (!isWordLike || !KANJI_PATTERN.test(segment)) {
        html += segment;
        continue;
      }

      const localContext = this.createSegmentContext(text, segment, segmentIndex, context);
      const reading = this.resolveReading(segment, localContext, overrides);

      html += reading ? this.renderRuby(segment, reading) : this.fallbackConvert(segment);
    }

    return html;
  }

  private resolveReading(text: string, context: ConvertContext, overrides: RemoteOverride[]): string | null {
    const normalized = text.trim();
    if (!normalized) return null;

    // 第一层：云端/本地补丁 (Remote & Local Overrides)
    const override = this.resolveRemoteOverride(normalized, context, overrides);
    if (override) return override;

    const fixedReading = this.resolveMaintainedFixedReading(normalized);
    if (fixedReading) return fixedReading;

    // 第二层：地名与专有名词判定 (Entity Recognition)
    const entityReading = this.entityMap.get(normalized);
    if (entityReading) return entityReading;

    // 第三层：词法分析与送假名判定 (Morphological & Okurigana)
    const okuriganaReading = this.resolveOkurigana(normalized);
    if (okuriganaReading) return okuriganaReading;

    const compoundReading = this.resolveCompound(normalized);
    if (compoundReading) return compoundReading;

    const polyphonicReading = this.resolvePolyphonicKanji(normalized);
    if (polyphonicReading) return polyphonicReading;

    // 第四层：兜底转换 (Fallback)
    return null;
  }

  private resolveMaintainedFixedReading(text: string): string | null {
    return this.fixedReadingMap.get(text) ?? null;
  }

  private resolveRemoteOverride(text: string, context: ConvertContext, overrides: RemoteOverride[]): string | null {
    const override = overrides.find((item) => {
      if (item.text !== text) return false;
      if (item.prefix && !context.prev.endsWith(item.prefix)) return false;
      if (item.suffix && !context.next.startsWith(item.suffix)) return false;
      return true;
    });

    return override?.reading ?? null;
  }

  private matchRemoteOverrideAt(
    text: string,
    cursor: number,
    context: ConvertContext,
    overrides: RemoteOverride[],
  ): { text: string; reading: string } | null {
    const sortedOverrides = [...overrides].sort((a, b) => b.text.length - a.text.length);

    for (const item of sortedOverrides) {
      if (!text.startsWith(item.text, cursor)) continue;

      const localContext = this.createSegmentContext(text, item.text, cursor, context);
      const reading = this.resolveRemoteOverride(item.text, localContext, overrides);
      if (reading) return { text: item.text, reading };
    }

    return null;
  }

  private matchFixedReadingAt(text: string, cursor: number): { text: string; reading: string } | null {
    for (const key of this.fixedReadingKeys) {
      if (!text.startsWith(key, cursor)) continue;

      const reading = this.fixedReadingMap.get(key);
      if (reading) return { text: key, reading };
    }

    return null;
  }

  private matchNumericCounterAt(text: string, cursor: number): { text: string; reading: string } | null {
    const matched = text.slice(cursor).match(/^(\d+)(歳|才|人|日|時|分|月|年|回|階|本|枚|匹|円)/);
    if (!matched) return null;

    const expression = matched[0];
    const digits = matched[1];
    const suffix = matched[2] as keyof NumericCounterConfig['suffixes'];
    const exactReading = this.numericCounterConfig.exact[expression as keyof NumericCounterConfig['exact']];
    if (exactReading) return { text: expression, reading: exactReading };

    const number = Number.parseInt(digits, 10);
    if (Number.isNaN(number)) return null;

    const reading = this.buildNumericCounterReading(number, suffix);
    return reading ? { text: expression, reading } : null;
  }

  private buildNumericCounterReading(
    number: number,
    suffix: keyof NumericCounterConfig['suffixes'],
  ): string | null {
    const baseReading = this.numberToJapanese(number);
    if (!baseReading) return null;

    switch (suffix) {
      case '歳':
      case '才':
      case '年':
      case '月':
      case '時':
      case '枚':
      case '円':
        return `${baseReading}${this.numericCounterConfig.suffixes[suffix]}`;
      case '人':
        return this.buildPeopleReading(number, baseReading);
      case '分':
        return this.buildFunReading(number, baseReading);
      case '回':
        return this.buildKaiReading(number, baseReading);
      case '階':
        return this.buildFloorReading(number, baseReading);
      case '本':
        return this.buildHonReading(number, baseReading);
      case '匹':
        return this.buildHikiReading(number, baseReading);
      default:
        return null;
    }
  }

  private buildPeopleReading(number: number, baseReading: string): string {
    if (number === 1) return 'ひとり';
    if (number === 2) return 'ふたり';
    if (number === 4) return 'よにん';
    if (number === 7) return 'しちにん';
    return `${baseReading}にん`;
  }

  private buildFunReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || [0, 1, 6, 8].includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}ぷん`;
    }
    if ([3, 4, 9].includes(lastDigit)) {
      return `${baseReading}ぷん`;
    }
    return `${baseReading}ふん`;
  }

  private buildKaiReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || [0, 1, 6, 8].includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}かい`;
    }
    return `${baseReading}かい`;
  }

  private buildFloorReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastDigit === 3) return `${baseReading}がい`;
    if (lastTwoDigits === 0 || [0, 1, 6, 8].includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}かい`;
    }
    return `${baseReading}かい`;
  }

  private buildHonReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || [0, 1, 6, 8].includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}ぽん`;
    }
    if (lastDigit === 3) return `${baseReading}ぼん`;
    return `${baseReading}ほん`;
  }

  private buildHikiReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || [0, 1, 6, 8].includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}ぴき`;
    }
    if (lastDigit === 3) return `${baseReading}びき`;
    return `${baseReading}ひき`;
  }

  private replaceTrailingForSokuon(reading: string): string {
    return reading
      .replace(/じゅう$/, 'じゅっ')
      .replace(/ち$/, 'っ')
      .replace(/く$/, 'っ');
  }

  private numberToJapanese(number: number): string | null {
    if (!Number.isFinite(number) || number < 0) return null;
    if (number === 0) return 'ぜろ';

    const largeUnits = ['', 'まん', 'おく', 'ちょう'];
    const groups: string[] = [];
    let current = number;
    let unitIndex = 0;

    while (current > 0) {
      const group = current % 10000;
      if (group > 0) {
        groups.unshift(`${this.convertUnder10000(group)}${largeUnits[unitIndex]}`);
      }
      current = Math.floor(current / 10000);
      unitIndex += 1;
    }

    return groups.join('');
  }

  private convertUnder10000(number: number): string {
    const thousands = Math.floor(number / 1000);
    const hundreds = Math.floor((number % 1000) / 100);
    const tens = Math.floor((number % 100) / 10);
    const ones = number % 10;

    return [
      this.convertPlace(thousands, 'thousand'),
      this.convertPlace(hundreds, 'hundred'),
      this.convertPlace(tens, 'ten'),
      this.convertPlace(ones, 'one'),
    ].join('');
  }

  private convertPlace(value: number, place: 'thousand' | 'hundred' | 'ten' | 'one'): string {
    if (value === 0) return '';

    if (place === 'one') {
      return ['','いち','に','さん','よん','ご','ろく','なな','はち','きゅう'][value];
    }

    if (place === 'ten') {
      if (value === 1) return 'じゅう';
      return `${['','いち','に','さん','よん','ご','ろく','なな','はち','きゅう'][value]}じゅう`;
    }

    if (place === 'hundred') {
      if (value === 1) return 'ひゃく';
      if (value === 3) return 'さんびゃく';
      if (value === 6) return 'ろっぴゃく';
      if (value === 8) return 'はっぴゃく';
      return `${['','いち','に','さん','よん','ご','ろく','なな','はち','きゅう'][value]}ひゃく`;
    }

    if (value === 1) return 'せん';
    if (value === 3) return 'さんぜん';
    if (value === 8) return 'はっせん';
    return `${['','いち','に','さん','よん','ご','ろく','なな','はち','きゅう'][value]}せん`;
  }

  private resolveOkurigana(text: string): string | null {
    const okuriganaMatch = text.match(OKURIGANA_PATTERN);
    if (!okuriganaMatch) return null;

    const directMatch = this.kunyomiTable[text]?.[0];
    if (directMatch) return directMatch;

    const [, kanjiPart, kanaPart] = okuriganaMatch;
    const baseEntry = this.kunyomiTable[kanjiPart]?.[0];
    if (!baseEntry) return null;
    return `${baseEntry}${kanaPart}`;
  }

  private resolveCompound(text: string): string | null {
    if (!ALL_KANJI_PATTERN.test(text) || text.length < 2) return null;

    let reading = '';
    for (const char of text) {
      const entry = this.dict[char];
      if (!entry) return null;

      const candidate = entry.readings_on?.[0] || entry.readings_kun?.[0];
      if (!candidate) return null;
      reading += candidate.replace(/[.\-!]/g, '');
    }

    return reading || null;
  }

  private resolvePolyphonicKanji(text: string): string | null {
    if (text.length !== 1) return null;
    return this.kunyomiTable[text]?.[0] || null;
  }

  private async getRemoteOverrides(): Promise<RemoteOverride[]> {
    if (this.overridesLoaded) return this.overridesCache;
    if (this.overridesPromise) return this.overridesPromise;

    this.overridesPromise = browser.storage.local.get('remote_overrides')
      .then((data) => {
        this.overridesCache = this.normalizeOverrides(data.remote_overrides);
        this.overridesLoaded = true;
        return this.overridesCache;
      })
      .catch((error) => {
        console.error('读取 remote_overrides 失败:', error);
        this.overridesCache = [];
        this.overridesLoaded = true;
        return this.overridesCache;
      });

    return this.overridesPromise;
  }

  private normalizeOverrides(value: unknown): RemoteOverride[] {
    if (!Array.isArray(value)) return [];

    return value.filter((item): item is RemoteOverride => {
      return Boolean(
        item &&
        typeof item === 'object' &&
        typeof (item as RemoteOverride).text === 'string' &&
        typeof (item as RemoteOverride).reading === 'string',
      );
    });
  }

  private createSegmentContext(
    fullText: string,
    segment: string,
    segmentIndex: number,
    context: ConvertContext,
  ): ConvertContext {
    const safeIndex = Math.max(0, segmentIndex);
    const prev = `${context.prev}${fullText.slice(0, safeIndex)}`;
    const next = `${fullText.slice(safeIndex + segment.length)}${context.next}`;
    return { prev, next };
  }

  private renderRuby(text: string, reading: string): string {
    return `<ruby>${text}<rt>${wanakana.toHiragana(reading.replace(/[.\-!]/g, ''))}</rt></ruby>`;
  }
}

class FuriganaService {
  private dict: KanjiDict = {};
  private cityDict: Record<string, string> = JAPAN_CITY_MAP;
  private familyNames = new Set([
    '田中', '佐藤', '鈴木', '高橋', '渡辺', '伊藤', '山本', '中村', '小林', '加藤',
    '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '清水', '山崎',
  ]);
  private isLoaded = false;
  private initPromise: Promise<void> | null = null;
  private processor: FuriganaProcessor | null = null;

  async init() {
    if (this.isLoaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const response = await fetch(browser.runtime.getURL('/json/kanji-jouyou.json'));
        this.dict = await response.json();
        this.isLoaded = true;
      } catch (err) {
        console.error('加载字典失败:', err);
        this.initPromise = null;
      }
    })();
    return this.initPromise;
  }

  async convert(text: string, context: ConvertContext = DEFAULT_CONTEXT): Promise<string> {
    await this.init();
    this.processor ??= new FuriganaProcessor(
      this.dict,
      this.cityDict,
      KANJI_FIXED_READING_MAP,
      NUMERIC_COUNTER_READING_MAP,
      (segment) => this.baseConvert(segment),
    );
    return this.processor.process(text, context);
  }

  getEntityType(text: string): EntityType {
    const normalized = text.trim();
    if (!normalized) return null;

    const isPlace = Boolean(this.cityDict[normalized]);
    const isPerson = this.familyNames.has(normalized);

    if (isPlace && isPerson) return 'place-or-person';
    if (isPlace) return 'place';
    if (isPerson) return 'person';
    return null;
  }

  isPlaceOrName(text: string): boolean {
    return this.getEntityType(text) !== null;
  }

  baseConvert(segment: string): string {
    const match = segment.match(/^([\u4E00-\u9FFF]+)(.*)$/);
    if (!match) return segment;

    const [, kanjiPart, kanaPart] = match;
    const isCompound = kanjiPart.length > 1 && kanaPart === '';
    let resultHtml = '';

    for (const char of kanjiPart) {
      const entry = this.dict[char];
      if (!entry || typeof entry === 'string') {
        resultHtml += char;
        continue;
      }

      let reading = '';
      if (isCompound) {
        reading = entry.readings_on?.[0] || entry.readings_kun?.[0] || '';
      } else {
        const kunReading = entry.readings_kun?.[0] || '';
        reading = kunReading.includes('.') ? kunReading.split('.')[0] : (kunReading || entry.readings_on?.[0] || '');
      }

      const hiragana = wanakana.toHiragana(reading.replace(/[.\-!]/g, ''));
      resultHtml += `<ruby>${char}<rt>${hiragana}</rt></ruby>`;
    }

    return resultHtml + kanaPart;
  }
}

export const furiganaService = new FuriganaService();
