#!/usr/bin/env node
/**
 * Generates the HarmonyOS colour and size resources from the shared design tokens.
 *
 *   node mobile/tools/gen-harmony-tokens.mjs
 *
 * Source:  prototypes/mobile-app/tokens.json   (the same tokens the prototype and the Android theme use)
 * Output:  mobile/harmony/entry/src/main/resources/base/element/color.json   (light)
 *          mobile/harmony/entry/src/main/resources/dark/element/color.json   (dark, picked by the system)
 *          mobile/harmony/entry/src/main/resources/base/element/float.json   (spacing, radius, sizes in vp; type in fp)
 *
 * Resource names are snake_case (brandSoft → brand_soft). Colours with alpha are converted from CSS #RRGGBBAA to
 * HarmonyOS #AARRGGBB. Do not edit the generated files by hand; change tokens.json and run this again.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tokens = JSON.parse(readFileSync(join(root, 'prototypes/mobile-app/tokens.json'), 'utf8'));
const res = join(root, 'mobile/harmony/entry/src/main/resources');

const snake = name => name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const harmonyColor = hex => {
  const h = hex.replace('#', '').toUpperCase();
  if (h.length === 6) return `#${h}`;
  if (h.length === 8) return `#${h.slice(6)}${h.slice(0, 6)}`; // RRGGBBAA → AARRGGBB
  throw new Error(`Unsupported colour ${hex}`);
};
const colors = mode => ({
  color: [
    ...Object.entries(tokens.color[mode]).map(([name, value]) => ({ name: snake(name), value: harmonyColor(value) })),
    // The splash window behind the start icon (module.json5 startWindowBackground) uses the page canvas colour.
    { name: 'start_window_background', value: harmonyColor(tokens.color[mode].bg) },
  ],
});
const write = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
  console.log(`wrote ${file.replace(`${root}/`, '')}`);
};

write(join(res, 'base/element/color.json'), colors('light'));
write(join(res, 'dark/element/color.json'), colors('dark'));

const floats = [
  ...Object.entries(tokens.space).map(([k, v]) => [`space_${k}`, `${v}vp`]),
  ...Object.entries(tokens.radius).map(([k, v]) => [`radius_${k}`, `${v}vp`]),
  ...Object.entries(tokens.size).map(([k, v]) => [`size_${snake(k)}`, `${v}vp`]),
  ...Object.entries(tokens.type).filter(([, v]) => typeof v === 'object' && v.size).map(([k, v]) => [`font_${snake(k)}`, `${v.size}fp`]),
];
write(join(res, 'base/element/float.json'), { float: floats.map(([name, value]) => ({ name, value })) });
