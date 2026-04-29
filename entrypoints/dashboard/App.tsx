import { useEffect, useMemo, useRef, useState } from 'react';
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
type MenuKey = 'print' | 'favorites' | 'beginner-kana' | 'beginner-grammar' | 'site-policies' | 'community';
type KanaMode = 'hiragana' | 'katakana' | 'dakuten';
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
  {
    title: 'です / ます：礼貌句的骨架',
    pattern: '名词 + です / 动词ます形',
    examples: ['学生です。', '日本語を勉強します。'],
    note: 'です用于说明“是什么/怎么样”，ます用于礼貌地表达动作。',
  },
  {
    title: 'は / が：主题和焦点',
    pattern: 'A は ... / A が ...',
    examples: ['私は学生です。', '雨が降っています。'],
    note: 'は把话题端出来，が更像把重点打在主语本身或新信息上。',
  },
  {
    title: 'を / に / で：动作的线索',
    pattern: '对象 を / 方向或时间 に / 场所或手段 で',
    examples: ['本を読みます。', '学校に行きます。', '駅で会います。'],
    note: '先抓住“动作作用到谁、去向哪里、在哪里发生”，句子会清楚很多。',
  },
  {
    title: '形容词：い形容词与な形容词',
    pattern: '高いです / 静かです / 静かな町',
    examples: ['この本は面白いです。', 'ここは静かです。'],
    note: 'い形容词直接接名词，な形容词修饰名词时要加な。',
  },
  {
    title: '否定和过去',
    pattern: 'ではありません / ません / ました / ませんでした',
    examples: ['学生ではありません。', '昨日、勉強しました。'],
    note: '先从礼貌形入手，比一开始硬背所有普通形变化更稳。',
  },
  {
    title: '疑问句：か',
    pattern: '句子 + か',
    examples: ['これは何ですか。', '明日行きますか。'],
    note: '日语疑问句常在句尾加か，语序通常不用像中文或英文那样大幅改动。',
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
              <button
                className={`workspace-nav__subitem ${activeMenu === 'beginner-kana' ? 'is-active' : ''}`}
                onClick={() => setActiveMenu('beginner-kana')}
                type="button"
              >
                <BookOpenText size={18} strokeWidth={1.8} />
                <span>五十音图</span>
              </button>
              <button
                className={`workspace-nav__subitem ${activeMenu === 'beginner-grammar' ? 'is-active' : ''}`}
                onClick={() => setActiveMenu('beginner-grammar')}
                type="button"
              >
                <PencilLine size={18} strokeWidth={1.8} />
                <span>基础语法</span>
              </button>
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
  if (SHOW_COMMUNITY_SECTION && section === 'community') {
    return 'community';
  }

  return 'print';
}

function getFirstKana(mode: KanaMode) {
  return KANA_TABLES[mode].flatMap((row) => row.kana).find((kana): kana is string => Boolean(kana)) ?? 'あ';
}

function BasicGrammarPanel() {
  return (
    <section className="workspace-panel workspace-panel--grammar">
      <div className="workspace-panel__header">
        <div>
          <p className="workspace-kicker">入门学习</p>
          <h2>基础语法</h2>
          <p className="workspace-meta">先建立能读懂简单句子的框架：判断句、助词、形容词、时态和疑问句。</p>
        </div>
      </div>

      <div className="grammar-grid">
        {BASIC_GRAMMAR_SECTIONS.map((section) => (
          <article className="grammar-card" key={section.title}>
            <div>
              <p className="grammar-card__pattern">{section.pattern}</p>
              <h3>{section.title}</h3>
            </div>
            <div className="grammar-card__examples">
              {section.examples.map((example) => <span key={example}>{example}</span>)}
            </div>
            <p>{section.note}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

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
