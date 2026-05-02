import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  BookOpenText,
  ChevronDown,
  Eraser,
  CheckCircle2,
  ExternalLink,
  ChevronUp,
  FileText,
  GraduationCap,
  Hash,
  Languages,
  PencilLine,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  RefreshCw,
  Trash2,
  Users,
  Volume2,
  X,
} from 'lucide-react';
import { browser } from 'wxt/browser';
import { furiganaService } from '../../util/common';
import { DEFAULT_EXTENSION_SETTINGS, type ExtensionSettings, type SiteAccessMode, type TranslatorEngine } from '../../types/settings';
import basicGrammarN5 from './data/basic-grammar-n5.json';
import basicGrammarN4 from './data/basic-grammar-n4.json';
import basicGrammarN3 from './data/basic-grammar-n3.json';
import {
  EXPORT_DRAFTS_STORAGE_KEY,
  EXPORT_HISTORY_STORAGE_KEY,
  type ExportBlockKind,
  type ExportDraftBlock,
  type ExportHistoryItem,
  type ExportWorkspaceDraft,
  createHistoryItem,
  extractTokensFromRubyHtml,
  isDraftStale,
  tokensToHtml,
} from '../../util/export-workspace';
import {
  FAVORITES_LIMIT,
  FAVORITES_STORAGE_KEY,
  type FavoriteItem,
  normalizeFavoriteItems,
} from '../../util/favorites';

const ICON_PROPS = { size: 24, strokeWidth: 1.75 };
const COMMUNITY_STRATEGY_URL = 'https://cdn.jsdelivr.net/gh/amehito/japanese-dict-patch@main/data/strategy.json';
const SHOW_COMMUNITY_SECTION = true;
const MASTERED_GRAMMAR_STORAGE_KEY = 'grammar_mastered_ids';
const MASTERED_READING_BASICS_STORAGE_KEY = 'reading_basics_mastered_ids';
const MASTERED_MIMETIC_STORAGE_KEY = 'mimetic_mastered_words';
const GRAMMAR_RENDER_BATCH_SIZE = 20;
const READING_BASICS_RENDER_BATCH_SIZE = 20;
const MIMETIC_RENDER_BATCH_SIZE = 20;
type BeginnerMenuKey = 'beginner-kana' | 'beginner-grammar' | 'beginner-reading-basics' | 'beginner-conjugation' | 'beginner-mimetic';
type MenuKey = 'print' | 'favorites' | BeginnerMenuKey | 'site-policies' | 'community';
type GrammarLevelFilter = 'all' | 'N5' | 'N4' | 'N3';
type ReadingBasicsCategory = 'all' | 'number' | 'unit' | 'symbol';
type KanaRowFilter = 'all' | 'あ' | 'か' | 'さ' | 'た' | 'な' | 'は' | 'ま' | 'や' | 'ら' | 'わ' | 'が' | 'ざ' | 'だ' | 'ば' | 'ぱ';
type KanaMode = 'hiragana' | 'katakana' | 'dakuten';
type MimeticWordEntry = {
  reading?: string;
  meaning: string;
  tags?: string[];
  example?: string;
};
type MimeticWordItem = MimeticWordEntry & {
  word: string;
  row: KanaRowFilter;
};
type GrammarExample = {
  sentence: string;
  translation: string;
  note?: string;
};
type GrammarItem = {
  id: string;
  level: 'N5' | 'N4' | 'N3';
  kanaIndex: string;
  title: string;
  patterns: string[];
  translation: string;
  explanation: string;
  formation: string;
  examples: GrammarExample[];
  tags: string[];
};
type ReadingBasicsItem = {
  id: string;
  category: Exclude<ReadingBasicsCategory, 'all'>;
  title: string;
  reading: string;
  meaning: string;
  rule: string;
  examples: Array<{
    text: string;
    reading: string;
    note?: string;
  }>;
  tags: string[];
};
const GRAMMAR_LEVEL_FILTERS: Array<{ key: GrammarLevelFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'N5', label: 'N5' },
  { key: 'N4', label: 'N4' },
  { key: 'N3', label: 'N3' },
];
const READING_BASICS_CATEGORY_FILTERS: Array<{ key: ReadingBasicsCategory; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'number', label: '数字' },
  { key: 'unit', label: '单位' },
  { key: 'symbol', label: '符号' },
];
const KANA_ROW_FILTERS: Array<{ key: KanaRowFilter; label: string; kana: string }> = [
  { key: 'all', label: '全部', kana: 'すべて' },
  { key: 'あ', label: 'あ行', kana: 'あいうえお' },
  { key: 'か', label: 'か行', kana: 'かきくけこ' },
  { key: 'さ', label: 'さ行', kana: 'さしすせそ' },
  { key: 'た', label: 'た行', kana: 'たちつてと' },
  { key: 'な', label: 'な行', kana: 'なにぬねの' },
  { key: 'は', label: 'は行', kana: 'はひふへほ' },
  { key: 'ま', label: 'ま行', kana: 'まみむめも' },
  { key: 'や', label: 'や行', kana: 'やゆよ' },
  { key: 'ら', label: 'ら行', kana: 'らりるれろ' },
  { key: 'わ', label: 'わ行', kana: 'わをん' },
  { key: 'が', label: 'が行', kana: 'がぎぐげご' },
  { key: 'ざ', label: 'ざ行', kana: 'ざじずぜぞ' },
  { key: 'だ', label: 'だ行', kana: 'だぢづでど' },
  { key: 'ば', label: 'ば行', kana: 'ばびぶべぼ' },
  { key: 'ぱ', label: 'ぱ行', kana: 'ぱぴぷぺぽ' },
];
const FULL_LOAD_MESSAGE = '警告：认知负荷已达上限！不消灭这些“死角”，新知识将无法进入。';

const TRANSLATOR_URL_BUILDERS: Record<TranslatorEngine, (text: string) => string> = {
  google: (text) => `https://translate.google.com/?sl=ja&tl=zh-CN&text=${encodeURIComponent(text)}&op=translate`,
  deepl: (text) => `https://www.deepl.com/translator#ja/zh-hans/${encodeURIComponent(text)}`,
  bing: (text) => `https://www.bing.com/translator?from=ja&to=zh-Hans&text=${encodeURIComponent(text)}`,
  papago: (text) => `https://papago.naver.com/?sk=ja&tk=zh-CN&st=${encodeURIComponent(text)}`,
};
const KANA_DISTRACTOR_POOL = ['あ', 'い', 'う', 'え', 'お', 'か', 'き', 'く', 'け', 'こ', 'さ', 'し', 'す', 'せ', 'そ', 'た', 'ち', 'つ', 'て', 'と', 'な', 'に', 'ぬ', 'ね', 'の', 'は', 'ひ', 'ふ', 'へ', 'ほ', 'ま', 'み', 'む', 'め', 'も', 'や', 'ゆ', 'よ', 'ら', 'り', 'る', 'れ', 'ろ', 'わ', 'ん', 'きゃ', 'きゅ', 'きょ', 'しゃ', 'しゅ', 'しょ', 'ちゃ', 'ちゅ', 'ちょ', 'にゃ', 'にゅ', 'にょ', 'ひゃ', 'ひゅ', 'ひょ', 'みゃ', 'みゅ', 'みょ', 'りゃ', 'りゅ', 'りょ', 'っ', 'ー'];
const KANA_COLUMN_LABELS = ['あ段', 'い段', 'う段', 'え段', 'お段'];
const KANA_MODE_LABELS: Record<KanaMode, string> = {
  hiragana: '平假名',
  katakana: '片假名',
  dakuten: '混浊音',
};
const KANA_TABLES: Record<KanaMode, Array<{ label: string; kana: Array<string | null>; romaji: Array<string | null> }>> = {
  hiragana: [
    { label: 'あ行', kana: ['あ', 'い', 'う', 'え', 'お'], romaji: ['a', 'i', 'u', 'e', 'o'] },
    { label: 'か行', kana: ['か', 'き', 'く', 'け', 'こ'], romaji: ['ka', 'ki', 'ku', 'ke', 'ko'] },
    { label: 'さ行', kana: ['さ', 'し', 'す', 'せ', 'そ'], romaji: ['sa', 'shi', 'su', 'se', 'so'] },
    { label: 'た行', kana: ['た', 'ち', 'つ', 'て', 'と'], romaji: ['ta', 'chi', 'tsu', 'te', 'to'] },
    { label: 'な行', kana: ['な', 'に', 'ぬ', 'ね', 'の'], romaji: ['na', 'ni', 'nu', 'ne', 'no'] },
    { label: 'は行', kana: ['は', 'ひ', 'ふ', 'へ', 'ほ'], romaji: ['ha', 'hi', 'fu', 'he', 'ho'] },
    { label: 'ま行', kana: ['ま', 'み', 'む', 'め', 'も'], romaji: ['ma', 'mi', 'mu', 'me', 'mo'] },
    { label: 'や行', kana: ['や', null, 'ゆ', null, 'よ'], romaji: ['ya', null, 'yu', null, 'yo'] },
    { label: 'ら行', kana: ['ら', 'り', 'る', 'れ', 'ろ'], romaji: ['ra', 'ri', 'ru', 're', 'ro'] },
    { label: 'わ行', kana: ['わ', null, null, null, 'を'], romaji: ['wa', null, null, null, 'wo'] },
    { label: 'ん', kana: ['ん', null, null, null, null], romaji: ['n', null, null, null, null] },
  ],
  katakana: [
    { label: 'ア行', kana: ['ア', 'イ', 'ウ', 'エ', 'オ'], romaji: ['a', 'i', 'u', 'e', 'o'] },
    { label: 'カ行', kana: ['カ', 'キ', 'ク', 'ケ', 'コ'], romaji: ['ka', 'ki', 'ku', 'ke', 'ko'] },
    { label: 'サ行', kana: ['サ', 'シ', 'ス', 'セ', 'ソ'], romaji: ['sa', 'shi', 'su', 'se', 'so'] },
    { label: 'タ行', kana: ['タ', 'チ', 'ツ', 'テ', 'ト'], romaji: ['ta', 'chi', 'tsu', 'te', 'to'] },
    { label: 'ナ行', kana: ['ナ', 'ニ', 'ヌ', 'ネ', 'ノ'], romaji: ['na', 'ni', 'nu', 'ne', 'no'] },
    { label: 'ハ行', kana: ['ハ', 'ヒ', 'フ', 'ヘ', 'ホ'], romaji: ['ha', 'hi', 'fu', 'he', 'ho'] },
    { label: 'マ行', kana: ['マ', 'ミ', 'ム', 'メ', 'モ'], romaji: ['ma', 'mi', 'mu', 'me', 'mo'] },
    { label: 'ヤ行', kana: ['ヤ', null, 'ユ', null, 'ヨ'], romaji: ['ya', null, 'yu', null, 'yo'] },
    { label: 'ラ行', kana: ['ラ', 'リ', 'ル', 'レ', 'ロ'], romaji: ['ra', 'ri', 'ru', 're', 'ro'] },
    { label: 'ワ行', kana: ['ワ', null, null, null, 'ヲ'], romaji: ['wa', null, null, null, 'wo'] },
    { label: 'ン', kana: ['ン', null, null, null, null], romaji: ['n', null, null, null, null] },
  ],
  dakuten: [
    { label: 'が行', kana: ['が', 'ぎ', 'ぐ', 'げ', 'ご'], romaji: ['ga', 'gi', 'gu', 'ge', 'go'] },
    { label: 'ざ行', kana: ['ざ', 'じ', 'ず', 'ぜ', 'ぞ'], romaji: ['za', 'ji', 'zu', 'ze', 'zo'] },
    { label: 'だ行', kana: ['だ', 'ぢ', 'づ', 'で', 'ど'], romaji: ['da', 'ji', 'zu', 'de', 'do'] },
    { label: 'ば行', kana: ['ば', 'び', 'ぶ', 'べ', 'ぼ'], romaji: ['ba', 'bi', 'bu', 'be', 'bo'] },
    { label: 'ぱ行', kana: ['ぱ', 'ぴ', 'ぷ', 'ぺ', 'ぽ'], romaji: ['pa', 'pi', 'pu', 'pe', 'po'] },
  ],
};
const BASIC_GRAMMAR_SECTIONS = [
  ...basicGrammarN5.items,
  ...basicGrammarN4.items,
  ...basicGrammarN3.items,
] as GrammarItem[];
const grammarExampleRubyCache = new Map<string, string>();

const BEGINNER_MENU_ITEMS: Array<{
  key: BeginnerMenuKey;
  label: string;
  icon: typeof BookOpenText;
}> = [
  { key: 'beginner-kana', label: '五十音图', icon: BookOpenText },
  { key: 'beginner-grammar', label: '基础语法', icon: PencilLine },
  { key: 'beginner-reading-basics', label: '数字单位符号', icon: Hash },
  { key: 'beginner-conjugation', label: '日语变形', icon: RefreshCw },
  { key: 'beginner-mimetic', label: '擬態語', icon: Languages },
];

const READING_BASICS_ITEMS: ReadingBasicsItem[] = [
  {
    id: 'number-0',
    category: 'number',
    title: '0 / 零',
    reading: 'ゼロ / れい',
    meaning: '数字 0',
    rule: '日常读ゼロ很常见；电话号码、编号里也常用れい。',
    examples: [
      { text: '0点', reading: 'れい てん', note: '分数、比分、温度可用れい' },
      { text: 'ゼロから始める', reading: 'ゼロから はじめる' },
    ],
    tags: ['基数', '编号'],
  },
  {
    id: 'number-1',
    category: 'number',
    title: '1 / 一',
    reading: 'いち / ひと',
    meaning: '数字 1',
    rule: '单独数数多读いち；和日语固有量词搭配时常变成ひと。',
    examples: [
      { text: '一つ', reading: 'ひとつ' },
      { text: '一人', reading: 'ひとり' },
    ],
    tags: ['基数', '固有读法'],
  },
  {
    id: 'number-2',
    category: 'number',
    title: '2 / 二',
    reading: 'に / ふた',
    meaning: '数字 2',
    rule: '普通数字读に；二つ、二人等固定表达用ふた系读法。',
    examples: [
      { text: '二つ', reading: 'ふたつ' },
      { text: '二人', reading: 'ふたり' },
    ],
    tags: ['基数', '固有读法'],
  },
  {
    id: 'number-3',
    category: 'number',
    title: '3 / 三',
    reading: 'さん / みっ',
    meaning: '数字 3',
    rule: '三通常读さん；三つ、三日等词里会出现みっ/みっか。',
    examples: [
      { text: '三つ', reading: 'みっつ' },
      { text: '三日', reading: 'みっか' },
    ],
    tags: ['基数', '日期'],
  },
  {
    id: 'number-4',
    category: 'number',
    title: '4 / 四',
    reading: 'よん / し / よ',
    meaning: '数字 4',
    rule: '计数常用よん；月份读しがつ；四つ、四日用よ系。',
    examples: [
      { text: '四月', reading: 'しがつ' },
      { text: '四つ', reading: 'よっつ' },
    ],
    tags: ['多读音', '日期'],
  },
  {
    id: 'number-5',
    category: 'number',
    title: '5 / 五',
    reading: 'ご / いつ',
    meaning: '数字 5',
    rule: '普通数字读ご；五つ、五日等固定表达用いつ。',
    examples: [
      { text: '五つ', reading: 'いつつ' },
      { text: '五日', reading: 'いつか' },
    ],
    tags: ['基数', '日期'],
  },
  {
    id: 'number-6',
    category: 'number',
    title: '6 / 六',
    reading: 'ろく / むっ',
    meaning: '数字 6',
    rule: '后接か、さ、た、は行量词时常促音化成ろっ。',
    examples: [
      { text: '六回', reading: 'ろっかい' },
      { text: '六本', reading: 'ろっぽん' },
    ],
    tags: ['促音', '数字变音'],
  },
  {
    id: 'number-7',
    category: 'number',
    title: '7 / 七',
    reading: 'なな / しち',
    meaning: '数字 7',
    rule: '单独计数多用なな；七月、七時常读しち。',
    examples: [
      { text: '七月', reading: 'しちがつ' },
      { text: '七つ', reading: 'ななつ' },
    ],
    tags: ['多读音', '时间'],
  },
  {
    id: 'number-8',
    category: 'number',
    title: '8 / 八',
    reading: 'はち / やっ',
    meaning: '数字 8',
    rule: '接か、さ、た、は行量词时常促音化成はっ；固有读法常见やっ。',
    examples: [
      { text: '八回', reading: 'はっかい' },
      { text: '八つ', reading: 'やっつ' },
    ],
    tags: ['促音', '固有读法'],
  },
  {
    id: 'number-9',
    category: 'number',
    title: '9 / 九',
    reading: 'きゅう / く',
    meaning: '数字 9',
    rule: '普通计数多用きゅう；九月、九時常读く。',
    examples: [
      { text: '九月', reading: 'くがつ' },
      { text: '九つ', reading: 'ここのつ' },
    ],
    tags: ['多读音', '时间'],
  },
  {
    id: 'number-10',
    category: 'number',
    title: '10 / 十',
    reading: 'じゅう / とお',
    meaning: '数字 10',
    rule: '接か、さ、た、は行量词时常变成じゅっ；十日读とおか。',
    examples: [
      { text: '十回', reading: 'じゅっかい' },
      { text: '十日', reading: 'とおか' },
    ],
    tags: ['促音', '日期'],
  },
  {
    id: 'number-large',
    category: 'number',
    title: '100〜10000',
    reading: 'ひゃく・せん・まん',
    meaning: '百、千、万的常用读法',
    rule: '百位里300、600、800会变音；千位里3000、8000要特别记；10000读いちまん。',
    examples: [
      { text: '100', reading: 'ひゃく' },
      { text: '200', reading: 'にひゃく' },
      { text: '三百', reading: 'さんびゃく' },
      { text: '400', reading: 'よんひゃく' },
      { text: '500', reading: 'ごひゃく' },
      { text: '600', reading: 'ろっぴゃく' },
      { text: '700', reading: 'ななひゃく' },
      { text: '800', reading: 'はっぴゃく' },
      { text: '900', reading: 'きゅうひゃく' },
      { text: '1000', reading: 'せん' },
      { text: '3000', reading: 'さんぜん' },
      { text: '八千', reading: 'はっせん' },
      { text: '10000', reading: 'いちまん' },
    ],
    tags: ['大数字', '浊音'],
  },
  {
    id: 'number-decimal',
    category: 'number',
    title: '小数・百分比',
    reading: 'てん / パーセント',
    meaning: '小数点和百分比',
    rule: '小数点读てん；百分号读パーセント，数字逐位或按数值读。',
    examples: [
      { text: '3.5', reading: 'さん てん ご' },
      { text: '20%', reading: 'にじゅっ パーセント' },
    ],
    tags: ['小数', '百分比'],
  },
  {
    id: 'unit-ko',
    category: 'unit',
    title: '個 / 个',
    reading: 'こ',
    meaning: '通用小物件单位',
    rule: '1、6、8、10 后面常促音化：いっこ、ろっこ、はっこ、じゅっこ。',
    examples: [
      { text: '一個', reading: 'いっこ' },
      { text: '三個', reading: 'さんこ' },
    ],
    tags: ['量词', '促音'],
  },
  {
    id: 'unit-hon',
    category: 'unit',
    title: '本',
    reading: 'ほん / ぼん / ぽん',
    meaning: '细长物、线路、电影等',
    rule: '1、6、8、10 多读ぽん；3读ぼん；其他多读ほん。',
    examples: [
      { text: '一本', reading: 'いっぽん' },
      { text: '三本', reading: 'さんぼん' },
    ],
    tags: ['量词', 'は行变音'],
  },
  {
    id: 'unit-hiki',
    category: 'unit',
    title: '匹',
    reading: 'ひき / びき / ぴき',
    meaning: '小动物单位',
    rule: '1、6、8、10 多读ぴき；3读びき；其他多读ひき。',
    examples: [
      { text: '一匹', reading: 'いっぴき' },
      { text: '三匹', reading: 'さんびき' },
    ],
    tags: ['量词', 'は行变音'],
  },
  {
    id: 'unit-fun',
    category: 'unit',
    title: '分',
    reading: 'ふん / ぷん',
    meaning: '分钟',
    rule: '1、3、4、6、8、10 分常读ぷん，其他多读ふん。',
    examples: [
      { text: '一分', reading: 'いっぷん' },
      { text: '五分', reading: 'ごふん' },
    ],
    tags: ['时间', 'は行变音'],
  },
  {
    id: 'unit-kai-count',
    category: 'unit',
    title: '回',
    reading: 'かい',
    meaning: '次数',
    rule: '前面是促音数字时读起来变成いっかい、ろっかい、はっかい、じゅっかい。',
    examples: [
      { text: '一回', reading: 'いっかい' },
      { text: '三回', reading: 'さんかい' },
    ],
    tags: ['次数', '促音'],
  },
  {
    id: 'unit-kai-floor',
    category: 'unit',
    title: '階',
    reading: 'かい / がい',
    meaning: '楼层',
    rule: '三階读さんがい是常见例外；一階、六階、八階等有促音。',
    examples: [
      { text: '一階', reading: 'いっかい' },
      { text: '三階', reading: 'さんがい' },
    ],
    tags: ['楼层', '例外'],
  },
  {
    id: 'unit-nin',
    category: 'unit',
    title: '人',
    reading: 'にん / り',
    meaning: '人数',
    rule: '一人、二人是特殊读法；三人以后通常数字 + にん。',
    examples: [
      { text: '一人', reading: 'ひとり' },
      { text: '四人', reading: 'よにん' },
    ],
    tags: ['人数', '特殊读法'],
  },
  {
    id: 'unit-mai',
    category: 'unit',
    title: '枚',
    reading: 'まい',
    meaning: '薄片、纸张、票据',
    rule: '读音相对稳定，数字直接接まい。',
    examples: [
      { text: '一枚', reading: 'いちまい' },
      { text: '何枚', reading: 'なんまい' },
    ],
    tags: ['量词', '稳定读法'],
  },
  {
    id: 'unit-satsu',
    category: 'unit',
    title: '冊',
    reading: 'さつ',
    meaning: '书本单位',
    rule: '1、8、10 常促音化；三冊不浊化，读さんさつ。',
    examples: [
      { text: '一冊', reading: 'いっさつ' },
      { text: '八冊', reading: 'はっさつ' },
    ],
    tags: ['书本', '促音'],
  },
  {
    id: 'unit-dai',
    category: 'unit',
    title: '台',
    reading: 'だい',
    meaning: '机器、车辆单位',
    rule: '读音稳定，数字直接接だい。',
    examples: [
      { text: '二台', reading: 'にだい' },
      { text: '何台', reading: 'なんだい' },
    ],
    tags: ['机器', '车辆'],
  },
  {
    id: 'unit-en',
    category: 'unit',
    title: '円',
    reading: 'えん',
    meaning: '日元',
    rule: '金额里的四常读よん，七常读なな，避免听混。',
    examples: [
      { text: '四百円', reading: 'よんひゃくえん' },
      { text: '七千円', reading: 'ななせんえん' },
    ],
    tags: ['金额', '数字选择'],
  },
  {
    id: 'unit-date',
    category: 'unit',
    title: '日付 1〜10日',
    reading: 'にち / か',
    meaning: '1号到10号的日期读法',
    rule: '日期读法和普通数字差别很大，1号到10号建议整组记。',
    examples: [
      { text: '1日', reading: 'ついたち' },
      { text: '2日', reading: 'ふつか' },
      { text: '3日', reading: 'みっか' },
      { text: '4日', reading: 'よっか' },
      { text: '5日', reading: 'いつか' },
      { text: '6日', reading: 'むいか' },
      { text: '7日', reading: 'なのか' },
      { text: '8日', reading: 'ようか' },
      { text: '9日', reading: 'ここのか' },
      { text: '10日', reading: 'とおか' },
    ],
    tags: ['日期', '特殊读法'],
  },
  {
    id: 'unit-date-11-20',
    category: 'unit',
    title: '日付 11〜20日',
    reading: 'にち / か',
    meaning: '11号到20号的日期读法',
    rule: '11日以后多为数字 + にち，但14日、20日仍是特殊读法。',
    examples: [
      { text: '11日', reading: 'じゅういちにち' },
      { text: '12日', reading: 'じゅうににち' },
      { text: '13日', reading: 'じゅうさんにち' },
      { text: '14日', reading: 'じゅうよっか' },
      { text: '15日', reading: 'じゅうごにち' },
      { text: '16日', reading: 'じゅうろくにち' },
      { text: '17日', reading: 'じゅうしちにち' },
      { text: '18日', reading: 'じゅうはちにち' },
      { text: '19日', reading: 'じゅうくにち' },
      { text: '20日', reading: 'はつか' },
    ],
    tags: ['日期', '特殊读法'],
  },
  {
    id: 'unit-date-21-31',
    category: 'unit',
    title: '日付 21〜31日',
    reading: 'にち / か',
    meaning: '21号到31号的日期读法',
    rule: '21日以后基本读数字 + にち；24日读にじゅうよっか，31日读さんじゅういちにち。',
    examples: [
      { text: '21日', reading: 'にじゅういちにち' },
      { text: '22日', reading: 'にじゅうににち' },
      { text: '23日', reading: 'にじゅうさんにち' },
      { text: '24日', reading: 'にじゅうよっか' },
      { text: '25日', reading: 'にじゅうごにち' },
      { text: '26日', reading: 'にじゅうろくにち' },
      { text: '27日', reading: 'にじゅうしちにち' },
      { text: '28日', reading: 'にじゅうはちにち' },
      { text: '29日', reading: 'にじゅうくにち' },
      { text: '30日', reading: 'さんじゅうにち' },
      { text: '31日', reading: 'さんじゅういちにち' },
    ],
    tags: ['日期', '31号'],
  },
  {
    id: 'unit-months',
    category: 'unit',
    title: '月 1〜12月',
    reading: 'がつ',
    meaning: '12个月份',
    rule: '月份基本是数字 + がつ；4月、7月、9月分别读しがつ、しちがつ、くがつ。',
    examples: [
      { text: '1月', reading: 'いちがつ' },
      { text: '2月', reading: 'にがつ' },
      { text: '3月', reading: 'さんがつ' },
      { text: '4月', reading: 'しがつ' },
      { text: '5月', reading: 'ごがつ' },
      { text: '6月', reading: 'ろくがつ' },
      { text: '7月', reading: 'しちがつ' },
      { text: '8月', reading: 'はちがつ' },
      { text: '9月', reading: 'くがつ' },
      { text: '10月', reading: 'じゅうがつ' },
      { text: '11月', reading: 'じゅういちがつ' },
      { text: '12月', reading: 'じゅうにがつ' },
    ],
    tags: ['月份', '时间'],
  },
  {
    id: 'unit-sai',
    category: 'unit',
    title: '歳 / 才',
    reading: 'さい',
    meaning: '年龄',
    rule: '1、8、10、20岁有特殊或促音读法；20歳常读はたち。',
    examples: [
      { text: '一歳', reading: 'いっさい' },
      { text: '二十歳', reading: 'はたち' },
    ],
    tags: ['年龄', '促音'],
  },
  {
    id: 'unit-ji',
    category: 'unit',
    title: '時',
    reading: 'じ',
    meaning: '几点钟',
    rule: '4点读よじ，7点读しちじ，9点读くじ。',
    examples: [
      { text: '四時', reading: 'よじ' },
      { text: '九時', reading: 'くじ' },
    ],
    tags: ['时间', '特殊读法'],
  },
  {
    id: 'unit-jikan',
    category: 'unit',
    title: '時間',
    reading: 'じかん',
    meaning: '小时、时长',
    rule: '表示持续时间时用じかん；4小时常读よじかん。',
    examples: [
      { text: '一時間', reading: 'いちじかん' },
      { text: '四時間', reading: 'よじかん' },
    ],
    tags: ['时间', '时长'],
  },
  {
    id: 'unit-nen',
    category: 'unit',
    title: '年',
    reading: 'ねん',
    meaning: '年份、年数',
    rule: '年份多读数字 + ねん；4年读よねん，7年读ななねん较常见。',
    examples: [
      { text: '一年', reading: 'いちねん' },
      { text: '四年', reading: 'よねん' },
    ],
    tags: ['年份', '时间'],
  },
  {
    id: 'unit-hai',
    category: 'unit',
    title: '杯',
    reading: 'はい / ばい / ぱい',
    meaning: '杯、碗、容器份数',
    rule: '1、6、8、10多读ぱい；3读ばい；其他多读はい。',
    examples: [
      { text: '一杯', reading: 'いっぱい' },
      { text: '三杯', reading: 'さんばい' },
    ],
    tags: ['量词', 'は行变音'],
  },
  {
    id: 'unit-chaku',
    category: 'unit',
    title: '着',
    reading: 'ちゃく',
    meaning: '衣服套数',
    rule: '1、8、10常促音化：いっちゃく、はっちゃく、じゅっちゃく。',
    examples: [
      { text: '一着', reading: 'いっちゃく' },
      { text: '三着', reading: 'さんちゃく' },
    ],
    tags: ['衣服', '促音'],
  },
  {
    id: 'unit-soku',
    category: 'unit',
    title: '足',
    reading: 'そく / ぞく',
    meaning: '鞋、袜子的双数',
    rule: '1、8、10常促音化；3足常读さんぞく。',
    examples: [
      { text: '一足', reading: 'いっそく' },
      { text: '三足', reading: 'さんぞく' },
    ],
    tags: ['鞋袜', '浊音'],
  },
  {
    id: 'unit-ken',
    category: 'unit',
    title: '件',
    reading: 'けん',
    meaning: '事情、案件、邮件条数',
    rule: '读音较稳定，数字直接接けん。',
    examples: [
      { text: '一件', reading: 'いっけん' },
      { text: '三件', reading: 'さんけん' },
    ],
    tags: ['事项', '促音'],
  },
  {
    id: 'unit-ban',
    category: 'unit',
    title: '番',
    reading: 'ばん',
    meaning: '顺序、号码',
    rule: '常用于第几号、第几位、几号窗口，读音稳定。',
    examples: [
      { text: '一番', reading: 'いちばん' },
      { text: '三番', reading: 'さんばん' },
    ],
    tags: ['顺序', '号码'],
  },
  {
    id: 'unit-tsu',
    category: 'unit',
    title: 'つ',
    reading: 'ひとつ・ふたつ',
    meaning: '日语固有数法的通用量词',
    rule: '1到10多用固有读法，适合数抽象事物和不确定的小物件。',
    examples: [
      { text: '一つ', reading: 'ひとつ' },
      { text: '九つ', reading: 'ここのつ' },
    ],
    tags: ['量词', '固有读法'],
  },
  {
    id: 'unit-tou',
    category: 'unit',
    title: '頭',
    reading: 'とう',
    meaning: '大型动物单位',
    rule: '读音较稳定，常用于牛、马、象等大型动物。',
    examples: [
      { text: '一頭', reading: 'いっとう' },
      { text: '三頭', reading: 'さんとう' },
    ],
    tags: ['动物', '促音'],
  },
  {
    id: 'unit-wa',
    category: 'unit',
    title: '羽',
    reading: 'わ / ば / ぱ',
    meaning: '鸟、兔子的单位',
    rule: '1羽可读いちわ或いっぱ；3羽常读さんば，读法会随习惯变化。',
    examples: [
      { text: '一羽', reading: 'いちわ / いっぱ' },
      { text: '三羽', reading: 'さんば' },
    ],
    tags: ['动物', 'は行变音'],
  },
  {
    id: 'unit-sara',
    category: 'unit',
    title: '皿',
    reading: 'さら',
    meaning: '盘装料理',
    rule: '读音稳定，用来数一盘一盘的菜。',
    examples: [
      { text: '一皿', reading: 'ひとさら' },
      { text: '二皿', reading: 'ふたさら' },
    ],
    tags: ['料理', '量词'],
  },
  {
    id: 'unit-mei',
    category: 'unit',
    title: '名',
    reading: 'めい',
    meaning: '礼貌的人数单位',
    rule: '比人更正式，餐厅预约、接待场景常用。',
    examples: [
      { text: '一名', reading: 'いちめい' },
      { text: '三名様', reading: 'さんめいさま' },
    ],
    tags: ['人数', '礼貌'],
  },
  {
    id: 'symbol-comma',
    category: 'symbol',
    title: '、',
    reading: '読点（とうてん）',
    meaning: '日文逗号',
    rule: '朗读时通常只是短暂停顿；说符号名称时读とうてん。',
    examples: [
      { text: '朝、学校へ行く。', reading: 'あさ、がっこうへ いく' },
      { text: '読点', reading: 'とうてん' },
    ],
    tags: ['标点', '停顿'],
  },
  {
    id: 'symbol-period',
    category: 'symbol',
    title: '。',
    reading: '句点（くてん）',
    meaning: '日文句号',
    rule: '句末停顿；说符号名称时读くてん。',
    examples: [
      { text: '終わりました。', reading: 'おわりました' },
      { text: '句点', reading: 'くてん' },
    ],
    tags: ['标点', '句末'],
  },
  {
    id: 'symbol-question',
    category: 'symbol',
    title: '？ / ?',
    reading: '疑問符（ぎもんふ）',
    meaning: '问号',
    rule: '日语正式书写常用か表达疑问；聊天和标题中常见问号。',
    examples: [
      { text: '本当ですか？', reading: 'ほんとうですか' },
      { text: '疑問符', reading: 'ぎもんふ' },
    ],
    tags: ['标点', '疑问'],
  },
  {
    id: 'symbol-exclamation',
    category: 'symbol',
    title: '！ / !',
    reading: '感嘆符（かんたんふ）',
    meaning: '感叹号',
    rule: '用于强调情绪；符号名称读かんたんふ，也常说びっくりマーク。',
    examples: [
      { text: 'すごい！', reading: 'すごい' },
      { text: 'びっくりマーク', reading: 'びっくりマーク' },
    ],
    tags: ['标点', '强调'],
  },
  {
    id: 'symbol-dot',
    category: 'symbol',
    title: '・',
    reading: '中黒（なかぐろ）',
    meaning: '中点',
    rule: '常用于外来语并列、姓名分隔；朗读正文时多按词组自然停顿。',
    examples: [
      { text: 'コーヒー・紅茶', reading: 'コーヒー、こうちゃ' },
      { text: '中黒', reading: 'なかぐろ' },
    ],
    tags: ['标点', '外来语'],
  },
  {
    id: 'symbol-long-vowel',
    category: 'symbol',
    title: 'ー',
    reading: '長音符（ちょうおんぷ）',
    meaning: '长音符',
    rule: '片假名里表示前一个音拉长，不单独读成一个音。',
    examples: [
      { text: 'コーヒー', reading: 'コーヒー' },
      { text: 'メール', reading: 'メール' },
    ],
    tags: ['假名', '长音'],
  },
  {
    id: 'symbol-quote',
    category: 'symbol',
    title: '「 」',
    reading: '鉤括弧（かぎかっこ）',
    meaning: '日文引号',
    rule: '用于引用或强调；朗读时通常不读符号名称。',
    examples: [
      { text: '「はい」と答える', reading: 'はい と こたえる' },
      { text: '鉤括弧', reading: 'かぎかっこ' },
    ],
    tags: ['标点', '引用'],
  },
  {
    id: 'symbol-parentheses',
    category: 'symbol',
    title: '（ ）',
    reading: '丸括弧（まるかっこ）',
    meaning: '圆括号',
    rule: '补充说明用；需要读出符号时说まるかっこ。',
    examples: [
      { text: '東京（日本）', reading: 'とうきょう、にほん' },
      { text: '丸括弧', reading: 'まるかっこ' },
    ],
    tags: ['标点', '补充'],
  },
  {
    id: 'symbol-slash',
    category: 'symbol',
    title: '／ /',
    reading: 'スラッシュ',
    meaning: '斜线',
    rule: '网址、日期、选项分隔中常见，通常读スラッシュ。',
    examples: [
      { text: '5/2', reading: 'ご スラッシュ に' },
      { text: 'A/B', reading: 'エー スラッシュ ビー' },
    ],
    tags: ['符号', '分隔'],
  },
  {
    id: 'symbol-colon',
    category: 'symbol',
    title: '： / :',
    reading: 'コロン',
    meaning: '冒号',
    rule: '时间、说明、比例里常见；时间表达也可直接读数字和分。',
    examples: [
      { text: '10:30', reading: 'じゅうじ さんじゅっぷん' },
      { text: 'コロン', reading: 'コロン' },
    ],
    tags: ['符号', '时间'],
  },
];

const CONJUGATION_RULES = [
  {
    title: '先判断词类',
    description: '动词分为五段动词、一段动词、する/来る不规则动词；形容词分为い形容词和な形容词。变形前先确认词类，后面的规则才不会乱。',
    points: ['五段：書く、話す、読む、買う', '一段：食べる、見る、起きる', '不规则：する、来る'],
  },
  {
    title: 'ます形是礼貌入口',
    description: 'ます形适合日常礼貌表达，也常作为连接其他语法的基础。五段动词把词尾变到い段再加ます，一段动词去る加ます。',
    points: ['書く -> 書きます', '読む -> 読みます', '食べる -> 食べます', 'する -> します'],
  },
  {
    title: 'て形连接动作和请求',
    description: 'て形用于“做完后、正在做、请做”等表达。五段动词会按词尾发生音便，是入门阶段最值得集中记的一组。',
    points: ['書く -> 書いて', '読む -> 読んで', '待つ -> 待って', '食べる -> 食べて'],
  },
  {
    title: 'ない形表达否定',
    description: '五段动词把词尾变到あ段加ない，う结尾变わない；一段动词去る加ない。不规则动词需要单独记。',
    points: ['書く -> 書かない', '買う -> 買わない', '見る -> 見ない', '来る -> 来ない'],
  },
  {
    title: 'た形表示过去或完成',
    description: 'た形和て形的变化路线几乎一样，只是把て/で换成た/だ。记住て形以后，た形会轻松很多。',
    points: ['書いて -> 書いた', '読んで -> 読んだ', '待って -> 待った', '食べて -> 食べた'],
  },
  {
    title: '形容词也会变形',
    description: 'い形容词直接改词尾，な形容词更像名词，常借助です/だ来表达时态和否定。',
    points: ['高い -> 高くない -> 高かった', '静かだ -> 静かではない -> 静かだった'],
  },
];

const CONJUGATION_EXAMPLES = [
  {
    label: '礼貌现在',
    base: '書く',
    forms: ['書きます', '書きません'],
    sentence: '毎日、日記を書きます。',
    translation: '我每天写日记。',
  },
  {
    label: 'て形请求',
    base: '待つ',
    forms: ['待って', '待ってください'],
    sentence: 'ここで少し待ってください。',
    translation: '请在这里稍等一下。',
  },
  {
    label: '否定',
    base: '飲む',
    forms: ['飲まない', '飲みません'],
    sentence: '今日はコーヒーを飲みません。',
    translation: '今天不喝咖啡。',
  },
  {
    label: '过去完成',
    base: '食べる',
    forms: ['食べた', '食べました'],
    sentence: '朝ご飯を食べました。',
    translation: '吃过早饭了。',
  },
  {
    label: '可能形',
    base: '話す',
    forms: ['話せる', '話せます'],
    sentence: '少し日本語が話せます。',
    translation: '会说一点日语。',
  },
  {
    label: '意向形',
    base: '行く',
    forms: ['行こう', '行きましょう'],
    sentence: '週末、一緒に映画を見に行きましょう。',
    translation: '周末一起去看电影吧。',
  },
  {
    label: 'い形容词否定',
    base: '難しい',
    forms: ['難しくない', '難しくありません'],
    sentence: 'この問題はあまり難しくありません。',
    translation: '这道题不太难。',
  },
  {
    label: 'な形容词过去',
    base: '静か',
    forms: ['静かだった', '静かでした'],
    sentence: '昨日の図書館はとても静かでした。',
    translation: '昨天的图书馆很安静。',
  },
];

type ReviewChoice = {
  id: string;
  text: string;
  isDistractor: boolean;
};
type CommunityStrategy = {
  version?: number;
  updatedAt?: string;
  email?: string;
  wechat?: string;
  url?: string;
  groups?: unknown[];
};
type CommunityState = 'idle' | 'loading' | 'ready' | 'error';

function App() {
  const [draft, setDraft] = useState<ExportWorkspaceDraft | null>(null);
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [history, setHistory] = useState<ExportHistoryItem[]>([]);
  const [activeMenu, setActiveMenu] = useState<MenuKey>(() => getInitialMenu());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [openSubmenus, setOpenSubmenus] = useState<Record<string, boolean>>({ beginner: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettings>(DEFAULT_EXTENSION_SETTINGS);
  const [activeSiteTab, setActiveSiteTab] = useState<SiteAccessMode>(DEFAULT_EXTENSION_SETTINGS.siteAccessMode);
  const [tagDraft, setTagDraft] = useState('');
  const [removingFavoriteIds, setRemovingFavoriteIds] = useState<string[]>([]);
  const [expandedFurigana, setExpandedFurigana] = useState<Record<string, boolean>>({});
  const [favoriteRubyMap, setFavoriteRubyMap] = useState<Record<string, string>>({});
  const [reviewingFavorite, setReviewingFavorite] = useState<FavoriteItem | null>(null);
  const [reviewTargetBlocks, setReviewTargetBlocks] = useState<string[]>([]);
  const [reviewChoices, setReviewChoices] = useState<ReviewChoice[]>([]);
  const [selectedReviewChoiceIds, setSelectedReviewChoiceIds] = useState<string[]>([]);
  const [reviewError, setReviewError] = useState('');
  const [communityStrategy, setCommunityStrategy] = useState<CommunityStrategy | null>(null);
  const [communityState, setCommunityState] = useState<CommunityState>('idle');
  const [communityError, setCommunityError] = useState('');
  const [kanaMode, setKanaMode] = useState<KanaMode>('hiragana');
  const [selectedKana, setSelectedKana] = useState('あ');

  useEffect(() => {
    const load = async () => {
      const draftId = new URLSearchParams(window.location.search).get('draft');
      const storage = await browser.storage.local.get([
        EXPORT_DRAFTS_STORAGE_KEY,
        EXPORT_HISTORY_STORAGE_KEY,
        FAVORITES_STORAGE_KEY,
        'extensionSettings',
      ]);

      const draftMap = normalizeDraftMap(storage[EXPORT_DRAFTS_STORAGE_KEY]);
      const nextDraft = draftId ? draftMap[draftId] ?? null : null;
      const nextFavorites = normalizeFavoriteItems(storage[FAVORITES_STORAGE_KEY])
        .sort((left, right) => right.timestamp - left.timestamp);
      const nextHistory = normalizeHistory(storage[EXPORT_HISTORY_STORAGE_KEY]);

      setDraft(nextDraft);
      setFavorites(nextFavorites);
      setHistory(nextHistory);
      const nextExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS, ...(storage.extensionSettings ?? {}) };
      setExtensionSettings(nextExtensionSettings);
      setActiveSiteTab(nextExtensionSettings.siteAccessMode);
      setError(nextDraft ? '' : '没有找到可编辑的导出草稿，请先从 popup 发起“导出当前页面”。');
      setLoading(false);
    };

    void load();
  }, []);

  useEffect(() => {
    const handleStorageChange = (changes: Record<string, { newValue?: unknown }>, areaName: string) => {
      if (areaName !== 'local') return;

      if (changes[FAVORITES_STORAGE_KEY]) {
        setFavorites(normalizeFavoriteItems(changes[FAVORITES_STORAGE_KEY].newValue).sort((left, right) => right.timestamp - left.timestamp));
      }

      if (changes.extensionSettings) {
        const nextExtensionSettings = { ...DEFAULT_EXTENSION_SETTINGS, ...(changes.extensionSettings.newValue ?? {}) };
        setExtensionSettings(nextExtensionSettings);
      }
    };

    browser.storage.onChanged.addListener(handleStorageChange);
    return () => browser.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  useEffect(() => {
    if (!draft) return;

    const needsGeneration = draft.blocks.some((block) => !block.tokens.length && block.text.trim());
    if (!needsGeneration) return;

    void hydrateDraftRuby(draft, setDraft, setError);
  }, [draft]);

  useEffect(() => {
    if (!draft) return;

    const handle = window.setTimeout(async () => {
      const nextDraft = {
        ...draft,
        updatedAt: new Date().toISOString(),
      };

      const storage = await browser.storage.local.get([EXPORT_DRAFTS_STORAGE_KEY, EXPORT_HISTORY_STORAGE_KEY]);
      const draftMap = normalizeDraftMap(storage[EXPORT_DRAFTS_STORAGE_KEY]);
      const nextHistory = upsertHistory(normalizeHistory(storage[EXPORT_HISTORY_STORAGE_KEY]), nextDraft);
      draftMap[nextDraft.id] = nextDraft;

      await browser.storage.local.set({
        [EXPORT_DRAFTS_STORAGE_KEY]: draftMap,
        [EXPORT_HISTORY_STORAGE_KEY]: nextHistory,
      });

      setHistory(nextHistory);
    }, 250);

    return () => window.clearTimeout(handle);
  }, [draft]);

  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 360);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (activeMenu !== 'community' || communityState !== 'idle') return;

    void loadCommunityStrategy(setCommunityStrategy, setCommunityState, setCommunityError);
  }, [activeMenu, communityState]);

  const includedBlocks = useMemo(
    () => draft?.blocks.filter((block) => block.included) ?? [],
    [draft],
  );

  const favoriteCount = favorites.length;
  const loadPercent = Math.min(100, (favoriteCount / FAVORITES_LIMIT) * 100);
  const inboxFull = favoriteCount >= FAVORITES_LIMIT;
  const communityUrl = normalizeHttpUrl(communityStrategy?.url);
  const dashboardLogo = browser.runtime.getURL('/icon/logo.svg' as never);
  const currentTagList = useMemo(
    () => activeSiteTab === 'blacklist' ? extensionSettings.blacklist : extensionSettings.whitelist,
    [activeSiteTab, extensionSettings.blacklist, extensionSettings.whitelist],
  );

  const saveExtensionSettings = async (patch: Partial<ExtensionSettings>) => {
    const nextSettings = { ...extensionSettings, ...patch };
    setExtensionSettings(nextSettings);
    await browser.storage.local.set({ extensionSettings: nextSettings });
  };

  const setSiteAccessMode = async (mode: SiteAccessMode) => {
    setActiveSiteTab(mode);
    await saveExtensionSettings({ siteAccessMode: mode });
  };

  const commitTag = async (rawValue: string) => {
    const normalized = normalizeHost(rawValue);
    if (!normalized) return;

    const nextList = Array.from(new Set([...currentTagList, normalized]));
    setTagDraft('');

    if (activeSiteTab === 'blacklist') {
      await saveExtensionSettings({ blacklist: nextList });
      return;
    }

    await saveExtensionSettings({ whitelist: nextList });
  };

  const removeTag = async (host: string) => {
    const nextList = currentTagList.filter((item) => item !== host);

    if (activeSiteTab === 'blacklist') {
      await saveExtensionSettings({ blacklist: nextList });
      return;
    }

    await saveExtensionSettings({ whitelist: nextList });
  };

  const handleTagInputKeyDown = async (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    await commitTag(tagDraft);
  };

  const openFavoriteReview = async (item: FavoriteItem) => {
    const rubyHtml = favoriteRubyMap[item.id] ?? item.furigana ?? await furiganaService.convert(item.text);
    const readingText = normalizeKanaReading(extractReadingText(rubyHtml) || item.text);
    const targetBlocks = splitKanaBlocks(readingText);
    setFavoriteRubyMap((current) => ({ ...current, [item.id]: rubyHtml }));
    setReviewingFavorite(item);
    setReviewTargetBlocks(targetBlocks);
    setReviewChoices(buildReviewChoices(targetBlocks));
    setSelectedReviewChoiceIds([]);
    setReviewError('');
  };

  const closeFavoriteReview = () => {
    setReviewingFavorite(null);
    setReviewTargetBlocks([]);
    setReviewChoices([]);
    setSelectedReviewChoiceIds([]);
    setReviewError('');
  };

  const selectReviewChoice = async (choice: ReviewChoice) => {
    if (!reviewingFavorite || !reviewTargetBlocks.length) return;
    if (selectedReviewChoiceIds.includes(choice.id)) return;

    const nextSelectedIds = [...selectedReviewChoiceIds, choice.id];
    setSelectedReviewChoiceIds(nextSelectedIds);

    const selectedText = nextSelectedIds
      .map((id) => reviewChoices.find((item) => item.id === id)?.text ?? '')
      .filter(Boolean)
      .join('');
    const targetReading = reviewTargetBlocks.join('');

    if (targetReading.startsWith(selectedText)) {
      setReviewError('');
      if (selectedText === targetReading) {
        await completeFavorite(reviewingFavorite.id, setFavorites, setRemovingFavoriteIds);
        closeFavoriteReview();
      }
      return;
    }

    setReviewError('这个发音不对，试着重新拼一次。');
  };

  const removeSelectedReviewChoice = (choiceId: string) => {
    setSelectedReviewChoiceIds((current) => current.filter((id) => id !== choiceId));
    setReviewError('');
  };

  const resetReviewInput = () => {
    setSelectedReviewChoiceIds([]);
    setReviewError('');
  };

  const renderMain = () => {
    if (loading) {
      return <div className="workspace-empty">正在载入导出工作台...</div>;
    }

    if (activeMenu === 'favorites') {
      return (
        <section className="workspace-panel workspace-panel--favorites">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">收藏记录</p>
              <h2>待办词条 Inbox</h2>
              <p className="workspace-meta">收藏不是仓库，而是等待被你学习并消灭的任务堆。</p>
            </div>
          </div>

          <section className={`favorites-load ${inboxFull ? 'is-full' : ''}`}>
            <div className="favorites-load__header">
              <strong>当前负荷：{favoriteCount} / {FAVORITES_LIMIT}</strong>
              <span>{inboxFull ? '已锁定新增' : '继续清空它们'}</span>
            </div>
            <div className="favorites-load__track">
              <div className="favorites-load__bar" style={{ width: `${loadPercent}%` }} />
            </div>
            {inboxFull ? <p className="favorites-load__warning">{FULL_LOAD_MESSAGE}</p> : null}
          </section>

          {favorites.length ? (
            <div className="favorites-grid">
              {favorites.map((item) => (
                <FavoriteInboxCard
                  extensionSettings={extensionSettings}
                  item={item}
                  isRemoving={removingFavoriteIds.includes(item.id)}
                  key={item.id}
                  onComplete={() => void openFavoriteReview(item)}
                  onJumpToSource={() => void openSourceUrl(item.sourceUrl)}
                  onQuickSpeak={() => playAudio(item.text)}
                  onToggleFurigana={() => void toggleFavoriteFurigana(item, expandedFurigana, setExpandedFurigana, favoriteRubyMap, setFavoriteRubyMap)}
                  rubyHtml={favoriteRubyMap[item.id] ?? item.furigana ?? ''}
                  showFurigana={Boolean(expandedFurigana[item.id])}
                />
              ))}
            </div>
          ) : (
            <div className="workspace-empty">空山基：你的大脑目前一身轻松，去摄入新内容吧。</div>
          )}
        </section>
      );
    }

    if (activeMenu === 'site-policies') {
      return (
        <section className="workspace-panel workspace-panel--site-policies">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">站点策略</p>
              <h2>黑白名单管理</h2>
              <p className="workspace-meta">popup 只保留当前站点的快捷切换，完整历史和维护操作都集中在这里。</p>
            </div>
          </div>

          <div className="site-policy-overview">
            <article className="workspace-stat">
              <span>当前策略</span>
              <strong>{extensionSettings.siteAccessMode === 'blacklist' ? '黑名单模式' : '白名单模式'}</strong>
            </article>
            <article className="workspace-stat">
              <span>黑名单</span>
              <strong>{extensionSettings.blacklist.length}</strong>
            </article>
            <article className="workspace-stat">
              <span>白名单</span>
              <strong>{extensionSettings.whitelist.length}</strong>
            </article>
          </div>

          <div className="site-policy-mode-switcher">
            {(['blacklist', 'whitelist'] as SiteAccessMode[]).map((mode) => (
              <button
                key={mode}
                className={`site-policy-mode-switcher__tab ${extensionSettings.siteAccessMode === mode ? 'is-active' : ''}`}
                onClick={() => void setSiteAccessMode(mode)}
                type="button"
              >
                {mode === 'blacklist' ? '当前使用黑名单模式' : '当前使用白名单模式'}
              </button>
            ))}
          </div>

          <div className="site-policy-editor">
            <div className="site-policy-editor__header">
              <div className="site-policy-tab-switcher">
                {(['blacklist', 'whitelist'] as SiteAccessMode[]).map((tab) => (
                  <button
                    key={tab}
                    className={`site-policy-tab-switcher__tab ${activeSiteTab === tab ? 'is-active' : ''}`}
                    onClick={() => setActiveSiteTab(tab)}
                    type="button"
                  >
                    {tab === 'blacklist' ? '编辑黑名单' : '编辑白名单'}
                  </button>
                ))}
              </div>
              <span className="site-policy-editor__count">
                共 {currentTagList.length} 项
              </span>
            </div>

            <label className="site-policy-field">
              <span>{activeSiteTab === 'blacklist' ? '添加黑名单域名' : '添加白名单域名'}</span>
              <div className="site-policy-field__input">
                <input
                  placeholder="输入域名后按 Enter"
                  value={tagDraft}
                  onChange={(event) => setTagDraft(event.target.value)}
                  onKeyDown={handleTagInputKeyDown}
                />
                <button onClick={() => void commitTag(tagDraft)} type="button">添加</button>
              </div>
            </label>

            <div className="site-policy-list">
              {currentTagList.length ? currentTagList.map((host) => (
                <span className="site-policy-chip" key={host}>
                  <span>{host}</span>
                  <button aria-label={`移除 ${host}`} onClick={() => void removeTag(host)} type="button">
                    <X size={16} strokeWidth={1.8} />
                  </button>
                </span>
              )) : (
                <div className="workspace-empty workspace-empty--compact">
                  {activeSiteTab === 'blacklist' ? '黑名单还是空的。' : '白名单还是空的。'}
                </div>
              )}
            </div>
          </div>
        </section>
      );
    }

    if (activeMenu === 'beginner-kana') {
      return (
        <KanaLearningPanel
          activeMode={kanaMode}
          selectedKana={selectedKana}
          onChangeMode={(mode) => {
            setKanaMode(mode);
            setSelectedKana(getFirstKana(mode));
          }}
          onSelectKana={(kana) => {
            setSelectedKana(kana);
            playAudio(kana);
          }}
        />
      );
    }

    if (activeMenu === 'beginner-grammar') {
      return <BasicGrammarPanel />;
    }

    if (activeMenu === 'beginner-reading-basics') {
      return <ReadingBasicsPanel />;
    }

    if (activeMenu === 'beginner-conjugation') {
      return <ConjugationLearningPanel />;
    }

    if (activeMenu === 'beginner-mimetic') {
      return <MimeticLearningPanel />;
    }

    if (activeMenu === 'community') {
      return (
        <section className="workspace-panel workspace-panel--community">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">加入社群</p>
              <h2>交流与反馈</h2>
              <p className="workspace-meta">问题反馈、使用交流、功能建议，都可以从这里跳转到最新社群入口。</p>
            </div>
          </div>

          <section className="community-hero">
            <div className="community-hero__copy">
              <p className="workspace-kicker">Community Hub</p>
              <h3>加入日语注音使用社群</h3>
              <p>获取新版词典补丁、反馈注音问题、一起整理常见误读和学习场景。</p>
              <div className="community-actions">
                <button
                  className="workspace-button community-primary-action"
                  disabled={!communityUrl}
                  onClick={() => communityUrl ? void browser.tabs.create({ url: communityUrl }) : undefined}
                  type="button"
                >
                  <ExternalLink size={20} strokeWidth={1.8} />
                  <span>{communityState === 'loading' ? '正在读取入口' : '打开社群入口'}</span>
                </button>
              </div>
              {!communityUrl && communityState === 'error' ? <p className="community-error">{communityError}</p> : null}
            </div>
          </section>
        </section>
      );
    }

    if (!draft) {
      return <div className="workspace-empty">{error || '暂无草稿'}</div>;
    }

    return (
      <div className="workspace-content">
        <section className="workspace-panel workspace-panel--editor">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">打印内容</p>
              <h2>{draft.title}</h2>
              <p className="workspace-meta">{draft.sourceUrl}</p>
            </div>
            <div className="workspace-actions">
              <button className="workspace-button workspace-button--ghost" onClick={() => window.print()} type="button">
                <Printer {...ICON_PROPS} />
                <span>导出 PDF</span>
              </button>
            </div>
          </div>

          <div className="workspace-stats">
            <div className="workspace-stat">
              <span>保留段落</span>
              <strong>{includedBlocks.length}</strong>
            </div>
            <div className="workspace-stat">
              <span>最近保存</span>
              <strong>{formatDateTime(draft.updatedAt)}</strong>
            </div>
          </div>

          <div className="editor-list">
            {draft.blocks.map((block, index) => {
              const stale = isDraftStale(block);
              return (
                <article className="editor-card" key={block.id}>
                  <div className="editor-card__toolbar">
                    <label className="editor-card__toggle">
                      <input
                        checked={block.included}
                        onChange={(event) => updateDraftBlock(setDraft, block.id, { included: event.target.checked })}
                        type="checkbox"
                      />
                      <span>{block.included ? '已收录' : '已排除'}</span>
                    </label>

                    <div className="editor-card__actions">
                      <button
                        className="icon-action"
                        disabled={index === 0}
                        onClick={() => moveDraftBlock(setDraft, index, -1)}
                        title="上移"
                        type="button"
                      >
                        <ChevronUp {...ICON_PROPS} />
                      </button>
                      <button
                        className="icon-action"
                        disabled={index === draft.blocks.length - 1}
                        onClick={() => moveDraftBlock(setDraft, index, 1)}
                        title="下移"
                        type="button"
                      >
                        <ChevronUp className="rotate-180" {...ICON_PROPS} />
                      </button>
                      <button
                        className="icon-action"
                        onClick={() => void regenerateBlock(setDraft, draft, block.id)}
                        title="重新生成注音"
                        type="button"
                      >
                        <RefreshCw {...ICON_PROPS} />
                      </button>
                      <button
                        className="icon-action"
                        onClick={() => removeDraftBlock(setDraft, block.id)}
                        title="删除段落"
                        type="button"
                      >
                        <Trash2 {...ICON_PROPS} />
                      </button>
                    </div>
                  </div>

                  <div className="editor-card__grid">
                    <div className="editor-card__fields">
                      <label className="editor-label">
                        <span>段落样式</span>
                        <select
                          className="editor-select"
                          value={block.kind}
                          onChange={(event) => updateDraftBlock(setDraft, block.id, { kind: event.target.value as ExportBlockKind })}
                        >
                          <option value="title">主标题</option>
                          <option value="subtitle">副标题</option>
                          <option value="paragraph">正文</option>
                          <option value="quote">引用</option>
                          <option value="list-item">列表</option>
                        </select>
                      </label>

                      <label className="editor-label">
                        <span>文字内容</span>
                        <textarea
                          className="editor-textarea"
                          rows={block.kind === 'paragraph' ? 5 : 3}
                          value={block.text}
                          onBlur={() => void regenerateBlock(setDraft, draft, block.id)}
                          onChange={(event) => updateDraftBlock(setDraft, block.id, { text: event.target.value })}
                        />
                      </label>

                      <div className="editor-ruby">
                        <div className="editor-ruby__header">
                          <span>注音修正</span>
                          {stale ? <span className="editor-hint">正文已改动，离开输入框后会自动重算注音。</span> : null}
                        </div>
                        <div className="editor-ruby__list">
                          {block.tokens.filter((token) => token.type === 'ruby').length ? (
                            block.tokens.map((token) => token.type === 'ruby' ? (
                              <label className="ruby-chip" key={token.id}>
                                <span>{token.text}</span>
                                <input
                                  value={token.reading ?? ''}
                                  onChange={(event) => updateDraftToken(setDraft, block.id, token.id, event.target.value)}
                                />
                              </label>
                            ) : null)
                          ) : (
                            <div className="editor-hint">这段里暂时没有可编辑的注音，或正在生成中。</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="editor-card__preview">
                      <p className="editor-preview__label">打印预览</p>
                      <BlockPreview block={block} />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <aside className="workspace-panel workspace-panel--history">
          <div className="workspace-panel__header">
            <div>
              <p className="workspace-kicker">历史记录</p>
              <h2>最近导出</h2>
            </div>
          </div>

          <div className="history-list">
            {history.length ? history.map((item) => (
              <article className="history-card" key={item.id}>
                <h3>{item.title}</h3>
                <p>{item.blockCount} 段内容</p>
                <time>{formatDateTime(item.updatedAt)}</time>
              </article>
            )) : (
              <div className="workspace-empty workspace-empty--compact">这里空空如也</div>
            )}
          </div>
        </aside>

        <section className="print-sheet-wrapper">
          <article className="print-sheet">
            <header className="print-sheet__header">
              <p className="print-sheet__eyebrow">Japanese Reading Export</p>
              <h1>{draft.title}</h1>
              <p>{draft.sourceUrl}</p>
            </header>

            <div className="print-sheet__body">
              {includedBlocks.map((block) => (
                <BlockPreview block={block} key={block.id} printable />
              ))}
            </div>
          </article>
        </section>
      </div>
    );
  };

  return (
    <div className={`workspace-shell ${sidebarCollapsed ? 'is-nav-collapsed' : ''}`}>
      <aside className="workspace-sidebar">
        <div className="workspace-brand">
       
          <button
            aria-label={sidebarCollapsed ? '展开菜单' : '收起菜单'}
            aria-pressed={sidebarCollapsed}
            className="workspace-sidebar__toggle"
            onClick={() => setSidebarCollapsed((current) => !current)}
            title={sidebarCollapsed ? '展开菜单' : '收起菜单'}
            type="button"
          >
               <div className="workspace-brand__icon">
            <img alt="" className="workspace-brand__logo" src={dashboardLogo} />
          </div>
        
          </button>
            <div className="workspace-brand__text">
            <strong>瓯葉划词</strong>
          </div>
        </div>

        <nav aria-label="管理后台菜单" className="workspace-nav">
          <button
            className={`workspace-nav__item ${activeMenu === 'print' ? 'is-active' : ''}`}
            onClick={() => setActiveMenu('print')}
            title="打印内容"
            type="button"
          >
            <FileText {...ICON_PROPS} />
            <span>打印内容</span>
          </button>
          <button
            className={`workspace-nav__item ${activeMenu === 'favorites' ? 'is-active' : ''}`}
            onClick={() => setActiveMenu('favorites')}
            title="收藏记录"
            type="button"
          >
            <BookMarked {...ICON_PROPS} />
            <span>收藏记录</span>
          </button>
          <div className={`workspace-nav__group ${openSubmenus.beginner && !sidebarCollapsed ? 'is-open' : ''}`}>
            <button
              aria-expanded={openSubmenus.beginner && !sidebarCollapsed}
              className={`workspace-nav__item workspace-nav__item--parent ${activeMenu.startsWith('beginner-') ? 'is-active' : ''}`}
              onClick={() => {
                if (sidebarCollapsed) {
                  setSidebarCollapsed(false);
                  setOpenSubmenus((current) => ({ ...current, beginner: true }));
                  return;
                }

                setOpenSubmenus((current) => ({ ...current, beginner: !current.beginner }));
              }}
              title="入门学习"
              type="button"
            >
              <GraduationCap {...ICON_PROPS} />
              <span>入门学习</span>
              <ChevronDown className="workspace-nav__chevron" size={18} strokeWidth={1.8} />
            </button>
            <div className="workspace-nav__submenu">
              {BEGINNER_MENU_ITEMS.map((item) => {
                const Icon = item.icon;

                return (
                  <button
                    className={`workspace-nav__subitem ${activeMenu === item.key ? 'is-active' : ''}`}
                    key={item.key}
                    onClick={() => setActiveMenu(item.key)}
                    type="button"
                  >
                    <Icon size={18} strokeWidth={1.8} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <button
            className={`workspace-nav__item ${activeMenu === 'site-policies' ? 'is-active' : ''}`}
            onClick={() => setActiveMenu('site-policies')}
            title="站点策略"
            type="button"
          >
            <Languages {...ICON_PROPS} />
            <span>站点策略</span>
          </button>
          {SHOW_COMMUNITY_SECTION ? (
            <button
              className={`workspace-nav__item ${activeMenu === 'community' ? 'is-active' : ''}`}
              onClick={() => setActiveMenu('community')}
              title="加入社群"
              type="button"
            >
              <Users {...ICON_PROPS} />
              <span>加入社群</span>
            </button>
          ) : null}
        </nav>
      </aside>

      <main className="workspace-main">{renderMain()}</main>

      {reviewingFavorite ? (
        <FavoriteReviewDialog
          availableChoices={reviewChoices.filter((choice) => !selectedReviewChoiceIds.includes(choice.id))}
          item={reviewingFavorite}
          onClose={closeFavoriteReview}
          onPickChoice={(choice) => void selectReviewChoice(choice)}
          onRemoveChoice={removeSelectedReviewChoice}
          onReset={resetReviewInput}
          reviewError={reviewError}
          reviewReading={reviewTargetBlocks.join('')}
          rubyHtml={favoriteRubyMap[reviewingFavorite.id] ?? reviewingFavorite.furigana ?? ''}
          selectedChoices={selectedReviewChoiceIds
            .map((id) => reviewChoices.find((choice) => choice.id === id))
            .filter((choice): choice is ReviewChoice => Boolean(choice))}
        />
      ) : null}

      <button
        aria-label="回到顶部"
        className={`back-to-top ${showBackToTop ? 'is-visible' : ''}`}
        onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        type="button"
      >
        <ChevronUp {...ICON_PROPS} />
        <span>顶部</span>
      </button>
    </div>
  );
}

function getInitialMenu(): MenuKey {
  const section = new URLSearchParams(window.location.search).get('section');
  if (section === 'site-policies') {
    return 'site-policies';
  }
  if (section === 'beginner' || section === 'beginner-kana') {
    return 'beginner-kana';
  }
  if (section === 'beginner-grammar') {
    return 'beginner-grammar';
  }
  if (section === 'beginner-reading-basics') {
    return 'beginner-reading-basics';
  }
  if (section === 'beginner-conjugation') {
    return 'beginner-conjugation';
  }
  if (section === 'beginner-mimetic') {
    return 'beginner-mimetic';
  }
  if (SHOW_COMMUNITY_SECTION && section === 'community') {
    return 'community';
  }

  return 'print';
}

function getFirstKana(mode: KanaMode) {
  return KANA_TABLES[mode].flatMap((row) => row.kana).find((kana): kana is string => Boolean(kana)) ?? 'あ';
}

function parseStoredGrammarIds() {
  return new Set(
    (window.localStorage.getItem(MASTERED_GRAMMAR_STORAGE_KEY) ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function persistGrammarIds(ids: Set<string>) {
  window.localStorage.setItem(MASTERED_GRAMMAR_STORAGE_KEY, Array.from(ids).join(','));
}

function isGrammarMastered(id: string) {
  return parseStoredGrammarIds().has(id);
}

function parseStoredReadingBasicsIds() {
  return new Set(
    (window.localStorage.getItem(MASTERED_READING_BASICS_STORAGE_KEY) ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

function persistReadingBasicsIds(ids: Set<string>) {
  window.localStorage.setItem(MASTERED_READING_BASICS_STORAGE_KEY, Array.from(ids).join(','));
}

function parseStoredMimeticWords() {
  return new Set(
    (window.localStorage.getItem(MASTERED_MIMETIC_STORAGE_KEY) ?? '')
      .split(',')
      .map((word) => word.trim())
      .filter(Boolean),
  );
}

function persistMimeticWords(words: Set<string>) {
  window.localStorage.setItem(MASTERED_MIMETIC_STORAGE_KEY, Array.from(words).join(','));
}

function getKanaRowFilter(text: string): KanaRowFilter {
  const firstKana = normalizeKanaForSearch(text).charAt(0);
  const matched = KANA_ROW_FILTERS.find((filter) => filter.key !== 'all' && filter.kana.includes(firstKana));
  return matched?.key ?? 'all';
}

function normalizeKanaForSearch(text: string) {
  return text
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
    .toLowerCase();
}

function ConjugationLearningPanel() {
  return (
    <section className="workspace-panel workspace-panel--conjugation">
      <div className="workspace-panel__header">
        <div>
          <p className="workspace-kicker">入门学习</p>
          <h2>日语变形</h2>
          <p className="workspace-meta">把词尾变化当作“句子工具箱”：先识别词类，再根据语气、时态和连接方式选择形态。</p>
        </div>
      </div>

      <section className="conjugation-overview">
        <div>
          <p className="workspace-kicker">Conjugation Map</p>
          <h3>先抓住三个问题</h3>
        </div>
        <div className="conjugation-overview__steps">
          <span>这个词是动词、い形容词，还是な形容词？</span>
          <span>句子要表达礼貌、否定、过去、请求，还是连接？</span>
          <span>变化后还能不能接后面的语法点？</span>
        </div>
      </section>

      <div className="conjugation-rule-grid">
        {CONJUGATION_RULES.map((rule) => (
          <article className="conjugation-rule-card" key={rule.title}>
            <h3>{rule.title}</h3>
            <p>{rule.description}</p>
            <div className="conjugation-chip-list">
              {rule.points.map((point) => <span key={point}>{point}</span>)}
            </div>
          </article>
        ))}
      </div>

      <section className="conjugation-examples">
        <div className="conjugation-section-heading">
          <p className="workspace-kicker">常用变形举例</p>
          <h3>从原形到句子</h3>
        </div>
        <div className="conjugation-example-list">
          {CONJUGATION_EXAMPLES.map((example) => (
            <article className="conjugation-example" key={`${example.label}-${example.base}`}>
              <div className="conjugation-example__header">
                <span>{example.label}</span>
                <strong>{example.base}</strong>
              </div>
              <div className="conjugation-chip-list">
                {example.forms.map((form) => <span key={form}>{form}</span>)}
              </div>
              <p className="conjugation-example__sentence">{example.sentence}</p>
              <p>{example.translation}</p>
            </article>
          ))}
        </div>
      </section>
    </section>
  );
}

function ReadingBasicsPanel() {
  const [activeCategory, setActiveCategory] = useState<ReadingBasicsCategory>('all');
  const [onlyUnmastered, setOnlyUnmastered] = useState(false);
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => parseStoredReadingBasicsIds());
  const [animatedProgressPercent, setAnimatedProgressPercent] = useState(0);
  const [renderedCount, setRenderedCount] = useState(READING_BASICS_RENDER_BATCH_SIZE);

  const progressByCategory = useMemo(() => {
    return Object.fromEntries(
      READING_BASICS_CATEGORY_FILTERS.map((filter) => {
        const items = filter.key === 'all'
          ? READING_BASICS_ITEMS
          : READING_BASICS_ITEMS.filter((item) => item.category === filter.key);
        const masteredCount = items.filter((item) => masteredIds.has(item.id)).length;

        return [filter.key, {
          masteredCount,
          percent: items.length ? Math.round((masteredCount / items.length) * 100) : 0,
          totalCount: items.length,
        }];
      }),
    ) as Record<ReadingBasicsCategory, { masteredCount: number; percent: number; totalCount: number }>;
  }, [masteredIds]);

  const visibleItems = useMemo(() => {
    return READING_BASICS_ITEMS.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) return false;
      if (onlyUnmastered && masteredIds.has(item.id)) return false;
      return true;
    });
  }, [activeCategory, masteredIds, onlyUnmastered]);

  const activeProgress = progressByCategory[activeCategory];
  const renderedItems = useMemo(
    () => visibleItems.slice(0, renderedCount),
    [renderedCount, visibleItems],
  );

  useEffect(() => {
    setAnimatedProgressPercent(0);
    const animationFrame = window.requestAnimationFrame(() => {
      setAnimatedProgressPercent(activeProgress.percent);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeCategory, activeProgress.percent]);

  useEffect(() => {
    setRenderedCount(READING_BASICS_RENDER_BATCH_SIZE);
  }, [activeCategory, onlyUnmastered, visibleItems.length]);

  useEffect(() => {
    if (renderedCount >= visibleItems.length) return;

    const loadTimer = window.setTimeout(() => {
      setRenderedCount((current) => Math.min(current + READING_BASICS_RENDER_BATCH_SIZE, visibleItems.length));
    }, 40);

    return () => window.clearTimeout(loadTimer);
  }, [renderedCount, visibleItems.length]);

  const handleMasteredChange = useCallback((id: string, isMastered: boolean) => {
    setMasteredIds((current) => {
      const next = new Set(current);
      if (isMastered) {
        next.add(id);
      } else {
        next.delete(id);
      }
      persistReadingBasicsIds(next);
      return next;
    });
  }, []);

  const handleCategoryChange = (category: ReadingBasicsCategory) => {
    setRenderedCount(READING_BASICS_RENDER_BATCH_SIZE);
    setActiveCategory(category);
  };

  const handleOnlyUnmasteredChange = (checked: boolean) => {
    setRenderedCount(READING_BASICS_RENDER_BATCH_SIZE);
    setOnlyUnmastered(checked);
    if (checked) {
      setMasteredIds(parseStoredReadingBasicsIds());
    }
  };

  return (
    <section className="workspace-panel workspace-panel--reading-basics">
      <div className="workspace-panel__header">
        <div>
          <p className="workspace-kicker">入门学习</p>
          <h2>数字・单位・符号</h2>
          <p className="workspace-meta">集中整理数字、常见量词单位、标点符号的读音和变音规律，读文章和听报数时会轻松很多。</p>
        </div>
        <label className="grammar-mastered-filter">
          <input
            checked={onlyUnmastered}
            onChange={(event) => handleOnlyUnmasteredChange(event.target.checked)}
            type="checkbox"
          />
          <span>只看未掌握项目</span>
        </label>
      </div>

      <div className="grammar-toolbar">
        <div className="grammar-tabs" role="tablist" aria-label="读音基础分类">
          {READING_BASICS_CATEGORY_FILTERS.map((filter) => (
            <button
              aria-selected={activeCategory === filter.key}
              className={`grammar-tab ${activeCategory === filter.key ? 'is-active' : ''}`}
              key={filter.key}
              onClick={() => handleCategoryChange(filter.key)}
              role="tab"
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="grammar-progress" aria-label={`${activeCategory} 掌握度 ${activeProgress.percent}%`}>
          <div className="grammar-progress__meta">
            <span>掌握度</span>
            <strong>{activeProgress.masteredCount}/{activeProgress.totalCount}</strong>
          </div>
          <div className="grammar-progress__track" title={`${activeProgress.percent}% 已掌握`}>
            <span
              className="grammar-progress__fill"
              style={{ width: `${animatedProgressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="reading-basics-grid" key={`${activeCategory}-${onlyUnmastered ? 'unmastered' : 'all'}`}>
        {renderedItems.map((item) => (
          <ReadingBasicsCard
            isMastered={masteredIds.has(item.id)}
            item={item}
            key={item.id}
            onMasteredChange={handleMasteredChange}
          />
        ))}
      </div>

      {!visibleItems.length ? (
        <div className="workspace-empty workspace-empty--compact">这一类已经全部掌握了。</div>
      ) : null}
    </section>
  );
}

const ReadingBasicsCard = memo(function ReadingBasicsCard({
  isMastered,
  item,
  onMasteredChange,
}: {
  isMastered: boolean;
  item: ReadingBasicsItem;
  onMasteredChange: (id: string, isMastered: boolean) => void;
}) {
  const categoryLabel = READING_BASICS_CATEGORY_FILTERS.find((filter) => filter.key === item.category)?.label ?? '项目';

  return (
    <article className={`reading-basics-card ${isMastered ? 'is-mastered' : ''}`}>
      <label className="grammar-card__mastered">
        <input
          checked={isMastered}
          onChange={(event) => onMasteredChange(item.id, event.target.checked)}
          type="checkbox"
        />
        <span>{isMastered ? '已掌握' : '未掌握'}</span>
      </label>
      <div>
        <p className="grammar-card__pattern">{categoryLabel}</p>
        <h3>{item.title}</h3>
        <p className="reading-basics-card__reading">{item.reading}</p>
        <p className="grammar-card__translation">{item.meaning}</p>
      </div>
      <p className="reading-basics-card__rule">{item.rule}</p>
      <div className="mimetic-card__tags">
        {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
      </div>
      <div className="reading-basics-card__examples">
        {item.examples.map((example) => (
          <span key={`${item.id}-${example.text}`}>
            <strong>{example.text}</strong>
            <small>{example.reading}</small>
            {example.note ? <em>{example.note}</em> : null}
            <button
              aria-label={`播放 ${example.text} 的读音`}
              className="reading-basics-card__audio"
              onClick={() => playAudio(getPrimaryReading(example.reading))}
              title="播放读音"
              type="button"
            >
              <Volume2 size={15} strokeWidth={1.8} />
            </button>
          </span>
        ))}
      </div>
    </article>
  );
});

function getPrimaryReading(reading: string) {
  return reading.split('/')[0].trim();
}

function BasicGrammarPanel() {
  const [activeLevel, setActiveLevel] = useState<GrammarLevelFilter>('all');
  const [onlyUnmastered, setOnlyUnmastered] = useState(false);
  const [masteredIds, setMasteredIds] = useState<Set<string>>(() => parseStoredGrammarIds());
  const [animatedProgressPercent, setAnimatedProgressPercent] = useState(0);
  const [renderedGrammarCount, setRenderedGrammarCount] = useState(GRAMMAR_RENDER_BATCH_SIZE);

  const grammarProgressByLevel = useMemo(() => {
    return Object.fromEntries(
      GRAMMAR_LEVEL_FILTERS.map((filter) => {
        const sections = filter.key === 'all'
          ? BASIC_GRAMMAR_SECTIONS
          : BASIC_GRAMMAR_SECTIONS.filter((section) => section.level === filter.key);
        const masteredCount = sections.filter((section) => masteredIds.has(section.id)).length;

        return [filter.key, {
          masteredCount,
          percent: sections.length ? Math.round((masteredCount / sections.length) * 100) : 0,
          totalCount: sections.length,
        }];
      }),
    ) as Record<GrammarLevelFilter, { masteredCount: number; percent: number; totalCount: number }>;
  }, [masteredIds]);

  const visibleSections = useMemo(() => {
    return BASIC_GRAMMAR_SECTIONS.filter((section) => {
      if (activeLevel !== 'all' && section.level !== activeLevel) return false;
      if (onlyUnmastered && masteredIds.has(section.id)) return false;
      return true;
    });
  }, [activeLevel, masteredIds, onlyUnmastered]);
  const activeProgress = grammarProgressByLevel[activeLevel];
  const renderedSections = useMemo(
    () => visibleSections.slice(0, renderedGrammarCount),
    [renderedGrammarCount, visibleSections],
  );

  useEffect(() => {
    setAnimatedProgressPercent(0);
    const animationFrame = window.requestAnimationFrame(() => {
      setAnimatedProgressPercent(activeProgress.percent);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeLevel, activeProgress.percent]);

  useEffect(() => {
    setRenderedGrammarCount(GRAMMAR_RENDER_BATCH_SIZE);
  }, [activeLevel, onlyUnmastered, visibleSections.length]);

  useEffect(() => {
    if (renderedGrammarCount >= visibleSections.length) return;

    const loadTimer = window.setTimeout(() => {
      setRenderedGrammarCount((current) => Math.min(current + GRAMMAR_RENDER_BATCH_SIZE, visibleSections.length));
    }, 40);

    return () => window.clearTimeout(loadTimer);
  }, [renderedGrammarCount, visibleSections.length]);

  const syncStoredMasteredIds = useCallback(() => {
    setMasteredIds(parseStoredGrammarIds());
  }, []);

  const handleOnlyUnmasteredChange = (checked: boolean) => {
    setRenderedGrammarCount(GRAMMAR_RENDER_BATCH_SIZE);
    setOnlyUnmastered(checked);
    if (checked) {
      syncStoredMasteredIds();
    }
  };

  const handleActiveLevelChange = (level: GrammarLevelFilter) => {
    setRenderedGrammarCount(GRAMMAR_RENDER_BATCH_SIZE);
    setActiveLevel(level);
  };

  const handleCardMasteredChange = useCallback((id: string, isMastered: boolean) => {
    setMasteredIds((current) => {
      const next = new Set(current);
      if (isMastered) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  return (
    <section className="workspace-panel workspace-panel--grammar">
      <div className="workspace-panel__header">
        <div>
          <p className="workspace-kicker">入门学习</p>
          <h2>基础语法</h2>
          <p className="workspace-meta">先建立能读懂简单句子的框架：判断句、助词、形容词、时态和疑问句。</p>
        </div>
        <label className="grammar-mastered-filter">
          <input
            checked={onlyUnmastered}
            onChange={(event) => handleOnlyUnmasteredChange(event.target.checked)}
            type="checkbox"
          />
          <span>只看未掌握语法</span>
        </label>
      </div>

      <div className="grammar-toolbar">
        <div className="grammar-tabs" role="tablist" aria-label="语法等级">
          {GRAMMAR_LEVEL_FILTERS.map((filter) => (
            <button
              aria-selected={activeLevel === filter.key}
              className={`grammar-tab ${activeLevel === filter.key ? 'is-active' : ''}`}
              key={filter.key}
              onClick={() => handleActiveLevelChange(filter.key)}
              role="tab"
              type="button"
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="grammar-progress" aria-label={`${activeLevel} 掌握度 ${activeProgress.percent}%`}>
          <div className="grammar-progress__meta">
            <span>掌握度</span>
            <strong>{activeProgress.percent}%</strong>
          </div>
          <div className="grammar-progress__track" title={`${activeProgress.masteredCount}/${activeProgress.totalCount} 已掌握`}>
            <span
              className="grammar-progress__fill"
              style={{ width: `${animatedProgressPercent}%` }}
            />
          </div>
        </div>
      </div>

      <div className="grammar-grid" key={`${activeLevel}-${onlyUnmastered ? 'unmastered' : 'all'}`}>
        {renderedSections.map((section) => {
          const isMastered = masteredIds.has(section.id);

          return (
            <GrammarCard
              initialIsMastered={isMastered}
              key={section.id}
              onMasteredChange={handleCardMasteredChange}
              section={section}
            />
          );
        })}
      </div>
    </section>
  );
}

const GrammarCard = memo(function GrammarCard({
  initialIsMastered,
  onMasteredChange,
  section,
}: {
  initialIsMastered: boolean;
  onMasteredChange: (id: string, isMastered: boolean) => void;
  section: GrammarItem;
}) {
  const [isMastered, setIsMastered] = useState(() => initialIsMastered || isGrammarMastered(section.id));
  const [exampleRubyMap, setExampleRubyMap] = useState<Record<string, string>>(() => {
    return Object.fromEntries(
      section.examples
        .map((example, index) => {
          const key = getGrammarExampleRubyKey(section.id, index);
          return [key, grammarExampleRubyCache.get(key) || example.sentence] as const;
        }),
    );
  });

  useEffect(() => {
    let cancelled = false;
    const missingExamples = section.examples
      .map((example, index) => ({ key: getGrammarExampleRubyKey(section.id, index), sentence: example.sentence }))
      .filter((example) => !grammarExampleRubyCache.has(example.key));

    if (!missingExamples.length) return;

    void Promise.all(
      missingExamples.map(async (example) => [example.key, await furiganaService.convert(example.sentence)] as const),
    ).then((entries) => {
      if (cancelled) return;
      for (const [key, html] of entries) {
        grammarExampleRubyCache.set(key, html);
      }
      setExampleRubyMap((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [section]);

  const toggleMastered = () => {
    const nextValue = !isMastered;
    const nextIds = parseStoredGrammarIds();
    if (nextValue) {
      nextIds.add(section.id);
    } else {
      nextIds.delete(section.id);
    }
    persistGrammarIds(nextIds);
    setIsMastered(nextValue);
    onMasteredChange(section.id, nextValue);
  };

  return (
    <article className={`grammar-card ${isMastered ? 'is-mastered' : ''}`}>
      <label className="grammar-card__mastered">
        <input
          checked={isMastered}
          onChange={toggleMastered}
          type="checkbox"
        />
        <span>{isMastered ? '已掌握' : '未掌握'}</span>
      </label>
      <div>
        <p className="grammar-card__pattern">{section.level} · {section.kanaIndex}</p>
        <h3>{section.title}</h3>
        <p className="grammar-card__translation">{section.translation}</p>
      </div>
      <div className="grammar-card__patterns">
        {section.patterns.map((pattern) => <span key={pattern}>{pattern}</span>)}
      </div>
      <p>{section.explanation}</p>
      <p className="grammar-card__formation">{section.formation}</p>
      <div className="grammar-card__examples">
        {section.examples.map((example, index) => {
          const rubyKey = getGrammarExampleRubyKey(section.id, index);

          return (
            <span key={example.sentence}>
              <strong dangerouslySetInnerHTML={{ __html: exampleRubyMap[rubyKey] || example.sentence }} />
              <small>{example.translation}</small>
            </span>
          );
        })}
      </div>
    </article>
  );
});

function getGrammarExampleRubyKey(sectionId: string, exampleIndex: number) {
  return `${sectionId}:${exampleIndex}`;
}

function MimeticLearningPanel() {
  const [mimeticWords, setMimeticWords] = useState<MimeticWordItem[]>([]);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [activeRow, setActiveRow] = useState<KanaRowFilter>('all');
  const [onlyUnmastered, setOnlyUnmastered] = useState(false);
  const [masteredWords, setMasteredWords] = useState<Set<string>>(() => parseStoredMimeticWords());
  const [renderedCount, setRenderedCount] = useState(MIMETIC_RENDER_BATCH_SIZE);

  useEffect(() => {
    let cancelled = false;

    void fetch(browser.runtime.getURL('/json/mimetic-words.json'))
      .then((response) => response.json() as Promise<Record<string, MimeticWordEntry>>)
      .then((payload) => {
        if (cancelled) return;
        const items = Object.entries(payload)
          .map(([word, entry]) => ({
            ...entry,
            word,
            row: getKanaRowFilter(entry.reading || word),
          }))
          .sort((a, b) => normalizeKanaForSearch(a.reading || a.word).localeCompare(normalizeKanaForSearch(b.reading || b.word), 'ja'));
        setMimeticWords(items);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadError('拟声拟态词典加载失败。');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filteredWords = useMemo(() => {
    const normalizedQuery = normalizeKanaForSearch(query.trim());

    return mimeticWords.filter((item) => {
      if (activeRow !== 'all' && item.row !== activeRow) return false;
      if (onlyUnmastered && masteredWords.has(item.word)) return false;
      if (!normalizedQuery) return true;

      const searchableText = normalizeKanaForSearch([
        item.word,
        item.reading,
        item.meaning,
        item.example,
        ...(item.tags ?? []),
      ].filter(Boolean).join(' '));

      return searchableText.includes(normalizedQuery);
    });
  }, [activeRow, masteredWords, mimeticWords, onlyUnmastered, query]);

  const renderedWords = useMemo(
    () => filteredWords.slice(0, renderedCount),
    [filteredWords, renderedCount],
  );

  useEffect(() => {
    setRenderedCount(MIMETIC_RENDER_BATCH_SIZE);
  }, [activeRow, onlyUnmastered, query, filteredWords.length]);

  useEffect(() => {
    if (renderedCount >= filteredWords.length) return;

    const loadTimer = window.setTimeout(() => {
      setRenderedCount((current) => Math.min(current + MIMETIC_RENDER_BATCH_SIZE, filteredWords.length));
    }, 40);

    return () => window.clearTimeout(loadTimer);
  }, [filteredWords.length, renderedCount]);

  const masteredCount = mimeticWords.filter((item) => masteredWords.has(item.word)).length;
  const progressPercent = mimeticWords.length ? Math.round((masteredCount / mimeticWords.length) * 100) : 0;

  const handleMasteredChange = useCallback((word: string, isMastered: boolean) => {
    setMasteredWords((current) => {
      const next = new Set(current);
      if (isMastered) {
        next.add(word);
      } else {
        next.delete(word);
      }
      persistMimeticWords(next);
      return next;
    });
  }, []);

  return (
    <section className="workspace-panel workspace-panel--mimetic">
      <div className="workspace-panel__header">
        <div>
          <p className="workspace-kicker">入门学习</p>
          <h2>擬態語</h2>
          <p className="workspace-meta">擬態語在日语里比较特殊，经常靠声音和感觉传达状态，也因此比普通单词更难记。</p>
        </div>
        <label className="grammar-mastered-filter">
          <input
            checked={onlyUnmastered}
            onChange={(event) => setOnlyUnmastered(event.target.checked)}
            type="checkbox"
          />
          <span>只看未掌握的词</span>
        </label>
      </div>

      <div className="mimetic-toolbar">
        <label className="mimetic-search">
          <span>搜索</span>
          <input
            placeholder="すべすべ / 光滑 / 触感"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="grammar-progress" aria-label={`擬態語掌握度 ${progressPercent}%`}>
          <div className="grammar-progress__meta">
            <span>掌握度</span>
            <strong>{masteredCount}/{mimeticWords.length}</strong>
          </div>
          <div className="grammar-progress__track" title={`${progressPercent}% 已掌握`}>
            <span className="grammar-progress__fill" style={{ width: `${progressPercent}%` }} />
          </div>
        </div>
      </div>

      <div className="mimetic-row-filter" role="tablist" aria-label="按假名行筛选">
        {KANA_ROW_FILTERS.map((filter) => (
          <button
            aria-selected={activeRow === filter.key}
            className={`grammar-tab ${activeRow === filter.key ? 'is-active' : ''}`}
            key={filter.key}
            onClick={() => setActiveRow(filter.key)}
            role="tab"
            type="button"
          >
            {filter.label}
          </button>
        ))}
      </div>

      {loadError ? <div className="workspace-empty workspace-empty--compact">{loadError}</div> : null}

      <div className="mimetic-list" key={`${activeRow}-${onlyUnmastered ? 'unmastered' : 'all'}-${query}`}>
        {renderedWords.map((item) => (
          <MimeticWordCard
            isMastered={masteredWords.has(item.word)}
            item={item}
            key={item.word}
            onMasteredChange={handleMasteredChange}
          />
        ))}
      </div>

      {!loadError && !filteredWords.length ? (
        <div className="workspace-empty workspace-empty--compact">没有匹配的擬態語。</div>
      ) : null}
    </section>
  );
}

const MimeticWordCard = memo(function MimeticWordCard({
  isMastered,
  item,
  onMasteredChange,
}: {
  isMastered: boolean;
  item: MimeticWordItem;
  onMasteredChange: (word: string, isMastered: boolean) => void;
}) {
  return (
    <article className={`mimetic-card ${isMastered ? 'is-mastered' : ''}`}>
      <label className="grammar-card__mastered">
        <input
          checked={isMastered}
          onChange={(event) => onMasteredChange(item.word, event.target.checked)}
          type="checkbox"
        />
        <span>{isMastered ? '已掌握' : '未掌握'}</span>
      </label>
      <div className="mimetic-card__main">
        <p className="grammar-card__pattern">{KANA_ROW_FILTERS.find((filter) => filter.key === item.row)?.label ?? '其他'}</p>
        <h3>{item.word}</h3>
        {item.reading && item.reading !== item.word ? <p className="mimetic-card__reading">{item.reading}</p> : null}
        <p className="mimetic-card__meaning">{item.meaning}</p>
      </div>
      {item.tags?.length ? (
        <div className="mimetic-card__tags">
          {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      ) : null}
      {item.example ? <p className="mimetic-card__example">{item.example}</p> : null}
    </article>
  );
});

function KanaLearningPanel({
  activeMode,
  selectedKana,
  onChangeMode,
  onSelectKana,
}: {
  activeMode: KanaMode;
  selectedKana: string;
  onChangeMode: (mode: KanaMode) => void;
  onSelectKana: (kana: string) => void;
}) {
  const rows = KANA_TABLES[activeMode];
  const selectedRomaji = rows
    .flatMap((row) => row.kana.map((kana, index) => ({ kana, romaji: row.romaji[index] })))
    .find((item) => item.kana === selectedKana)?.romaji;

  return (
    <section className="workspace-panel workspace-panel--kana">
      <div className="workspace-panel__header">
        <div>
          <p className="workspace-kicker">入门学习</p>
          <h2>五十音图</h2>
          <p className="workspace-meta">点假名听发音，切换表格类型后可以直接在右侧 panel 里练字。</p>
        </div>
      </div>

      <div className="kana-mode-switcher" role="tablist" aria-label="五十音类型">
        {(['hiragana', 'katakana', 'dakuten'] as KanaMode[]).map((mode) => (
          <button
            aria-selected={activeMode === mode}
            className={`kana-mode-switcher__tab ${activeMode === mode ? 'is-active' : ''}`}
            key={mode}
            onClick={() => onChangeMode(mode)}
            role="tab"
            type="button"
          >
            {KANA_MODE_LABELS[mode]}
          </button>
        ))}
      </div>

      <div className="kana-learning-layout">
        <div className="kana-table-wrap">
          <div className="kana-table kana-table--header">
            <span />
            {KANA_COLUMN_LABELS.map((label) => <span key={label}>{label}</span>)}
          </div>
          {rows.map((row) => (
            <div className="kana-table" key={row.label}>
              <span className="kana-table__row-label">{row.label}</span>
              {row.kana.map((kana, index) => kana ? (
                <button
                  aria-label={`播放 ${kana}`}
                  className={`kana-cell ${selectedKana === kana ? 'is-active' : ''}`}
                  key={`${row.label}-${kana}`}
                  onClick={() => onSelectKana(kana)}
                  type="button"
                >
                  <strong>{kana}</strong>
                  <span>{row.romaji[index]}</span>
                  <Volume2 size={16} strokeWidth={1.8} />
                </button>
              ) : (
                <span aria-hidden="true" className="kana-cell kana-cell--empty" key={`${row.label}-empty-${index}`} />
              ))}
            </div>
          ))}
        </div>

        <aside className="kana-practice-panel">
          <div className="kana-practice-panel__header">
            <span>当前练习</span>
            <button className="favorite-card__action" onClick={() => playAudio(selectedKana)} type="button">
              <Volume2 size={18} strokeWidth={1.8} />
              <span>播放</span>
            </button>
          </div>
          <p className="kana-practice-panel__glyph">{selectedKana}</p>
          <p className="kana-practice-panel__romaji">{selectedRomaji}</p>
          <WritingPracticeCanvas className="kana-writing-panel" targetText={selectedKana} />
        </aside>
      </div>
    </section>
  );
}

async function loadCommunityStrategy(
  setCommunityStrategy: React.Dispatch<React.SetStateAction<CommunityStrategy | null>>,
  setCommunityState: React.Dispatch<React.SetStateAction<CommunityState>>,
  setCommunityError: React.Dispatch<React.SetStateAction<string>>,
) {
  setCommunityState('loading');
  setCommunityError('');

  try {
    const response = await fetch(COMMUNITY_STRATEGY_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`社群入口读取失败：HTTP ${response.status}`);
    }

    const payload = await response.json() as CommunityStrategy;
    const url = normalizeHttpUrl(payload.url);
    if (!url) {
      throw new Error('远端配置里暂时没有可用的社群链接。');
    }

    setCommunityStrategy({ ...payload, url });
    setCommunityState('ready');
  } catch (error) {
    setCommunityStrategy(null);
    setCommunityError(error instanceof Error ? error.message : '社群入口读取失败。');
    setCommunityState('error');
  }
}

function normalizeHttpUrl(value: unknown) {
  if (typeof value !== 'string') return '';

  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function BlockPreview({ block, printable = false }: { block: ExportDraftBlock; printable?: boolean }) {
  const html = block.tokens.length ? tokensToHtml(block.tokens) : block.text;
  const className = [
    'block-preview',
    `block-preview--${block.kind}`,
    printable ? 'is-printable' : '',
    block.included ? '' : 'is-muted',
  ].filter(Boolean).join(' ');

  return <section className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

async function hydrateDraftRuby(
  draft: ExportWorkspaceDraft,
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  try {
    const nextBlocks = await Promise.all(
      draft.blocks.map(async (block) => {
        if (block.tokens.length || !block.text.trim()) return block;
        const html = await furiganaService.convert(block.text);
        return {
          ...block,
          tokens: extractTokensFromRubyHtml(html),
          lastGeneratedText: block.text,
        };
      }),
    );

    setDraft((current) => current ? { ...current, blocks: nextBlocks } : current);
  } catch (error) {
    setError(error instanceof Error ? error.message : '生成注音失败');
  }
}

async function regenerateBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  draft: ExportWorkspaceDraft,
  blockId: string,
) {
  const current = draft.blocks.find((item) => item.id === blockId);
  if (!current) return;

  const html = await furiganaService.convert(current.text);
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.map((block) => block.id === blockId ? {
        ...block,
        tokens: extractTokensFromRubyHtml(html),
        lastGeneratedText: block.text,
      } : block),
    };
  });
}

function updateDraftBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  blockId: string,
  patch: Partial<ExportDraftBlock>,
) {
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    };
  });
}

function updateDraftToken(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  blockId: string,
  tokenId: string,
  reading: string,
) {
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.map((block) => block.id === blockId ? {
        ...block,
        tokens: block.tokens.map((token) => token.id === tokenId ? { ...token, reading } : token),
      } : block),
    };
  });
}

function moveDraftBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  index: number,
  direction: -1 | 1,
) {
  setDraft((state) => {
    if (!state) return state;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= state.blocks.length) return state;

    const blocks = [...state.blocks];
    const [item] = blocks.splice(index, 1);
    blocks.splice(targetIndex, 0, item);
    return { ...state, blocks };
  });
}

function removeDraftBlock(
  setDraft: React.Dispatch<React.SetStateAction<ExportWorkspaceDraft | null>>,
  blockId: string,
) {
  setDraft((state) => {
    if (!state) return state;
    return {
      ...state,
      blocks: state.blocks.filter((block) => block.id !== blockId),
    };
  });
}

function normalizeDraftMap(value: unknown): Record<string, ExportWorkspaceDraft> {
  return value && typeof value === 'object' ? value as Record<string, ExportWorkspaceDraft> : {};
}

function normalizeHistory(value: unknown): ExportHistoryItem[] {
  return Array.isArray(value) ? value as ExportHistoryItem[] : [];
}

function upsertHistory(history: ExportHistoryItem[], draft: ExportWorkspaceDraft) {
  const next = [createHistoryItem(draft), ...history.filter((item) => item.id !== draft.id)];
  return next.slice(0, 12);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

function FavoriteInboxCard({
  item,
  extensionSettings,
  isRemoving,
  onComplete,
  onJumpToSource,
  onQuickSpeak,
  onToggleFurigana,
  rubyHtml,
  showFurigana,
}: {
  item: FavoriteItem;
  extensionSettings: ExtensionSettings;
  isRemoving: boolean;
  onComplete: () => void;
  onJumpToSource: () => void;
  onQuickSpeak: () => void;
  onToggleFurigana: () => void;
  rubyHtml: string;
  showFurigana: boolean;
}) {
  const ageState = getFavoriteAgeState(item.timestamp);
  const translatedUrl = buildTranslatorUrl(item.text, extensionSettings.translatorEngine);

  return (
    <article
      className={`favorite-card favorite-card--${ageState.level} ${isRemoving ? 'is-removing' : ''}`}
      onClick={onQuickSpeak}
    >
      <div className="favorite-card__top">
        <label className="favorite-card__complete" onClick={(event) => event.stopPropagation()}>
          <input aria-label="掌握并删除" onChange={onComplete} type="checkbox" />
          <span className="favorite-card__complete-mark">
            <CheckCircle2 size={18} strokeWidth={1.8} />
          </span>
        </label>

        <div className="favorite-card__meta">
          <span className="favorite-card__age">{ageState.label}</span>
          <span className="favorite-card__time">{formatRelativeAge(item.timestamp)}</span>
        </div>
      </div>

      <div className="favorite-card__body">
        <p className="favorite-card__word">{item.text}</p>
        {showFurigana ? (
          <div className="favorite-card__ruby" dangerouslySetInnerHTML={{ __html: rubyHtml || item.text }} />
        ) : null}
        {item.context ? <p className="favorite-card__context">{item.context}</p> : null}
      </div>

      <div className="favorite-card__actions" onClick={(event) => event.stopPropagation()}>
        <button className="favorite-card__action" onClick={onQuickSpeak} type="button">
          <Volume2 size={18} strokeWidth={1.8} />
          <span>朗读</span>
        </button>
        <button className="favorite-card__action" onClick={onToggleFurigana} type="button">
          <BookMarked size={18} strokeWidth={1.8} />
          <span>{showFurigana ? '隐藏注音' : '注音'}</span>
        </button>
        <button className="favorite-card__action" onClick={() => window.open(translatedUrl, '_blank', 'noopener,noreferrer')} type="button">
          <Languages size={18} strokeWidth={1.8} />
          <span>翻译跳转</span>
        </button>
        <button className="favorite-card__action" onClick={onJumpToSource} type="button">
          <ExternalLink size={18} strokeWidth={1.8} />
          <span>来源追溯</span>
        </button>
      </div>
    </article>
  );
}

async function completeFavorite(
  favoriteId: string,
  setFavorites: React.Dispatch<React.SetStateAction<FavoriteItem[]>>,
  setRemovingFavoriteIds: React.Dispatch<React.SetStateAction<string[]>>,
) {
  setRemovingFavoriteIds((current) => current.includes(favoriteId) ? current : [...current, favoriteId]);

  window.setTimeout(async () => {
    const storage = await browser.storage.local.get([FAVORITES_STORAGE_KEY]);
    const nextFavorites = normalizeFavoriteItems(storage[FAVORITES_STORAGE_KEY]).filter((item) => item.id !== favoriteId);
    await browser.storage.local.set({ [FAVORITES_STORAGE_KEY]: nextFavorites });
    setFavorites(nextFavorites);
    setRemovingFavoriteIds((current) => current.filter((item) => item !== favoriteId));
  }, 240);
}

async function toggleFavoriteFurigana(
  item: FavoriteItem,
  expandedFurigana: Record<string, boolean>,
  setExpandedFurigana: React.Dispatch<React.SetStateAction<Record<string, boolean>>>,
  favoriteRubyMap: Record<string, string>,
  setFavoriteRubyMap: React.Dispatch<React.SetStateAction<Record<string, string>>>,
) {
  const nextExpanded = !expandedFurigana[item.id];
  setExpandedFurigana((current) => ({ ...current, [item.id]: nextExpanded }));

  if (!nextExpanded || favoriteRubyMap[item.id]) return;

  const html = item.furigana || await furiganaService.convert(item.text);
  setFavoriteRubyMap((current) => ({ ...current, [item.id]: html }));
}

function playAudio(text: string) {
  const chromeLike = globalThis as typeof globalThis & {
    chrome?: {
      tts?: {
        stop?: () => void;
        speak?: (text: string, options?: Record<string, unknown>) => void;
      };
    };
  };

  const tts = chromeLike.chrome?.tts;
  if (tts?.speak) {
    tts.stop?.();
    tts.speak(text, { lang: 'ja-JP', rate: 0.9, volume: 1 });
    return;
  }

  if (window.speechSynthesis) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'ja-JP';
    utterance.rate = 0.9;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  }
}

async function openSourceUrl(sourceUrl: string) {
  if (!sourceUrl) return;
  await browser.tabs.create({ url: sourceUrl });
}

function buildTranslatorUrl(text: string, engine: TranslatorEngine) {
  const builder = TRANSLATOR_URL_BUILDERS[engine] ?? TRANSLATOR_URL_BUILDERS.google;
  return builder(text);
}

function getFavoriteAgeState(timestamp: number) {
  const hours = (Date.now() - timestamp) / (1000 * 60 * 60);
  if (hours >= 72) return { level: 'critical', label: '铁锈警报' } as const;
  if (hours >= 24) return { level: 'warning', label: '已堆积' } as const;
  return { level: 'fresh', label: '新鲜输入' } as const;
}

function formatRelativeAge(timestamp: number) {
  const diffMs = Date.now() - timestamp;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  if (hours < 1) {
    const minutes = Math.max(1, Math.floor(diffMs / (1000 * 60)) || 1);
    return `${minutes} 分钟前`;
  }
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function extractReadingText(rubyHtml: string) {
  return Array.from(rubyHtml.matchAll(/<rt>(.*?)<\/rt>/g))
    .map((match) => match[1] ?? '')
    .join('');
}

function normalizeKanaReading(value: string) {
  return value.replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

function splitKanaBlocks(value: string) {
  const chars = Array.from(value);
  const blocks: string[] = [];

  for (let index = 0; index < chars.length; index += 1) {
    const current = chars[index];
    const next = chars[index + 1];
    if (next && /[ゃゅょぁぃぅぇぉ]/.test(next)) {
      blocks.push(`${current}${next}`);
      index += 1;
      continue;
    }

    blocks.push(current);
  }

  return blocks;
}

function buildReviewChoices(targetBlocks: string[]) {
  const distractorCount = Math.max(1, Math.round(targetBlocks.length / 3));
  const distractors = shuffleArray(
    KANA_DISTRACTOR_POOL.filter((item) => !targetBlocks.includes(item)),
  ).slice(0, distractorCount);

  return shuffleArray([
    ...targetBlocks.map((text, index) => ({
      id: `target-${index}-${text}`,
      text,
      isDistractor: false,
    })),
    ...distractors.map((text, index) => ({
      id: `distractor-${index}-${text}`,
      text,
      isDistractor: true,
    })),
  ]);
}

function shuffleArray<T>(value: T[]) {
  const next = [...value];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function drawPracticeCanvas(context: CanvasRenderingContext2D, size: number, text: string) {
  context.clearRect(0, 0, size, size);
  context.fillStyle = '#fffdfa';
  context.fillRect(0, 0, size, size);

  context.strokeStyle = 'rgba(157, 69, 38, 0.18)';
  context.lineWidth = 1;

  context.strokeRect(12, 12, size - 24, size - 24);
  context.beginPath();
  context.moveTo(size / 2, 12);
  context.lineTo(size / 2, size - 12);
  context.moveTo(12, size / 2);
  context.lineTo(size - 12, size / 2);
  context.moveTo(12, 12);
  context.lineTo(size - 12, size - 12);
  context.moveTo(size - 12, 12);
  context.lineTo(12, size - 12);
  context.stroke();

  const glyphs = Array.from(text).filter((char) => /[\u3040-\u30ff\u4e00-\u9fff]/i.test(char)).slice(0, 4);
  context.fillStyle = 'rgba(182, 91, 58, 0.12)';
  context.textAlign = 'center';
  context.textBaseline = 'middle';

  if (glyphs.length === 1) {
    context.font = `${Math.round(size * 0.7)}px "Hiragino Mincho ProN", "Yu Mincho", serif`;
    context.fillText(glyphs[0]!, size / 2, size / 2);
    return;
  }

  context.font = '128px "Hiragino Mincho ProN", "Yu Mincho", serif';

  glyphs.forEach((glyph, index) => {
    const x = index % 2 === 0 ? size * 0.3 : size * 0.7;
    const y = index < 2 ? size * 0.3 : size * 0.7;
    context.fillText(glyph, x, y);
  });
}

function getCanvasPoint(event: React.PointerEvent<HTMLCanvasElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

export default App;

function WritingPracticeCanvas({
  className = '',
  onReset,
  targetText,
}: {
  className?: string;
  onReset?: () => void;
  targetText: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const strokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const activeStrokeRef = useRef<Array<{ x: number; y: number }> | null>(null);
  const CANVAS_SIZE = 320;

  const redrawCanvas = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    drawPracticeCanvas(context, CANVAS_SIZE, targetText);
    strokesRef.current.forEach((stroke) => {
      if (stroke.length < 2) return;
      context.strokeStyle = '#8e3d22';
      context.lineWidth = 5;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.beginPath();
      context.moveTo(stroke[0]!.x, stroke[0]!.y);
      for (let index = 1; index < stroke.length; index += 1) {
        const point = stroke[index]!;
        context.lineTo(point.x, point.y);
      }
      context.stroke();
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = window.devicePixelRatio || 1;
    const size = 320;
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;

    const context = canvas.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    strokesRef.current = [];
    activeStrokeRef.current = null;
    drawPracticeCanvas(context, size, targetText);
  }, [targetText]);

  const drawStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !drawingRef.current) return;

    const rect = canvas.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    if (!lastPointRef.current) {
      lastPointRef.current = point;
      activeStrokeRef.current = [point];
      return;
    }

    activeStrokeRef.current?.push(point);

    context.strokeStyle = '#8e3d22';
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    context.lineTo(point.x, point.y);
    context.stroke();
    lastPointRef.current = point;
  };

  const clearCanvas = () => {
    strokesRef.current = [];
    activeStrokeRef.current = null;
    redrawCanvas();
  };

  const undoLastStroke = () => {
    strokesRef.current = strokesRef.current.slice(0, -1);
    activeStrokeRef.current = null;
    redrawCanvas();
  };

  const resetAll = () => {
    clearCanvas();
    onReset?.();
  };

  return (
    <div className={`favorite-review-practice ${className}`}>
      <canvas
        className="favorite-review-practice__canvas"
        onPointerDown={(event) => {
          drawingRef.current = true;
          const startPoint = getCanvasPoint(event);
          lastPointRef.current = startPoint;
          activeStrokeRef.current = [startPoint];
        }}
        onPointerLeave={() => {
          drawingRef.current = false;
          lastPointRef.current = null;
          if (activeStrokeRef.current?.length) {
            strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
          }
          activeStrokeRef.current = null;
        }}
        onPointerMove={drawStroke}
        onPointerUp={() => {
          drawingRef.current = false;
          lastPointRef.current = null;
          if (activeStrokeRef.current?.length) {
            strokesRef.current = [...strokesRef.current, activeStrokeRef.current];
          }
          activeStrokeRef.current = null;
        }}
        ref={canvasRef}
      />
      <div className="favorite-review-practice__actions">
        <button className="favorite-card__action" onClick={clearCanvas} type="button">
          <Eraser size={18} strokeWidth={1.8} />
          <span>清除</span>
        </button>
        <button className="favorite-card__action" onClick={undoLastStroke} type="button">
          <PencilLine size={18} strokeWidth={1.8} />
          <span>撤销一笔</span>
        </button>
        <button className="favorite-card__action" onClick={resetAll} type="button">
          <X size={18} strokeWidth={1.8} />
          <span>重置</span>
        </button>
      </div>
    </div>
  );
}

function FavoriteReviewDialog({
  availableChoices,
  item,
  onClose,
  onPickChoice,
  onRemoveChoice,
  onReset,
  reviewError,
  reviewReading,
  rubyHtml,
  selectedChoices,
}: {
  availableChoices: ReviewChoice[];
  item: FavoriteItem;
  onClose: () => void;
  onPickChoice: (choice: ReviewChoice) => void;
  onRemoveChoice: (choiceId: string) => void;
  onReset: () => void;
  reviewError: string;
  reviewReading: string;
  rubyHtml: string;
  selectedChoices: ReviewChoice[];
}) {
  return (
    <div className="favorite-review-backdrop" onClick={onClose} role="presentation">
      <dialog aria-modal="true" className="favorite-review-dialog" onClick={(event) => event.stopPropagation()} open>
        <div className="favorite-review-dialog__header">
          <div>
            <p className="workspace-kicker">掌握确认</p>
            <h2>写一写，再把读音拼对</h2>
          </div>
          <button className="favorite-review-dialog__close" onClick={onClose} type="button">
            <X size={18} strokeWidth={1.8} />
          </button>
        </div>

        <div className="favorite-review-dialog__body">
          <div className="favorite-review-dialog__meta">
            <p className="favorite-review-dialog__word">{item.text}</p>
            <div className="favorite-review-dialog__ruby" dangerouslySetInnerHTML={{ __html: rubyHtml || item.text }} />
          </div>

          <WritingPracticeCanvas onReset={onReset} targetText={item.text} />

          <div className="favorite-review-keyboard">
            <div className="favorite-review-keyboard__status">
              <p>从下面的音块里选出正确发音，外来语也会转成平假名来练习。</p>
              <div className={`favorite-review-keyboard__input ${reviewError ? 'has-error' : ''}`}>
                <div className="favorite-review-keyboard__selected">
                  {selectedChoices.length ? selectedChoices.map((choice) => (
                    <button
                      className="favorite-review-keyboard__chip favorite-review-keyboard__chip--selected"
                      key={choice.id}
                      onClick={() => onRemoveChoice(choice.id)}
                      type="button"
                    >
                      <span>{choice.text}</span>
                      <X size={12} strokeWidth={2} />
                    </button>
                  )) : <span className="favorite-review-keyboard__placeholder">点下面的方块来组成发音</span>}
                </div>
                <small>{reviewReading || 'loading'}</small>
              </div>
              {reviewError ? <p className="favorite-review-keyboard__error">{reviewError}</p> : null}
            </div>

            <div className="favorite-review-keyboard__grid">
              {availableChoices.map((choice) => (
                <button
                  className={`favorite-review-keyboard__key ${choice.isDistractor ? 'is-distractor' : ''}`}
                  key={choice.id}
                  onClick={() => onPickChoice(choice)}
                  type="button"
                >
                  {choice.text}
                </button>
              ))}
            </div>
          </div>
        </div>
      </dialog>
    </div>
  );
}
