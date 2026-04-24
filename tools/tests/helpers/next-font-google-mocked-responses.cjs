/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');

const notoSansPath = path.join(process.cwd(), 'public', 'fonts', 'NotoSansJP-Regular.otf');

module.exports = {
  'https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap': `
    @font-face {
      font-family: 'Noto Sans JP';
      font-style: normal;
      font-weight: 400;
      font-display: swap;
      src: url(${notoSansPath}) format('opentype');
    }

    @font-face {
      font-family: 'Noto Sans JP';
      font-style: normal;
      font-weight: 500;
      font-display: swap;
      src: url(${notoSansPath}) format('opentype');
    }

    @font-face {
      font-family: 'Noto Sans JP';
      font-style: normal;
      font-weight: 700;
      font-display: swap;
      src: url(${notoSansPath}) format('opentype');
    }
  `,
  'https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap': `
    @font-face {
      font-family: 'Geist Mono';
      font-style: normal;
      font-weight: 100 900;
      font-display: swap;
      src: url(${notoSansPath}) format('opentype');
    }
  `,
};
