export interface TooltipSettings {
  position: 'top' | 'bottom' | 'left' | 'right';
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  padding: number;
}

export const DEFAULT_SETTINGS: TooltipSettings = {
  position: 'top',
  fontSize: 14,
  textColor: '#ffffff',
  backgroundColor: '#333333',
  padding: 8,
};