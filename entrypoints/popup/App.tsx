import { useState, useEffect } from 'react';
import { browser } from 'wxt/browser'; // 改为使用 browser 对象
import './App.css';

// 定义设置接口
interface TooltipSettings {
  position: 'top' | 'bottom' | 'left' | 'right';
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  bgOpacity: number;    // 新增：背景透明度 (0-100)
  rubySize: number;     // 新增：注音大小 (em 或 px)
  rubyColor: string;    // 新增：注音颜色
}

const DEFAULT_SETTINGS: TooltipSettings = {
  position: 'top',
  fontSize: 14,
  textColor: '#ffffff',
  backgroundColor: '#333333',
  bgOpacity: 90,        // 默认 90% 不透明
  rubySize: 0.6,        // 默认 0.6em
  rubyColor: '#ffeb3b', // 默认黄色注音
};

function App() {
  const [settings, setSettings] = useState<TooltipSettings>(DEFAULT_SETTINGS);

  // 1. 初始化时从 Storage 读取配置
  useEffect(() => {
    const loadSettings = async () => {
      // browser.storage.local.get 返回的是一个 key-value 对象
      const result = await browser.storage.local.get('tooltipSettings');
      if (result.tooltipSettings) {
        setSettings(result.tooltipSettings);
      }
    };
    loadSettings();
  }, []);

  // 2. 通用的保存函数
  const updateSetting = async (key: keyof TooltipSettings, value: string | number) => {
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);
    // 使用原生的 set 语法：{ [key]: value }
    await browser.storage.local.set({ tooltipSettings: newSettings });
  };

  return (
    <div className="popup-container">
      <h2>Tooltip 样式设置</h2>

      <div className="settings-grid">
        {/* 位置设置 */}
        <section className="setting-item">
          <label>显示位置</label>
          <select 
            value={settings.position} 
            onChange={(e) => updateSetting('position', e.target.value as any)}
          >
            <option value="top">上方 (Top)</option>
            <option value="bottom">下方 (Bottom)</option>
            <option value="left">左侧 (Left)</option>
            <option value="right">右侧 (Right)</option>
          </select>
        </section>

        {/* 字体大小 */}
        <section className="setting-item">
          <label>字体大小 ({settings.fontSize}px)</label>
          <input 
            type="range" min="10" max="24" 
            value={settings.fontSize} 
            onChange={(e) => updateSetting('fontSize', parseInt(e.target.value))}
          />
        </section>

        {/* 背景颜色 */}
        <section className="setting-item">
          <label>背景颜色</label>
          <div className="color-picker-wrapper">
            <input 
              type="color" 
              value={settings.backgroundColor} 
              onChange={(e) => updateSetting('backgroundColor', e.target.value)}
            />
            <span>{settings.backgroundColor}</span>
          </div>
        </section>

        {/* 文字颜色 */}
        <section className="setting-item">
          <label>文字颜色</label>
          <div className="color-picker-wrapper">
            <input 
              type="color" 
              value={settings.textColor} 
              onChange={(e) => updateSetting('textColor', e.target.value)}
            />
            <span>{settings.textColor}</span>
          </div>
        </section>
      </div>
      {/* 背景透明度 */}
      <section className="setting-item">
        <label>背景透明度 ({settings.bgOpacity}%)</label>
        <input 
          type="range" min="10" max="100" 
          value={settings.bgOpacity} 
          onChange={(e) => updateSetting('bgOpacity', parseInt(e.target.value))}
        />
      </section>

      {/* 注音字体大小 */}
      <section className="setting-item">
        <label>注音大小 ({settings.rubySize}em)</label>
        <input 
          type="range" min="0.4" max="1.0" step="0.1"
          value={settings.rubySize} 
          onChange={(e) => updateSetting('rubySize', parseFloat(e.target.value))}
        />
      </section>

      {/* 注音颜色 */}
      <section className="setting-item">
        <label>注音颜色</label>
        <div className="color-picker-wrapper">
          <input 
            type="color" 
            value={settings.rubyColor} 
            onChange={(e) => updateSetting('rubyColor', e.target.value)}
          />
          <span>{settings.rubyColor}</span>
        </div>
      </section>

      <footer className="footer">
        <p>设置会自动实时保存并应用</p>
      </footer>
    </div>
  );
}

export default App;