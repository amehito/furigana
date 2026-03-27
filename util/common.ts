import * as wanakana from 'wanakana';

interface KanjiEntry {
  readings_on: string[];
  readings_kun: string[];
  [key: string]: any;
}


type KanjiDict = Record<string, KanjiEntry>;

class FuriganaService {
  private dict: KanjiDict = {};
  private isLoaded = false;
  private initPromise: Promise<void> | null = null;

  async init() {
    if (this.isLoaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const response = await fetch(chrome.runtime.getURL('json/kanji-jouyou.json'));
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

  private processSegment(segment: string): string {
    // 1. 分离汉字部分和后面的假名部分
    // 例如 "崩し" -> kanjiPart: "崩", kanaPart: "し"
    const match = segment.match(/^([\u4E00-\u9FFF]+)(.*)$/);
    if (!match) return segment;

    const [_, kanjiPart, kanaPart] = match;
    
    // 如果有多个汉字且没有后续假名（如 "学校"），通常是复合词
    const isCompound = kanjiPart.length > 1 && kanaPart === '';
    
    let resultHtml = '';

    // 2. 遍历汉字部分（处理像 "取り消し" 这种多汉字混合词）
    for (let i = 0; i < kanjiPart.length; i++) {
      const char = kanjiPart[i];
      const entry = this.dict[char];
      if (!entry) { resultHtml += char; continue; }

      let reading = '';

      if (isCompound) {
        // 【音读优先】复合词：优先取第一个音读
        reading = entry.readings_on?.[0] || entry.readings_kun?.[0] || '';
      } else {
        // 【训读优先】带假名的动词/形容词 或 单个汉字（如 "水"）
        // 尝试寻找最匹配的训读
        const kunReading = entry.readings_kun?.[0] || '';
        
        if (kunReading.includes('.')) {
          // 处理送假名逻辑：
          // 如果字典是 "くず.す"，提取 "." 之前的 "くず"
          reading = kunReading.split('.')[0];
        } else {
          reading = kunReading || entry.readings_on?.[0] || '';
        }
      }

      // 3. 清理符号并生成 Ruby
      const cleanReading = reading.replace(/[.\-!]/g, '');
      const hiragana = wanakana.toHiragana(cleanReading);
      
      resultHtml += `<ruby>${char}<rt>${hiragana}</rt></ruby>`;
    }

    // 4. 把尾部的假名（如 "し"）拼回去
    return resultHtml + kanaPart;
  }
}

export const furiganaService = new FuriganaService();