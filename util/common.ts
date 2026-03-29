import * as wanakana from 'wanakana';
import { browser } from 'wxt/browser';
import {
  ALL_KANJI_PATTERN,
  COUNTER_PUN_DIGITS,
  COUNTER_SOKUON_DIGITS,
  DEFAULT_CONTEXT,
  DIGIT_READINGS,
  JAPAN_CITY_MAP,
  KANJI_PATTERN,
  LARGE_NUMBER_UNITS,
  NUMERIC_COUNTER_PATTERN,
  NUMERIC_COUNTER_READING_MAP,
  OKURIGANA_PATTERN,
  SPECIAL_HUNDREDS,
  SPECIAL_THOUSANDS,
} from './specials';

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
type FixedReadingMap = Record<string, string>;
type SpecialCasesPayload = {
  version?: string;
  compounds?: Record<string, string[] | string>;
  patch_chars?: Record<string, KanjiEntry>;
};
type PatchVersionPayload = {
  version?: string;
  min_app_version?: string;
  last_updated?: string;
  message?: string;
};

const SPECIAL_CASES_URL = 'https://cdn.jsdelivr.net/gh/amehito/japanese-dict-patch@main/special_cases.json';
const PATCH_VERSION_URL = 'https://cdn.jsdelivr.net/gh/amehito/japanese-dict-patch@main/version.json';
const PATCH_STORAGE_KEY = 'furigana_patch_payload';
const PATCH_VERSION_STORAGE_KEY = 'furigana_patch_version';
const PATCH_CHECKED_AT_STORAGE_KEY = 'furigana_patch_checked_at';
const PATCH_NOTICE_STORAGE_KEY = 'furigana_patch_notice';
const PATCH_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

class FuriganaProcessor {
  private readonly segmenter = new Intl.Segmenter('ja-JP', { granularity: 'word' });
  private readonly entityMap: Map<string, string>;
  private readonly numericCounterConfig: NumericCounterConfig;
  private dict: KanjiDict;
  private fixedReadingMap = new Map<string, string>();
  private fixedReadingKeys: string[] = [];
  private overridesCache: RemoteOverride[] = [];
  private sortedOverridesCache: RemoteOverride[] = [];
  private overridesPromise: Promise<RemoteOverride[]> | null = null;
  private overridesLoaded = false;

  constructor(
    dict: KanjiDict,
    cityDict: Record<string, string>,
    fixedReadings: Record<string, string>,
    numericCounterConfig: NumericCounterConfig,
    private readonly fallbackConvert: (text: string) => string,
  ) {
    this.dict = dict;
    this.setFixedReadings(fixedReadings);
    this.numericCounterConfig = numericCounterConfig;
    this.entityMap = new Map(Object.entries(cityDict));

    browser.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === 'local' && changes.remote_overrides) {
        this.setOverridesCache(changes.remote_overrides.newValue);
        this.overridesLoaded = true;
        this.overridesPromise = Promise.resolve(this.overridesCache);
      }
    });
  }

  updateDict(dict: KanjiDict) {
    this.dict = dict;
  }

  updateFixedReadings(fixedReadings: FixedReadingMap) {
    this.setFixedReadings(fixedReadings);
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

      const nextSegment = this.getNextSegment(text, cursor);
      if (!nextSegment) break;

      const { segment, isWordLike } = nextSegment;
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
    for (const item of this.sortedOverridesCache.length ? this.sortedOverridesCache : overrides) {
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
    const matched = text.slice(cursor).match(NUMERIC_COUNTER_PATTERN);
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

    if (lastTwoDigits === 0 || COUNTER_SOKUON_DIGITS.includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}ぷん`;
    }
    if (COUNTER_PUN_DIGITS.includes(lastDigit)) {
      return `${baseReading}ぷん`;
    }
    return `${baseReading}ふん`;
  }

  private buildKaiReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || COUNTER_SOKUON_DIGITS.includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}かい`;
    }
    return `${baseReading}かい`;
  }

  private buildFloorReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastDigit === 3) return `${baseReading}がい`;
    if (lastTwoDigits === 0 || COUNTER_SOKUON_DIGITS.includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}かい`;
    }
    return `${baseReading}かい`;
  }

  private buildHonReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || COUNTER_SOKUON_DIGITS.includes(lastDigit)) {
      return `${this.replaceTrailingForSokuon(baseReading)}ぽん`;
    }
    if (lastDigit === 3) return `${baseReading}ぼん`;
    return `${baseReading}ほん`;
  }

  private buildHikiReading(number: number, baseReading: string): string {
    const lastTwoDigits = number % 100;
    const lastDigit = number % 10;

    if (lastTwoDigits === 0 || COUNTER_SOKUON_DIGITS.includes(lastDigit)) {
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

    const groups: string[] = [];
    let current = number;
    let unitIndex = 0;

    while (current > 0) {
      const group = current % 10000;
      if (group > 0) {
        groups.unshift(`${this.convertUnder10000(group)}${LARGE_NUMBER_UNITS[unitIndex]}`);
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
      return DIGIT_READINGS[value];
    }

    if (place === 'ten') {
      if (value === 1) return 'じゅう';
      return `${DIGIT_READINGS[value]}じゅう`;
    }

    if (place === 'hundred') {
      if (SPECIAL_HUNDREDS[value]) return SPECIAL_HUNDREDS[value];
      return `${DIGIT_READINGS[value]}ひゃく`;
    }

    if (SPECIAL_THOUSANDS[value]) return SPECIAL_THOUSANDS[value];
    return `${DIGIT_READINGS[value]}せん`;
  }

  private resolveOkurigana(text: string): string | null {
    const okuriganaMatch = text.match(OKURIGANA_PATTERN);
    if (!okuriganaMatch) return null;

    const [, kanjiPart, kanaPart] = okuriganaMatch;
    const dictionaryMatch = this.resolveOkuriganaFromDictionary(kanjiPart, kanaPart);
    if (dictionaryMatch) return dictionaryMatch;
    return null;
  }

  private resolveOkuriganaFromDictionary(kanjiPart: string, kanaPart: string): string | null {
    if (kanjiPart.length !== 1) return null;

    const entry = this.dict[kanjiPart];
    if (!entry) return null;

    return this.resolveOkuriganaFromCandidates(entry.readings_kun, kanaPart);
  }

  private resolveOkuriganaFromCandidates(candidates: string[] | undefined, kanaPart: string): string | null {
    if (!Array.isArray(candidates) || !candidates.length) return null;

    for (const rawCandidate of candidates) {
      const candidate = rawCandidate.replace(/[!\-]/g, '');
      if (!candidate.includes('.')) continue;

      const [stem, ...suffixParts] = candidate.split('.');
      const suffix = suffixParts.join('');
      if (suffix !== kanaPart) continue;

      return `${stem}${suffix}`;
    }

    return null;
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
    return null;
  }

  private async getRemoteOverrides(): Promise<RemoteOverride[]> {
    if (this.overridesLoaded) return this.overridesCache;
    if (this.overridesPromise) return this.overridesPromise;

    this.overridesPromise = browser.storage.local.get('remote_overrides')
      .then((data) => {
        this.setOverridesCache(data.remote_overrides);
        this.overridesLoaded = true;
        return this.overridesCache;
      })
      .catch((error) => {
        console.error('读取 remote_overrides 失败:', error);
        this.setOverridesCache([]);
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

  private setFixedReadings(fixedReadings: FixedReadingMap) {
    this.fixedReadingMap = new Map(Object.entries(fixedReadings));
    this.fixedReadingKeys = Object.keys(fixedReadings).sort((a, b) => b.length - a.length);
  }

  private setOverridesCache(value: unknown) {
    this.overridesCache = this.normalizeOverrides(value);
    this.sortedOverridesCache = [...this.overridesCache].sort((a, b) => b.text.length - a.text.length);
  }

  private getNextSegment(text: string, cursor: number) {
    const iterator = this.segmenter.segment(text.slice(cursor))[Symbol.iterator]();
    const nextSegment = iterator.next();
    return nextSegment.done ? null : nextSegment.value;
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
  private baseDict: KanjiDict = {};
  private dict: KanjiDict = {};
  private cityDict: Record<string, string> = JAPAN_CITY_MAP;
  private familyNameReadings: FixedReadingMap = {};
  private familyNames = new Set<string>();
  private localFixedReadings: FixedReadingMap = {};
  private remotePatchCompounds: FixedReadingMap = {};
  private remotePatchChars: KanjiDict = {};
  private isLoaded = false;
  private initPromise: Promise<void> | null = null;
  private processor: FuriganaProcessor | null = null;
  private patchRefreshPromise: Promise<void> | null = null;

  async init() {
    if (this.isLoaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const [dictResponse, localFixedResponse, familyNamesResponse] = await Promise.all([
          fetch(browser.runtime.getURL('/json/kanji-jouyou.json')),
          fetch(browser.runtime.getURL('/json/fixed-readings.json')),
          fetch(browser.runtime.getURL('/json/family-names.json')),
        ]);

        this.baseDict = await dictResponse.json();
        this.localFixedReadings = await localFixedResponse.json();
        this.familyNameReadings = await familyNamesResponse.json();
        this.familyNames = new Set(Object.keys(this.familyNameReadings));
        this.dict = { ...this.baseDict };
        await this.loadCachedRemotePatch();
        this.ensureProcessor();
        void this.refreshRemotePatchIfNeeded();
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
    this.ensureProcessor();
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

  private ensureProcessor() {
    if (!this.processor) {
      this.processor = new FuriganaProcessor(
        this.dict,
        this.cityDict,
        this.getMergedFixedReadings(),
        NUMERIC_COUNTER_READING_MAP,
        (segment) => this.baseConvert(segment),
      );
      return;
    }

    this.processor.updateDict(this.dict);
    this.processor.updateFixedReadings(this.getMergedFixedReadings());
  }

  private getMergedFixedReadings(): FixedReadingMap {
    return {
      ...this.localFixedReadings,
      ...this.familyNameReadings,
      ...this.remotePatchCompounds,
    };
  }

  private async loadCachedRemotePatch() {
    const data = await browser.storage.local.get([PATCH_STORAGE_KEY, PATCH_NOTICE_STORAGE_KEY]);
    this.applyRemotePatchPayload(data[PATCH_STORAGE_KEY]);
    if (typeof data[PATCH_NOTICE_STORAGE_KEY] === 'string' && data[PATCH_NOTICE_STORAGE_KEY]) {
      console.warn(data[PATCH_NOTICE_STORAGE_KEY]);
    }
  }

  private applyRemotePatchPayload(payload: unknown) {
    const parsed = this.normalizeSpecialCasesPayload(payload);
    this.remotePatchCompounds = parsed.compounds;
    this.remotePatchChars = parsed.patchChars;
    this.dict = {
      ...this.baseDict,
      ...this.remotePatchChars,
    };
    this.ensureProcessor();
  }

  private normalizeSpecialCasesPayload(payload: unknown): { compounds: FixedReadingMap; patchChars: KanjiDict } {
    if (!payload || typeof payload !== 'object') {
      return { compounds: {}, patchChars: {} };
    }

    const raw = payload as SpecialCasesPayload;
    const compounds = Object.fromEntries(
      Object.entries(raw.compounds ?? {}).map(([key, value]) => [
        key,
        Array.isArray(value) ? (value[0] ?? '') : value,
      ]).filter(([, value]) => typeof value === 'string' && value.trim()),
    ) as FixedReadingMap;

    const patchChars = Object.fromEntries(
      Object.entries(raw.patch_chars ?? {}).filter(([, value]) => value && typeof value === 'object'),
    ) as KanjiDict;

    return { compounds, patchChars };
  }

  private async refreshRemotePatchIfNeeded() {
    if (this.patchRefreshPromise) return this.patchRefreshPromise;

    this.patchRefreshPromise = (async () => {
      try {
        const storage = await browser.storage.local.get([
          PATCH_VERSION_STORAGE_KEY,
          PATCH_CHECKED_AT_STORAGE_KEY,
        ]);
        const lastCheckedAt = Number(storage[PATCH_CHECKED_AT_STORAGE_KEY] ?? 0);
        const now = Date.now();
        const shouldForceRefresh = !lastCheckedAt || now - lastCheckedAt >= PATCH_REFRESH_INTERVAL_MS;

        const versionResponse = await fetch(PATCH_VERSION_URL, { cache: 'no-store' });
        
        if (!versionResponse.ok) return;

        const versionPayload = await versionResponse.json() as PatchVersionPayload;
        const currentAppVersion = browser.runtime.getManifest().version || '1.0.0';
        if (versionPayload.min_app_version && compareVersions(currentAppVersion, versionPayload.min_app_version) < 0) {
          const notice = versionPayload.message
            ? `词典补丁需要更新插件版本后才能继续拉取：${versionPayload.message}`
            : `词典补丁需要插件版本 >= ${versionPayload.min_app_version}`;
          await browser.storage.local.set({
            [PATCH_NOTICE_STORAGE_KEY]: notice,
            [PATCH_CHECKED_AT_STORAGE_KEY]: now,
          });
          console.warn(notice);
          return;
        }

        const remoteVersion = versionPayload.version ?? '';
        const localVersion = typeof storage[PATCH_VERSION_STORAGE_KEY] === 'string' ? storage[PATCH_VERSION_STORAGE_KEY] : '';
        if (!shouldForceRefresh && remoteVersion && remoteVersion === localVersion) {
          await browser.storage.local.set({ [PATCH_CHECKED_AT_STORAGE_KEY]: now, [PATCH_NOTICE_STORAGE_KEY]: '' });
          return;
        }

        const specialCasesResponse = await fetch(SPECIAL_CASES_URL, { cache: 'no-store' });
        
        if (!specialCasesResponse.ok) return;

        const specialCasesPayload = await specialCasesResponse.json() as SpecialCasesPayload;
        const specialCasesVersion = specialCasesPayload.version ?? '';

        if (!remoteVersion || !specialCasesVersion || remoteVersion !== specialCasesVersion) {
          console.warn(`远端注音补丁版本不一致，已跳过更新: version.json=${remoteVersion || '∅'}, special_cases.json=${specialCasesVersion || '∅'}`);
          await browser.storage.local.set({
            [PATCH_CHECKED_AT_STORAGE_KEY]: now,
          });
          return;
        }

        this.applyRemotePatchPayload(specialCasesPayload);

        await browser.storage.local.set({
          [PATCH_STORAGE_KEY]: specialCasesPayload,
          [PATCH_VERSION_STORAGE_KEY]: remoteVersion,
          [PATCH_CHECKED_AT_STORAGE_KEY]: now,
          [PATCH_NOTICE_STORAGE_KEY]: '',
        });
      } catch (error) {
        console.error('刷新远端注音补丁失败:', error);
      } finally {
        this.patchRefreshPromise = null;
      }
    })();

    return this.patchRefreshPromise;
  }
}

function compareVersions(left: string, right: string) {
  const leftParts = left.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const maxLength = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

export const furiganaService = new FuriganaService();
