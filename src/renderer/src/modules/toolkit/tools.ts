// Toolkit tool catalogue. Metadata only — every tool component is a separate
// lazily-loaded chunk, so nothing here costs anything until a tool is opened.
import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Binary,
  Braces,
  CalendarClock,
  Clock,
  Code2,
  Diff,
  Fingerprint,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Globe,
  Hash,
  Image as ImageIcon,
  KeyRound,
  Link2,
  ListTree,
  Palette,
  Regex,
  Type
} from 'lucide-react'

export interface ToolProps {
  tabId: string
  query: URLSearchParams
}

export type ToolGroup = 'Data' | 'Text' | 'Encoding & crypto' | 'Time' | 'Web' | 'Design'

export interface ToolDef {
  id: string
  title: string
  short: string
  description: string
  group: ToolGroup
  icon: LucideIcon
  keywords: string[]
  /** True when the tool can send data off the machine (only on explicit request). */
  network?: boolean
  load: () => Promise<{ default: ComponentType<ToolProps> }>
}

export const GROUPS: ToolGroup[] = ['Data', 'Text', 'Encoding & crypto', 'Time', 'Web', 'Design']

export const TOOLS: ToolDef[] = [
  { id: 'json', title: 'JSON formatter', short: 'JSON', description: 'Validate, format, minify, sort keys and explore JSON as a tree.', group: 'Data', icon: Braces, keywords: ['json', 'format', 'pretty', 'minify', 'validate', 'lint', 'tree', 'viewer', 'beautify'], load: () => import('./tools/JsonTool') },
  { id: 'yaml', title: 'YAML viewer', short: 'YAML', description: 'Parse YAML locally, inspect it as a tree and convert to JSON.', group: 'Data', icon: ListTree, keywords: ['yaml', 'yml', 'config', 'viewer', 'convert', 'json'], load: () => import('./tools/YamlTool') },
  { id: 'xml', title: 'XML viewer', short: 'XML', description: 'Validate XML, browse the element tree and pretty-print it.', group: 'Data', icon: FileCode2, keywords: ['xml', 'svg', 'rss', 'viewer', 'format', 'dom'], load: () => import('./tools/XmlTool') },
  { id: 'csv', title: 'CSV viewer', short: 'CSV', description: 'View delimited data as a sortable table with delimiter detection.', group: 'Data', icon: FileSpreadsheet, keywords: ['csv', 'tsv', 'table', 'spreadsheet', 'delimiter', 'viewer'], load: () => import('./tools/CsvTool') },
  { id: 'markdown', title: 'Markdown preview', short: 'Markdown', description: 'Write or open Markdown and see a sanitized live preview.', group: 'Text', icon: FileText, keywords: ['markdown', 'md', 'preview', 'viewer', 'readme'], load: () => import('./tools/MarkdownTool') },
  { id: 'diff', title: 'Diff viewer', short: 'Diff', description: 'Compare two texts line by line — side-by-side or unified.', group: 'Text', icon: Diff, keywords: ['diff', 'compare', 'text compare', 'patch', 'changes', 'merge'], load: () => import('./tools/DiffTool') },
  { id: 'text', title: 'Text tools', short: 'Text', description: 'Counts, case conversion, whitespace cleanup, sort and dedupe lines.', group: 'Text', icon: Type, keywords: ['text', 'word count', 'case', 'camel', 'snake', 'sort lines', 'dedupe', 'trim', 'whitespace'], load: () => import('./tools/TextTool') },
  { id: 'regex', title: 'Regex tester', short: 'Regex', description: 'Test JavaScript regular expressions with highlighting, groups and replace.', group: 'Text', icon: Regex, keywords: ['regex', 'regexp', 'regular expression', 'match', 'replace', 'pattern'], load: () => import('./tools/RegexTool') },
  { id: 'jwt', title: 'JWT decoder', short: 'JWT', description: 'Decode JSON Web Tokens and check expiry; verify HMAC signatures.', group: 'Encoding & crypto', icon: KeyRound, keywords: ['jwt', 'token', 'bearer', 'decode', 'jws', 'hs256', 'oauth'], load: () => import('./tools/JwtTool') },
  { id: 'base64', title: 'Base64', short: 'Base64', description: 'Encode and decode Base64 text; turn files into data URLs.', group: 'Encoding & crypto', icon: Binary, keywords: ['base64', 'encode', 'decode', 'data url', 'btoa', 'atob'], load: () => import('./tools/Base64Tool') },
  { id: 'url', title: 'URL tools', short: 'URL', description: 'Encode/decode URL components and take URLs apart.', group: 'Encoding & crypto', icon: Link2, keywords: ['url', 'uri', 'encode', 'decode', 'percent', 'query string', 'parse'], load: () => import('./tools/UrlTool') },
  { id: 'hash', title: 'Hash calculator', short: 'Hash', description: 'MD5, SHA-1, SHA-256/384/512 for text and files.', group: 'Encoding & crypto', icon: Hash, keywords: ['hash', 'md5', 'sha', 'sha256', 'checksum', 'digest', 'sha1'], load: () => import('./tools/HashTool') },
  { id: 'uuid', title: 'UUID generator', short: 'UUID', description: 'Generate v4/v7 UUIDs in bulk and inspect existing ones.', group: 'Encoding & crypto', icon: Fingerprint, keywords: ['uuid', 'guid', 'random', 'id', 'v4', 'v7'], load: () => import('./tools/UuidTool') },
  { id: 'timestamp', title: 'Timestamp converter', short: 'Timestamp', description: 'Unix seconds/ms ↔ ISO and local time, across time zones.', group: 'Time', icon: Clock, keywords: ['timestamp', 'unix', 'epoch', 'date', 'time', 'iso', 'timezone'], load: () => import('./tools/TimestampTool') },
  { id: 'cron', title: 'Cron helper', short: 'Cron', description: 'Explain 5-field cron expressions and preview the next runs.', group: 'Time', icon: CalendarClock, keywords: ['cron', 'crontab', 'schedule', 'next run'], load: () => import('./tools/CronTool') },
  { id: 'playground', title: 'HTML/CSS/JS playground', short: 'Playground', description: 'Instant preview in a sandboxed frame with captured console.', group: 'Web', icon: Code2, keywords: ['playground', 'html', 'css', 'javascript', 'js', 'sandbox', 'fiddle', 'codepen'], load: () => import('./tools/PlaygroundTool') },
  { id: 'http', title: 'HTTP request tester', short: 'HTTP', description: 'Send a request to a URL you choose and inspect the response.', group: 'Web', icon: Globe, network: true, keywords: ['http', 'request', 'rest', 'api', 'curl', 'postman', 'fetch', 'headers'], load: () => import('./tools/HttpTool') },
  { id: 'color', title: 'Color & contrast', short: 'Color', description: 'Convert HEX/RGB/HSL/OKLCH, check WCAG contrast, pick from screen.', group: 'Design', icon: Palette, keywords: ['color', 'colour', 'hex', 'rgb', 'hsl', 'oklch', 'contrast', 'wcag', 'eyedropper', 'picker'], load: () => import('./tools/ColorTool') },
  { id: 'image', title: 'Image inspector', short: 'Image', description: 'Dimensions, format, size, compression and EXIF of a local image.', group: 'Design', icon: ImageIcon, keywords: ['image', 'exif', 'metadata', 'dimensions', 'jpeg', 'png', 'photo'], load: () => import('./tools/ImageTool') }
]

export function toolById(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id)
}
