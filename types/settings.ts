export interface TooltipSettings {
  position: 'top' | 'bottom' | 'left' | 'right';
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  padding: number;
  bgOpacity: number;
  rubySize: number;
  rubyColor: string;
}

export const DEFAULT_SETTINGS: TooltipSettings = {
  position: 'top',
  fontSize: 14,
  textColor: '#ffffff',
  backgroundColor: '#333333',
  padding: 8,
  bgOpacity: 90,
  rubySize: 0.6,
  rubyColor: '#ffeb3b',
};
