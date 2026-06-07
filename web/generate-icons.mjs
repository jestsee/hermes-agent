import sharp from 'sharp';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const iconsDir = join(__dirname, 'public', 'icons');
const svgPath = join(iconsDir, 'icon.svg');

const sizes = [
  { name: 'icon-192x192.png', size: 192 },
  { name: 'icon-512x512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

for (const { name, size } of sizes) {
  await sharp(svgPath)
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, name));
  console.log(`Generated ${name}`);
}
