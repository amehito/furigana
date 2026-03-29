export interface TooltipSettings {
  position: 'top' | 'bottom' | 'left' | 'right';
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  borderRadius: number;
  padding: number;
  bgOpacity: number;
  rubySize: number;
  rubyColor: string;
  rubyWeight: number;
}

export const DEFAULT_SETTINGS: TooltipSettings = {
  position: 'top',
  fontSize: 14,
  textColor: '#2c3e50',
  backgroundColor: '#ffffff',
  borderRadius: 10,
  padding: 14,
  bgOpacity: 96,
  rubySize: 0.6,
  rubyColor: '#5b6c7d',
  rubyWeight: 400,
};

export type TranslatorEngine = 'google' | 'deepl' | 'bing' | 'papago';
export type SiteAccessMode = 'blacklist' | 'whitelist';
export type FuriganaMode = 'smart' | 'all' | 'disable';

export interface ExtensionSettings {
  globalEnabled: boolean;
  furiganaMode: FuriganaMode;
  translatorEngine: TranslatorEngine;
  ttsVolume: number;
  ttsRate: number;
  autoPlayAudio: boolean;
  siteAccessMode: SiteAccessMode;
  blacklist: string[];
  whitelist: string[];
  pausedHosts: string[];
}

export const DEFAULT_EXTENSION_SETTINGS: ExtensionSettings = {
  globalEnabled: true,
  furiganaMode: 'smart',
  translatorEngine: 'google',
  ttsVolume: 1,
  ttsRate: 0.9,
  autoPlayAudio: false,
  siteAccessMode: 'blacklist',
  blacklist: [],
  whitelist: [],
  pausedHosts: [],
};
