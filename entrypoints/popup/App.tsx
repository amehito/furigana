import { useEffect, useMemo, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  DEFAULT_EXTENSION_SETTINGS,
  DEFAULT_SETTINGS,
  type ExtensionSettings,
  type SiteAccessMode,
  type TooltipSettings,
  type TranslatorEngine,
} from '../../types/settings';
import './App.css';

const TRANSLATOR_OPTIONS: Array<{ label: string; value: TranslatorEngine }> = [
  { label: 'Google 翻译', value: 'google' },
  { label: 'DeepL', value: 'deepl' },
  { label: 'Bing 翻译', value: 'bing' },
  { label: 'Papago', value: 'papago' },
];

function App() {
  const [settings, setSettings] = useState<TooltipSettings>(DEFAULT_SETTINGS);
  const [extensionSettings, setExtensionSettings] = useState<ExtensionSettings>(DEFAULT_EXTENSION_SETTINGS);
  const [currentHost, setCurrentHost] = useState('');
  const [blacklistInput, setBlacklistInput] = useState('');
  const [whitelistInput, setWhitelistInput] = useState('');

  useEffect(() => {
    const loadSettings = async () => {
      const result = await browser.storage.local.get(['tooltipSettings', 'extensionSettings']);

      if (result.tooltipSettings) {
        setSettings({ ...DEFAULT_SETTINGS, ...result.tooltipSettings });
      }

      const nextExtensionSettings = {
        ...DEFAULT_EXTENSION_SETTINGS,
        ...(result.extensionSettings ?? {}),
      };
      setExtensionSettings(nextExtensionSettings);
      setBlacklistInput(nextExtensionSettings.blacklist.join('\n'));
      setWhitelistInput(nextExtensionSettings.whitelist.join('\n'));
    };

    const loadCurrentHost = async () => {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      const url = tabs[0]?.url;

      try {
        setCurrentHost(url ? normalizeHost(new URL(url).hostname) : '');
      } catch {
        setCurrentHost('');
      }
    };

    void loadSettings();
    void loadCurrentHost();
  }, []);

  const updateTooltipSetting = async (key: keyof TooltipSettings, value: string | number) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    await browser.storage.local.set({ tooltipSettings: newSettings });
  };

  const updateExtensionSettings = async (patch: Partial<ExtensionSettings>) => {
    const nextSettings = { ...extensionSettings, ...patch };
    setExtensionSettings(nextSettings);
    await browser.storage.local.set({ extensionSettings: nextSettings });
  };

  const isPausedOnCurrentHost = useMemo(() => {
    if (!currentHost) return false;
    return extensionSettings.pausedHosts.includes(currentHost);
  }, [currentHost, extensionSettings.pausedHosts]);

  const handleHostListBlur = async (listType: 'blacklist' | 'whitelist', rawValue: string) => {
    const normalizedList = parseHostList(rawValue);
    if (listType === 'blacklist') {
      setBlacklistInput(normalizedList.join('\n'));
      await updateExtensionSettings({ blacklist: normalizedList });
      return;
    }

    setWhitelistInput(normalizedList.join('\n'));
    await updateExtensionSettings({ whitelist: normalizedList });
  };

  const togglePauseCurrentHost = async () => {
    if (!currentHost) return;

    const pausedHosts = extensionSettings.pausedHosts.includes(currentHost)
      ? extensionSettings.pausedHosts.filter((host) => host !== currentHost)
      : [...extensionSettings.pausedHosts, currentHost];

    await updateExtensionSettings({ pausedHosts });
  };

  return (
    <div className="popup-container">
      <h2>日语插件设置</h2>

      <section className="settings-section">
        <h3>翻译跳转</h3>
        <div className="setting-item">
          <label>默认翻译引擎</label>
          <select
            value={extensionSettings.translatorEngine}
            onChange={(e) => updateExtensionSettings({ translatorEngine: e.target.value as TranslatorEngine })}
          >
            {TRANSLATOR_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="settings-section">
        <h3>网页启用策略</h3>

        <div className="setting-item">
          <label>启用模式</label>
          <select
            value={extensionSettings.siteAccessMode}
            onChange={(e) => updateExtensionSettings({ siteAccessMode: e.target.value as SiteAccessMode })}
          >
            <option value="blacklist">默认启用，在黑名单网站中暂停</option>
            <option value="whitelist">默认停用，仅在白名单网站中启用</option>
          </select>
        </div>

        <div className="site-card">
          <div className="site-card-header">
            <strong>当前网页</strong>
            <span>{currentHost || '无法识别'}</span>
          </div>
          <button className="site-toggle-btn" disabled={!currentHost} onClick={togglePauseCurrentHost} type="button">
            {isPausedOnCurrentHost ? '恢复当前网页' : '暂停当前网页'}
          </button>
        </div>

        <div className="setting-item">
          <label>黑名单域名</label>
          <textarea
            placeholder={'每行一个域名，例如\nexample.com'}
            value={blacklistInput}
            onBlur={(e) => handleHostListBlur('blacklist', e.target.value)}
            onChange={(e) => setBlacklistInput(e.target.value)}
          />
        </div>

        <div className="setting-item">
          <label>白名单域名</label>
          <textarea
            placeholder={'每行一个域名，例如\nnews.example.jp'}
            value={whitelistInput}
            onBlur={(e) => handleHostListBlur('whitelist', e.target.value)}
            onChange={(e) => setWhitelistInput(e.target.value)}
          />
        </div>
      </section>

      <section className="settings-section">
        <h3>Tooltip 样式</h3>

        <div className="settings-grid">
          <section className="setting-item">
            <label>显示位置</label>
            <select
              value={settings.position}
              onChange={(e) => updateTooltipSetting('position', e.target.value as TooltipSettings['position'])}
            >
              <option value="top">上方</option>
              <option value="bottom">下方</option>
              <option value="left">左侧</option>
              <option value="right">右侧</option>
            </select>
          </section>

          <section className="setting-item">
            <label>字体大小 ({settings.fontSize}px)</label>
            <input
              type="range"
              min="10"
              max="24"
              value={settings.fontSize}
              onChange={(e) => updateTooltipSetting('fontSize', Number.parseInt(e.target.value, 10))}
            />
          </section>

          <section className="setting-item">
            <label>背景颜色</label>
            <div className="color-picker-wrapper">
              <input
                type="color"
                value={settings.backgroundColor}
                onChange={(e) => updateTooltipSetting('backgroundColor', e.target.value)}
              />
              <span>{settings.backgroundColor}</span>
            </div>
          </section>

          <section className="setting-item">
            <label>文字颜色</label>
            <div className="color-picker-wrapper">
              <input
                type="color"
                value={settings.textColor}
                onChange={(e) => updateTooltipSetting('textColor', e.target.value)}
              />
              <span>{settings.textColor}</span>
            </div>
          </section>
        </div>

        <section className="setting-item">
          <label>背景透明度 ({settings.bgOpacity}%)</label>
          <input
            type="range"
            min="10"
            max="100"
            value={settings.bgOpacity}
            onChange={(e) => updateTooltipSetting('bgOpacity', Number.parseInt(e.target.value, 10))}
          />
        </section>

        <section className="setting-item">
          <label>注音大小 ({settings.rubySize}em)</label>
          <input
            type="range"
            min="0.4"
            max="1.0"
            step="0.1"
            value={settings.rubySize}
            onChange={(e) => updateTooltipSetting('rubySize', Number.parseFloat(e.target.value))}
          />
        </section>

        <section className="setting-item">
          <label>注音颜色</label>
          <div className="color-picker-wrapper">
            <input
              type="color"
              value={settings.rubyColor}
              onChange={(e) => updateTooltipSetting('rubyColor', e.target.value)}
            />
            <span>{settings.rubyColor}</span>
          </div>
        </section>
      </section>

      <footer className="footer">
        <p>站点名单支持子域名匹配，例如 `docs.example.com` 也会匹配 `example.com`。</p>
      </footer>
    </div>
  );
}

function parseHostList(rawValue: string) {
  return Array.from(
    new Set(
      rawValue
        .split(/[\n,]/)
        .map((item) => normalizeHost(item))
        .filter(Boolean),
    ),
  );
}

function normalizeHost(host: string) {
  return host.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
}

export default App;
