import {
  Bitcoin,
  BookOpen,
  Briefcase,
  CandlestickChart,
  Clapperboard,
  Code2,
  Cpu,
  FlaskConical,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  Home,
  Landmark,
  Layers,
  Music,
  Newspaper,
  Palette,
  Plane,
  Rocket,
  ShoppingCart,
  Sparkles,
  Terminal,
  User,
  type LucideIcon
} from 'lucide-react'

export const WORKSPACE_ICONS: Record<string, LucideIcon> = {
  user: User,
  code: Code2,
  cpu: Cpu,
  'book-open': BookOpen,
  'candlestick-chart': CandlestickChart,
  bitcoin: Bitcoin,
  landmark: Landmark,
  clapperboard: Clapperboard,
  layers: Layers,
  globe: Globe,
  briefcase: Briefcase,
  flask: FlaskConical,
  gamepad: Gamepad2,
  school: GraduationCap,
  heart: Heart,
  home: Home,
  music: Music,
  news: Newspaper,
  palette: Palette,
  plane: Plane,
  rocket: Rocket,
  cart: ShoppingCart,
  sparkles: Sparkles,
  terminal: Terminal
}

export function workspaceIcon(name: string): LucideIcon {
  return WORKSPACE_ICONS[name] ?? Layers
}

export const GROUP_COLOR_HEX: Record<string, string> = {
  grey: '#9aa0ab',
  blue: '#7ea6ff',
  cyan: '#5fd4e6',
  green: '#6fd49a',
  yellow: '#f1cf5e',
  orange: '#f5a25d',
  red: '#f47a7a',
  pink: '#f28bc8',
  purple: '#b69bff'
}

export const WORKSPACE_COLORS = ['#8b9cff', '#5eead4', '#c084fc', '#fbbf24', '#34d399', '#f59e0b', '#60a5fa', '#f472b6', '#f87171', '#a3e635', '#e2e8f0']
