// Unit conversion tables. Linear units are stored as a factor to the
// category's base unit; temperature uses explicit affine functions.

export type UnitCategory = 'length' | 'mass' | 'temperature' | 'data' | 'time' | 'speed' | 'area' | 'volume'

export interface UnitDef {
  id: string
  label: string
  category: UnitCategory
  /** Value of 1 of this unit in the category's base unit (linear units). */
  factor?: number
  toBase?: (v: number) => number
  fromBase?: (v: number) => number
  /** Lookup aliases; matched case-sensitively first, then case-insensitively. */
  aliases: string[]
}

export const CATEGORY_LABELS: Record<UnitCategory, string> = {
  length: 'Length',
  mass: 'Mass',
  temperature: 'Temperature',
  data: 'Data size',
  time: 'Time',
  speed: 'Speed',
  area: 'Area',
  volume: 'Volume'
}

const L = (id: string, label: string, category: UnitCategory, factor: number, aliases: string[] = []): UnitDef => ({ id, label, category, factor, aliases: [id, ...aliases] })

// Order matters for ambiguous case-insensitive aliases: earlier units win
// (e.g. "gb" → gigabyte rather than gigabit, "mb" → megabyte).
export const UNITS: UnitDef[] = [
  // Length (base: metre)
  L('mm', 'Millimetre', 'length', 1e-3, ['millimeter', 'millimeters', 'millimetre', 'millimetres']),
  L('cm', 'Centimetre', 'length', 1e-2, ['centimeter', 'centimeters', 'centimetre', 'centimetres']),
  L('m', 'Metre', 'length', 1, ['meter', 'meters', 'metre', 'metres']),
  L('km', 'Kilometre', 'length', 1e3, ['kilometer', 'kilometers', 'kilometre', 'kilometres', 'kms']),
  L('in', 'Inch', 'length', 0.0254, ['inch', 'inches', '"', '″']),
  L('ft', 'Foot', 'length', 0.3048, ['foot', 'feet', "'", '′']),
  L('yd', 'Yard', 'length', 0.9144, ['yard', 'yards', 'yds']),
  L('mi', 'Mile', 'length', 1609.344, ['mile', 'miles']),
  L('nmi', 'Nautical mile', 'length', 1852, ['nautical mile', 'nautical miles', 'NM']),
  L('µm', 'Micrometre', 'length', 1e-6, ['um', 'micron', 'microns', 'micrometer', 'micrometers']),
  L('nm', 'Nanometre', 'length', 1e-9, ['nanometer', 'nanometers', 'nanometre']),
  L('ly', 'Light-year', 'length', 9.4607304725808e15, ['light year', 'light years', 'lightyear', 'lightyears']),

  // Mass (base: kilogram)
  L('mg', 'Milligram', 'mass', 1e-6, ['milligram', 'milligrams']),
  L('g', 'Gram', 'mass', 1e-3, ['gram', 'grams', 'gr']),
  L('kg', 'Kilogram', 'mass', 1, ['kilogram', 'kilograms', 'kilo', 'kilos', 'kgs']),
  L('t', 'Tonne', 'mass', 1000, ['tonne', 'tonnes', 'metric ton', 'metric tons']),
  L('oz', 'Ounce', 'mass', 0.028349523125, ['ounce', 'ounces']),
  L('lb', 'Pound', 'mass', 0.45359237, ['lbs', 'pound', 'pounds']),
  L('st', 'Stone', 'mass', 6.35029318, ['stone', 'stones']),
  L('ton', 'US ton', 'mass', 907.18474, ['tons', 'short ton', 'short tons', 'us ton']),
  L('long ton', 'Imperial ton', 'mass', 1016.0469088, ['long tons', 'imperial ton']),
  L('µg', 'Microgram', 'mass', 1e-9, ['ug', 'mcg', 'microgram', 'micrograms']),
  L('ct', 'Carat', 'mass', 0.0002, ['carat', 'carats']),

  // Temperature (base: kelvin)
  { id: '°C', label: 'Celsius', category: 'temperature', toBase: (v) => v + 273.15, fromBase: (v) => v - 273.15, aliases: ['°C', 'C', 'celsius', 'degc', 'degC', 'centigrade', 'ºC'] },
  { id: '°F', label: 'Fahrenheit', category: 'temperature', toBase: (v) => ((v - 32) * 5) / 9 + 273.15, fromBase: (v) => ((v - 273.15) * 9) / 5 + 32, aliases: ['°F', 'F', 'fahrenheit', 'degf', 'degF', 'ºF'] },
  { id: 'K', label: 'Kelvin', category: 'temperature', toBase: (v) => v, fromBase: (v) => v, aliases: ['K', 'kelvin', 'kelvins'] },
  { id: '°R', label: 'Rankine', category: 'temperature', toBase: (v) => (v * 5) / 9, fromBase: (v) => (v * 9) / 5, aliases: ['°R', 'rankine'] },

  // Data (base: byte). Decimal (SI) and binary (IEC) prefixes.
  L('B', 'Byte', 'data', 1, ['byte', 'bytes']),
  L('kB', 'Kilobyte', 'data', 1e3, ['KB', 'kilobyte', 'kilobytes']),
  L('MB', 'Megabyte', 'data', 1e6, ['megabyte', 'megabytes']),
  L('GB', 'Gigabyte', 'data', 1e9, ['gigabyte', 'gigabytes']),
  L('TB', 'Terabyte', 'data', 1e12, ['terabyte', 'terabytes']),
  L('PB', 'Petabyte', 'data', 1e15, ['petabyte', 'petabytes']),
  L('KiB', 'Kibibyte', 'data', 1024, ['kibibyte', 'kibibytes']),
  L('MiB', 'Mebibyte', 'data', 1024 ** 2, ['mebibyte', 'mebibytes']),
  L('GiB', 'Gibibyte', 'data', 1024 ** 3, ['gibibyte', 'gibibytes']),
  L('TiB', 'Tebibyte', 'data', 1024 ** 4, ['tebibyte', 'tebibytes']),
  L('PiB', 'Pebibyte', 'data', 1024 ** 5, ['pebibyte', 'pebibytes']),
  L('bit', 'Bit', 'data', 1 / 8, ['bits', 'b']),
  L('kbit', 'Kilobit', 'data', 1e3 / 8, ['Kb', 'kilobit', 'kilobits']),
  L('Mbit', 'Megabit', 'data', 1e6 / 8, ['Mb', 'megabit', 'megabits']),
  L('Gbit', 'Gigabit', 'data', 1e9 / 8, ['Gb', 'gigabit', 'gigabits']),
  L('Tbit', 'Terabit', 'data', 1e12 / 8, ['Tb', 'terabit', 'terabits']),

  // Time (base: second)
  L('ns', 'Nanosecond', 'time', 1e-9, ['nanosecond', 'nanoseconds']),
  L('µs', 'Microsecond', 'time', 1e-6, ['us', 'microsecond', 'microseconds']),
  L('ms', 'Millisecond', 'time', 1e-3, ['millisecond', 'milliseconds', 'msec']),
  L('s', 'Second', 'time', 1, ['sec', 'secs', 'second', 'seconds']),
  L('min', 'Minute', 'time', 60, ['mins', 'minute', 'minutes']),
  L('h', 'Hour', 'time', 3600, ['hr', 'hrs', 'hour', 'hours']),
  L('d', 'Day', 'time', 86400, ['day', 'days']),
  L('wk', 'Week', 'time', 604800, ['week', 'weeks', 'w']),
  L('mo', 'Month (avg)', 'time', 2629746, ['month', 'months']),
  L('yr', 'Year (avg)', 'time', 31556952, ['y', 'year', 'years']),

  // Speed (base: metre/second)
  L('m/s', 'Metres per second', 'speed', 1, ['mps', 'meters per second', 'metres per second']),
  L('km/h', 'Kilometres per hour', 'speed', 1000 / 3600, ['kmh', 'kph', 'kmph', 'kilometers per hour', 'kilometres per hour']),
  L('mph', 'Miles per hour', 'speed', 1609.344 / 3600, ['mi/h', 'miles per hour']),
  L('kn', 'Knot', 'speed', 1852 / 3600, ['kt', 'kts', 'knot', 'knots']),
  L('ft/s', 'Feet per second', 'speed', 0.3048, ['fps', 'feet per second']),

  // Area (base: square metre)
  L('mm²', 'Square millimetre', 'area', 1e-6, ['mm2', 'sq mm']),
  L('cm²', 'Square centimetre', 'area', 1e-4, ['cm2', 'sq cm']),
  L('m²', 'Square metre', 'area', 1, ['m2', 'sqm', 'sq m', 'square meter', 'square meters', 'square metre', 'square metres']),
  L('km²', 'Square kilometre', 'area', 1e6, ['km2', 'sq km', 'square kilometer', 'square kilometers']),
  L('ha', 'Hectare', 'area', 1e4, ['hectare', 'hectares']),
  L('ac', 'Acre', 'area', 4046.8564224, ['acre', 'acres']),
  L('in²', 'Square inch', 'area', 0.00064516, ['in2', 'sq in', 'square inch', 'square inches']),
  L('ft²', 'Square foot', 'area', 0.09290304, ['ft2', 'sqft', 'sq ft', 'square foot', 'square feet']),
  L('yd²', 'Square yard', 'area', 0.83612736, ['yd2', 'sq yd', 'square yard', 'square yards']),
  L('mi²', 'Square mile', 'area', 2589988.110336, ['mi2', 'sq mi', 'square mile', 'square miles']),

  // Volume (base: litre)
  L('ml', 'Millilitre', 'volume', 1e-3, ['mL', 'milliliter', 'milliliters', 'millilitre', 'millilitres']),
  L('cl', 'Centilitre', 'volume', 1e-2, ['cL', 'centiliter', 'centilitre']),
  L('dl', 'Decilitre', 'volume', 1e-1, ['dL', 'deciliter', 'decilitre']),
  L('l', 'Litre', 'volume', 1, ['L', 'liter', 'liters', 'litre', 'litres', 'ltr']),
  L('m³', 'Cubic metre', 'volume', 1000, ['m3', 'cubic meter', 'cubic meters', 'cubic metre', 'cubic metres']),
  L('cm³', 'Cubic centimetre', 'volume', 1e-3, ['cm3', 'cc']),
  L('tsp', 'Teaspoon (US)', 'volume', 0.00492892159375, ['teaspoon', 'teaspoons']),
  L('tbsp', 'Tablespoon (US)', 'volume', 0.01478676478125, ['tablespoon', 'tablespoons']),
  L('fl oz', 'Fluid ounce (US)', 'volume', 0.0295735295625, ['floz', 'fl. oz', 'fluid ounce', 'fluid ounces']),
  L('cup', 'Cup (US)', 'volume', 0.2365882365, ['cups']),
  L('pt', 'Pint (US)', 'volume', 0.473176473, ['pint', 'pints']),
  L('qt', 'Quart (US)', 'volume', 0.946352946, ['quart', 'quarts']),
  L('gal', 'Gallon (US)', 'volume', 3.785411784, ['gallon', 'gallons', 'us gal']),
  L('imp gal', 'Gallon (imperial)', 'volume', 4.54609, ['imperial gallon', 'imperial gallons', 'uk gal']),
  L('in³', 'Cubic inch', 'volume', 0.016387064, ['in3', 'cu in', 'cubic inch', 'cubic inches']),
  L('ft³', 'Cubic foot', 'volume', 28.316846592, ['ft3', 'cu ft', 'cubic foot', 'cubic feet'])
]

const exact = new Map<string, UnitDef>()
const loose = new Map<string, UnitDef>()
for (const u of UNITS) {
  for (const a of u.aliases) {
    if (!exact.has(a)) exact.set(a, u)
    const k = a.toLowerCase()
    if (!loose.has(k)) loose.set(k, u)
  }
}

export function findUnit(name: string): UnitDef | undefined {
  const s = name.trim().replace(/\s+/g, ' ').replace(/^deg(?:rees?)?\s+/i, '')
  return exact.get(s) ?? loose.get(s.toLowerCase()) ?? (s.length > 3 && s.endsWith('s') ? loose.get(s.slice(0, -1).toLowerCase()) : undefined)
}

export function unitsIn(category: UnitCategory): UnitDef[] {
  return UNITS.filter((u) => u.category === category)
}

export function convert(value: number, from: UnitDef | string, to: UnitDef | string): number {
  const a = typeof from === 'string' ? findUnit(from) : from
  const b = typeof to === 'string' ? findUnit(to) : to
  if (!a) throw new Error(`Unknown unit "${from as string}"`)
  if (!b) throw new Error(`Unknown unit "${to as string}"`)
  if (a.category !== b.category) throw new Error(`Cannot convert ${CATEGORY_LABELS[a.category].toLowerCase()} to ${CATEGORY_LABELS[b.category].toLowerCase()}`)
  const base = a.toBase ? a.toBase(value) : value * a.factor!
  return b.fromBase ? b.fromBase(base) : base / b.factor!
}

export interface ParsedConversion {
  value: number
  from: UnitDef
  to: UnitDef
  result: number
}

/** Parses "10 km to mi", "72°F in C", "5 GB as MiB", "3.5kg -> lb". */
export function parseConversion(text: string): ParsedConversion | null {
  const m = /^\s*(-?(?:\d[\d,_]*(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(.+?)\s+(?:to|in|as|into|->|→|=)\s+(.+?)\s*\??$/i.exec(text)
  if (!m) return null
  const value = Number(m[1].replace(/[,_]/g, ''))
  if (!Number.isFinite(value)) return null
  const from = findUnit(m[2])
  const to = findUnit(m[3])
  if (!from || !to || from.category !== to.category || from === to) return null
  return { value, from, to, result: convert(value, from, to) }
}

/** Formats a converted value with sensible precision. */
export function formatUnitValue(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n === 0) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e15 || abs < 1e-6) return n.toExponential(6).replace(/\.?0+e/, 'e')
  const r = Number.parseFloat(n.toPrecision(10))
  return r.toLocaleString('en-US', { maximumFractionDigits: 10, useGrouping: abs >= 10000 })
}
