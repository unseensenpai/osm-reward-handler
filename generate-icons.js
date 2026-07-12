const sharp = require('sharp');
const fs = require('fs');

const svgPath = 'icons/icon.svg';
const sizes = [16, 32, 48, 128];

(async () => {
  for (const size of sizes) {
    await sharp(svgPath)
      .resize(size, size)
      .png()
      .toFile(`icons/icon${size}.png`);
    console.log(`Generated icon${size}.png`);
  }
})();
