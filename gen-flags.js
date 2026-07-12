const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'popup', 'flags');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const tr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20" width="20" height="14">
  <rect width="30" height="20" fill="#E30A17"/>
  <circle cx="12" cy="10" r="5" fill="#fff"/>
  <circle cx="13.2" cy="10" r="4" fill="#E30A17"/>
  <polygon points="17,10 21.9,11.5 18.9,7.6 18.9,12.4 21.9,8.5" fill="#fff"/>
</svg>
`;

const gb = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 30" width="20" height="14">
  <clipPath id="t">
    <path d="M0,0 v30 h60 v-30 z"/>
  </clipPath>
  <g clip-path="url(#t)">
    <path d="M0,0 v30 h60 v-30 z" fill="#00247d"/>
    <path d="M0,0 L60,30 M60,0 L0,30" stroke="#fff" stroke-width="6"/>
    <path d="M0,0 L60,30 M60,0 L0,30" stroke="#cf142b" stroke-width="2"/>
    <path d="M30,0 v30 M0,15 h60" stroke="#fff" stroke-width="10"/>
    <path d="M30,0 v30 M0,15 h60" stroke="#cf142b" stroke-width="6"/>
  </g>
</svg>
`;

fs.writeFileSync(path.join(dir, 'tr.svg'), tr, 'utf8');
fs.writeFileSync(path.join(dir, 'gb.svg'), gb, 'utf8');
console.log('Flags generated');
