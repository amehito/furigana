import * as wanakana from 'wanakana';
import { browser } from 'wxt/browser';
import cityMap from './city';

interface KanjiEntry {
  readings_on: string[];
  readings_kun: string[];
  [key: string]: any;
}


type KanjiDict = Record<string, KanjiEntry>;
type EntityType = 'place' | 'person' | 'place-or-person' | null;

class FuriganaService {
  private dict: KanjiDict = {};
  private cityDict: Record<string, string> = cityMap;
  private familyNames = new Set([
    '田中', '佐藤', '鈴木', '高橋', '渡辺', '伊藤', '山本', '中村', '小林', '加藤',
    '吉田', '山田', '佐々木', '山口', '松本', '井上', '木村', '林', '清水', '山崎',
  ]);
  private isLoaded = false;
  private initPromise: Promise<void> | null = null;

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

  async convert(text: string): Promise<string> {
    await this.init();

    // @ts-ignore (Intl.Segmenter 在现代 Chrome 中原生支持)
    const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
    const segments = segmenter.segment(text);

    let html = '';
    for (const { segment, isWordLike } of segments) {
      // 如果包含汉字
      if (isWordLike && /[\u4E00-\u9FFF]/.test(segment)) {
        html += this.processSegment(segment);
      } else {
        html += segment;
      }
    }
    return html;
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

  private processSegment(segment: string): string {
    // --- 步骤 0: 全词拦截 (优先处理城市、人名、固定词组) ---
    // 检查字典里是否直接存在这个完整的词（如 "大阪" 或 "田中"）
    const fullEntry = this.cityDict[segment];
    
    if (fullEntry) {
      // 如果命中是你新加的字符串格式（例如 "大阪": "おおさか"）
      if (typeof fullEntry === 'string') {
        const hiragana = wanakana.toHiragana(fullEntry.replace(/[.\-!]/g, ''));
        return `<ruby>${segment}<rt>${hiragana}</rt></ruby>`;
      }
      
      // 如果命中是对象格式但词长 > 1（比如字典里存了词组对象），
      // 也可以在这里直接处理，避免进入循环拆分逻辑。
    }

    // --- 步骤 1: 分离汉字部分和后面的假名部分 ---
    // 例如 "崩し" -> kanjiPart: "崩", kanaPart: "し"
    const match = segment.match(/^([\u4E00-\u9FFF]+)(.*)$/);
    if (!match) return segment;

    const [_, kanjiPart, kanaPart] = match;
    
    // 如果有多个汉字且没有后续假名（如 "学校"），通常是复合词
    const isCompound = kanjiPart.length > 1 && kanaPart === '';
    
    let resultHtml = '';

    // --- 步骤 2: 遍历汉字部分 ---
    for (let i = 0; i < kanjiPart.length; i++) {
      const char = kanjiPart[i];
      const entry = this.dict[char];

      // 兜底：如果单字没查到，或者查到的是全词字符串而非对象，直接原样返回
      if (!entry || typeof entry === 'string') {
        resultHtml += char;
        continue;
      }

      let reading = '';

      if (isCompound) {
        // 【音读优先】复合词：如 "学(がく)校(こう)"
        reading = entry.readings_on?.[0] || entry.readings_kun?.[0] || '';
      } else {
        // 【训读优先】动词/形容词 或 单个汉字：如 "崩(くず)し"
        const kunReading = entry.readings_kun?.[0] || '';
        
        if (kunReading.includes('.')) {
          // 处理送假名逻辑：字典 "くず.す" -> 提取 "くず"
          reading = kunReading.split('.')[0];
        } else {
          reading = kunReading || entry.readings_on?.[0] || '';
        }
      }

      // --- 步骤 3: 清理符号并生成 Ruby ---
      const cleanReading = reading.replace(/[.\-!]/g, '');
      const hiragana = wanakana.toHiragana(cleanReading);
      
      resultHtml += `<ruby>${char}<rt>${hiragana}</rt></ruby>`;
    }

    // --- 步骤 4: 拼接尾部假名 ---
    return resultHtml + kanaPart;
  }
}

export const furiganaService = new FuriganaService();
