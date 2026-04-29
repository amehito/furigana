import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, Link2, LoaderCircle } from 'lucide-react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type FuriganaMode,
  type SiteAccessMode,
  type TooltipSettings,
  type TranslatorEngine,
} from '../../types/settings';
import {
  EXPORT_DRAFTS_STORAGE_KEY,
  EXPORT_HISTORY_STORAGE_KEY,
  createHistoryItem,
  createWorkspaceDraft,
  type ExtractedPageBlock,
} from '../../util/export-workspace';
import './App.css';

const ICON_PROPS = { size: 16, strokeWidth: 1.5 };
const PATCH_NOTICE_STORAGE_KEY = 'furigana_patch_notice';

const TRANSLATOR_OPTIONS: Array<{ label: string; value: TranslatorEngine }> = [
  { label: 'Google 翻译', value: 'google' },
  { label: 'DeepL', value: 'deepl' },
  { label: 'Bing 翻译', value: 'bing' },
  { label: 'Papago', value: 'papago' },
];

const FURIGANA_MODE_OPTIONS: Array<{ label: string; value: FuriganaMode }> = [
  { label: '智能模式 (Smart)', value: 'smart' },
  { label: '全文显示 (All)', value: 'all' },
];

const TOOLTIP_PRESETS: Array<{ label: string; settings: Partial<TooltipSettings> }> = [
  {
    label: 'Minimal',
    settings: {
      backgroundColor: '#ffffff',
      textColor: '#2c3e50',
      fontSize: 14,
      borderRadius: 10,
      rubyColor: '#8a95a3',
      rubySize: 0.75,
      rubyWeight: 400,
    },
  },
  {
    label: 'Dark',
    settings: {
      backgroundColor: '#111827',
      textColor: '#f9fafb',
      fontSize: 14,
      borderRadius: 10,
      rubyColor: '#d1d5db',
      rubySize: 0.85,
      rubyWeight: 300,
    },
  },
  {
    label: 'Sepia',
    settings: {
      backgroundColor: '#FBF3E6',
      textColor: '#5b4636',
      fontSize: 15,
      borderRadius: 10,
      rubyColor: '#8b5e3c',
      rubySize: 0.9,
      rubyWeight: 500,
    },
  },
];

type SiteTab = 'blacklist' | 'whitelist';
type SaveState = 'idle' | 'saving' | 'saved';
type ExportState = 'idle' | 'loading';
type PanelLoadState = 'loading' | 'ready';

function App() {
  const [settings, setSettings] = useState<TooltipSettings>(DEFAULT_SETTINGS);
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettings>(DEFAULT_EXTENSION_SETTINGS);
  const [currentHost, setCurrentHost] = useState('');
  const [activeSiteTab, setActiveSiteTab] = useState<SiteTab>(DEFAULT_EXTENSION_SETTINGS.siteAccessMode);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [patchNotice, setPatchNotice] = useState('');
  const [settingsState, setSettingsState] = useState<PanelLoadState>('loading');
  const [siteState, setSiteState] = useState<PanelLoadState>('loading');
  const saveTimerRef = useRef<number | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('popup-react-mounted');

    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadSettings = async () => {
      try {
        const result = await browser.storage.local.get(['tooltipSettings', 'extensionSettings', PATCH_NOTICE_STORAGE_KEY]);
        if (cancelled) return;

        setSettings({ ...DEFAULT_SETTINGS, ...(result.tooltipSettings ?? {}) });
        setExtensionSettings({ ...DEFAULT_EXTENSION_SETTINGS, ...(result.extensionSettings ?? {}) });
        setPatchNotice(typeof result[PATCH_NOTICE_STORAGE_KEY] === 'string' ? result[PATCH_NOTICE_STORAGE_KEY] : '');
      } finally {
        if (!cancelled) {
          setSettingsState('ready');
        }
      }
    };

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActiveSiteTab(extensionSettings.siteAccessMode);
  }, [extensionSettings.siteAccessMode]);

  useEffect(() => {
    let cancelled = false;

    const loadCurrentHost = async () => {
      try {
        const tabs = await browser.tabs.query({ active: true, currentWindow: true });
        const url = tabs[0]?.url;

        if (cancelled) return;

        try {
          setCurrentHost(url ? normalizeHost(new URL(url).hostname) : '');
        } catch {
          setCurrentHost('');
        }
      } finally {
        if (!cancelled) {
          setSiteState('ready');
        }
      }
    };

    void loadCurrentHost();

    return () => {
      cancelled = true;
    };
  }, []);

  const flashSaved = () => {
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }

    setSaveState('saved');
    saveTimerRef.current = window.setTimeout(() => {
      setSaveState('idle');
    }, 1200);
  };

  const saveTooltipSettings = async (patch: Partial<TooltipSettings>) => {
    const nextSettings = { ...settings, ...patch };
    setSettings(nextSettings);
    setSaveState('saving');
    await browser.storage.local.set({ tooltipSettings: nextSettings });
    flashSaved();
  };

  const saveExtensionSettings = async (patch: Partial<ExtensionSettings>) => {
    const nextSettings = { ...extensionSettings, ...patch };
    setExtensionSettings(nextSettings);
    setSaveState('saving');
    await browser.storage.local.set({ extensionSettings: nextSettings });
    flashSaved();
  };

  const currentTagList = useMemo(
    () => activeSiteTab === 'blacklist' ? extensionSettings.blacklist : extensionSettings.whitelist,
    [activeSiteTab, extensionSettings.blacklist, extensionSettings.whitelist],
  );

  const currentSiteInActiveList = useMemo(
    () => currentHost ? currentTagList.includes(currentHost) : false,
    [currentHost, currentTagList],
  );

  const previewStyle = useMemo(() => ({
    backgroundColor: settings.backgroundColor,
    color: settings.textColor,
    borderRadius: `${settings.borderRadius}px`,
    boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
  }), [settings]);

  const previewRtStyle = useMemo(() => ({
    color: settings.rubyColor,
    fontSize: `${settings.rubySize}em`,
    fontWeight: settings.rubyWeight,
    opacity: 0.85,
  }), [settings]);

  const toggleGlobalEnabled = async () => {
    await saveExtensionSettings({ globalEnabled: !extensionSettings.globalEnabled });
  };

  const setSiteAccessMode = async (mode: SiteAccessMode) => {
    setActiveSiteTab(mode);
    await saveExtensionSettings({ siteAccessMode: mode });
  };

  const toggleCurrentSiteInActiveList = async () => {
    if (!currentHost) return;

    const nextList = currentSiteInActiveList
      ? currentTagList.filter((host) => host !== currentHost)
      : Array.from(new Set([...currentTagList, currentHost]));

    if (activeSiteTab === 'blacklist') {
      await saveExtensionSettings({ blacklist: nextList });
      return;
    }

    await saveExtensionSettings({ whitelist: nextList });
  };

  const openExportWorkspace = async () => {
    setExportState('loading');

    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];
      if (!activeTab?.id) {
        throw new Error('无法识别当前标签页。');
      }
      const response = await browser.tabs.sendMessage(activeTab.id, { type: 'extract-page-text' }) as {
        title: string;
        sourceUrl: string;
        blocks: ExtractedPageBlock[];
      } | undefined;
      const blocks = response?.blocks?.filter((block) => block.text.trim()) ?? [];
      if (!response || !blocks.length) {
        throw new Error('当前页面没有提取到可导出的日文正文。');
      }

      const draft = createWorkspaceDraft({
        title: response.title,
        sourceUrl: response.sourceUrl,
        blocks,
      });

      const storage = await browser.storage.local.get([EXPORT_DRAFTS_STORAGE_KEY, EXPORT_HISTORY_STORAGE_KEY]);
      const draftMap = storage[EXPORT_DRAFTS_STORAGE_KEY] && typeof storage[EXPORT_DRAFTS_STORAGE_KEY] === 'object'
        ? storage[EXPORT_DRAFTS_STORAGE_KEY] as Record<string, unknown>
        : {};
      const history = Array.isArray(storage[EXPORT_HISTORY_STORAGE_KEY]) ? storage[EXPORT_HISTORY_STORAGE_KEY] : [];

      await browser.storage.local.set({
        [EXPORT_DRAFTS_STORAGE_KEY]: {
          ...draftMap,
          [draft.id]: draft,
        },
        [EXPORT_HISTORY_STORAGE_KEY]: [createHistoryItem(draft), ...history.filter((item) => item?.id !== draft.id)].slice(0, 12),
      });

      const workspaceUrl = `${browser.runtime.getURL('/dashboard.html' as never)}?draft=${encodeURIComponent(draft.id)}`;
      await browser.tabs.create({
        url: workspaceUrl,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '打开导出工作台失败';
      window.alert(message);
    } finally {
      setExportState('idle');
    }
  };

  const openDashboardPage = async () => {
    const storage = await browser.storage.local.get([EXPORT_HISTORY_STORAGE_KEY]);
    const history = Array.isArray(storage[EXPORT_HISTORY_STORAGE_KEY]) ? storage[EXPORT_HISTORY_STORAGE_KEY] : [];
    const latestDraftId = typeof history[0]?.id === 'string' ? history[0].id : '';
    const workspaceUrl = latestDraftId
      ? `${browser.runtime.getURL('/dashboard.html' as never)}?draft=${encodeURIComponent(latestDraftId)}`
      : browser.runtime.getURL('/dashboard.html' as never);

    await browser.tabs.create({ url: workspaceUrl });
  };

  const openSitePolicyPage = async () => {
    const workspaceUrl = `${browser.runtime.getURL('/dashboard.html' as never)}?section=site-policies`;
    await browser.tabs.create({ url: workspaceUrl });
  };

  return (
    <div className="oye-control-center">
      <header className="oye-dashboard-header">
        <div className="oye-dashboard-header__title-wrap">
          <h1 className="oye-dashboard-header__title">瓯葉日语注音</h1>
        </div>
        <div className="oye-dashboard-header__toggle-wrap">
          <span className={`oye-dashboard-header__status ${extensionSettings.globalEnabled ? 'is-on' : 'is-off'}`}>
            {extensionSettings.globalEnabled ? '运行中' : '已暂停'}
          </span>
          <button
            aria-label={extensionSettings.globalEnabled ? '暂停插件' : '启用插件'}
            className={`oye-ios-switch ${extensionSettings.globalEnabled ? 'is-on' : ''}`}
            onClick={toggleGlobalEnabled}
            type="button"
          >
            <span className="oye-ios-switch__thumb" />
          </button>
        </div>
      </header>

      <main className="oye-dashboard-body">
        {patchNotice ? (
          <section className="oye-card oye-card--notice">
            <div className="oye-card__header">
              <div>
                <h2 className="oye-card__title">更新提醒</h2>
                <p className="oye-card__desc">{patchNotice}</p>
              </div>
            </div>
          </section>
        ) : null}

        <section className="oye-card">
          <div className="oye-card__header">
            <div>
              <h2 className="oye-card__title">注音设置</h2>
              <p className="oye-card__desc">模式、模板和细节样式都集中在这里。</p>
            </div>
          </div>
          {settingsState === 'loading' ? (
            <PanelSkeleton lines={6} />
          ) : (
            <>
              <div className="oye-field">
                <label className="oye-field__label">显示模式</label>
                <select
                  className="oye-select"
                  value={extensionSettings.furiganaMode}
                  onChange={(event) => saveExtensionSettings({ furiganaMode: event.target.value as FuriganaMode })}
                >
                  {FURIGANA_MODE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="oye-preset-row">
                {TOOLTIP_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    className="oye-theme-pill"
                    onClick={() => saveTooltipSettings(preset.settings)}
                    type="button"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>

              <div className="oye-preview" style={previewStyle}>
                <span className="oye-preview__text">
                  私は <ruby>日本語<rt style={previewRtStyle}>にほんご</rt></ruby> を勉強します。
                </span>
              </div>

              <button
                className={`oye-advanced-toggle ${advancedOpen ? 'is-open' : ''}`}
                onClick={() => setAdvancedOpen((current) => !current)}
                type="button"
              >
                <span>高级设置</span>
                <ChevronDown className="oye-icon" {...ICON_PROPS} />
              </button>

              <div className={`oye-advanced-panel ${advancedOpen ? 'is-open' : ''}`}>
                <div className="oye-advanced-panel__inner">
                  <div className="oye-field">
                    <label className="oye-field__label">显示位置</label>
                    <select
                      className="oye-select"
                      value={settings.position}
                      onChange={(event) => saveTooltipSettings({ position: event.target.value as TooltipSettings['position'] })}
                    >
                      <option value="top">上方</option>
                      <option value="bottom">下方</option>
                      <option value="left">左侧</option>
                      <option value="right">右侧</option>
                    </select>
                  </div>

                  <RangeField
                    label={`字体大小 (${settings.fontSize}px)`}
                    max={24}
                    min={10}
                    value={settings.fontSize}
                    onChange={(value) => saveTooltipSettings({ fontSize: value })}
                  />

                  <RangeField
                    label={`圆角 (${settings.borderRadius}px)`}
                    max={24}
                    min={8}
                    value={settings.borderRadius}
                    onChange={(value) => saveTooltipSettings({ borderRadius: value })}
                  />

                  <RangeField
                    label={`注音大小 (${settings.rubySize}em)`}
                    max={1}
                    min={0.7}
                    step={0.05}
                    value={settings.rubySize}
                    onChange={(value) => saveTooltipSettings({ rubySize: value })}
                  />

                  <RangeField
                    label={`注音粗细 (${settings.rubyWeight})`}
                    max={600}
                    min={300}
                    step={100}
                    value={settings.rubyWeight}
                    onChange={(value) => saveTooltipSettings({ rubyWeight: value })}
                  />

                  <RangeField
                    label={`音频音量 (${Math.round(extensionSettings.ttsVolume * 100)}%)`}
                    max={1}
                    min={0}
                    step={0.05}
                    value={extensionSettings.ttsVolume}
                    onChange={(value) => saveExtensionSettings({ ttsVolume: value })}
                  />

                  <RangeField
                    label={`朗读速度 (${extensionSettings.ttsRate.toFixed(2)}x)`}
                    max={1.5}
                    min={0.5}
                    step={0.05}
                    value={extensionSettings.ttsRate}
                    onChange={(value) => saveExtensionSettings({ ttsRate: value })}
                  />

                  <div className="oye-inline-toggle">
                    <div>
                      <label className="oye-field__label">自动播放朗读</label>
                      <p className="oye-inline-toggle__desc">划词后自动播放当前单词或句子的读音。</p>
                    </div>
                    <button
                      aria-label={extensionSettings.autoPlayAudio ? '关闭自动播放' : '开启自动播放'}
                      className={`oye-ios-switch ${extensionSettings.autoPlayAudio ? 'is-on' : ''}`}
                      onClick={() => saveExtensionSettings({ autoPlayAudio: !extensionSettings.autoPlayAudio })}
                      type="button"
                    >
                      <span className="oye-ios-switch__thumb" />
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="oye-card">
          <div className="oye-card__header">
            <div>
              <h2 className="oye-card__title">翻译跳转</h2>
              <p className="oye-card__desc">控制 Tooltip 中“翻译”按钮的默认打开方式。</p>
            </div>
          </div>

          <div className="oye-field">
            <label className="oye-field__label">默认翻译引擎</label>
            <select
              className="oye-select"
              value={extensionSettings.translatorEngine}
              onChange={(event) => saveExtensionSettings({ translatorEngine: event.target.value as TranslatorEngine })}
            >
              {TRANSLATOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="oye-card">
          <div className="oye-card__header">
            <div>
              <h2 className="oye-card__title">站点策略</h2>
              <p className="oye-card__desc">以标签方式管理黑白名单，并支持当前站快速切换。</p>
            </div>
          </div>
          {siteState === 'loading' ? (
            <PanelSkeleton lines={3} compact />
          ) : (
            <>
              <div className="oye-current-site">
                <div className="oye-current-site__meta">
                  <span className="oye-current-site__label">当前网页: {currentHost || '无法识别'}</span>
                </div>
                <button className="oye-current-site__action" disabled={!currentHost} onClick={toggleCurrentSiteInActiveList} type="button">
                  {activeSiteTab === 'blacklist'
                    ? (currentSiteInActiveList ? '恢复启用' : '在此网站禁用')
                    : (currentSiteInActiveList ? '移出白名单' : '加入白名单')}
                </button>
              </div>

              <div className="oye-tab-switcher">
                {(['blacklist', 'whitelist'] as SiteTab[]).map((tab) => (
                  <button
                    key={tab}
                    className={`oye-tab-switcher__tab ${activeSiteTab === tab ? 'is-active' : ''}`}
                    onClick={() => void setSiteAccessMode(tab)}
                    type="button"
                  >
                    {tab === 'blacklist' ? '黑名单' : '白名单'}
                  </button>
                ))}
              </div>
              <button className="oye-helper-link" onClick={() => void openSitePolicyPage()} type="button">
                <Link2 className="oye-icon" {...ICON_PROPS} />
                <span>查看更多，前往管理后台的“站点策略”</span>
              </button>
            </>
          )}
        </section>

        <section className="oye-card oye-card--export">
          <div className="oye-card__header">
            <div>
              <h2 className="oye-card__title">导出与管理</h2>
              <p className="oye-card__desc">从这里进入后台页，继续编辑打印内容、查看收藏记录，或发起当前页导出。</p>
            </div>
          </div>

          <div className="oye-export-actions">
            <button className="oye-secondary-action" onClick={() => void openDashboardPage()} type="button">
              <span>进入管理页面</span>
            </button>

            <button className="oye-primary-action" disabled={exportState === 'loading'} onClick={() => void openExportWorkspace()} type="button">
              {exportState === 'loading' ? <LoaderCircle className="oye-icon oye-spin" {...ICON_PROPS} /> : <Download className="oye-icon" {...ICON_PROPS} />}
              <span>{exportState === 'loading' ? '正在准备工作台...' : '导出当前页面'}</span>
            </button>
          </div>
        </section>
      </main>

      <div className={`oye-save-toast ${saveState !== 'idle' ? 'is-visible' : ''}`}>
        {saveState === 'saving' ? 'Saving...' : (
          <>
            <Check className="oye-icon" {...ICON_PROPS} />
            <span>已保存</span>
          </>
        )}
      </div>
    </div>
  );
}

function PanelSkeleton({ lines, compact = false }: { lines: number; compact?: boolean }) {
  return (
    <div className={`oye-panel-skeleton ${compact ? 'is-compact' : ''}`} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span
          className={`oye-panel-skeleton__line ${index === 0 ? 'is-wide' : index === lines - 1 ? 'is-short' : ''}`}
          key={index}
        />
      ))}
    </div>
  );
}

function RangeField({
  label,
  max,
  min,
  onChange,
  step = 1,
  value,
}: {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  value: number;
}) {
  return (
    <div className="oye-field">
      <label className="oye-field__label">{label}</label>
      <input
        className="oye-range"
        max={max}
        min={min}
        step={step}
        type="range"
        value={value}
        onChange={(event) => onChange(Number.parseFloat(event.target.value))}
      />
    </div>
  );
}
function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

export default App;
