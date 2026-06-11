import fs from 'node:fs/promises';
import path from 'node:path';

/**
 * design fidelity 比較ビューアを生成する。
 *
 * tools/tests/.artifacts/design-fidelity/capture-report.json を読み、
 * ターゲット PNG(design/images)と actual PNG を横並びで見られる
 * report.html を同ディレクトリに出力する。
 *
 * 実行: pnpm exec tsx tools/scripts/design-fidelity-report.ts
 */

const OUTPUT_DIR =
  process.env.DESIGN_FIDELITY_DIR ??
  path.join(process.cwd(), 'tools', 'tests', '.artifacts', 'design-fidelity');

type CaptureRecord = {
  screenId: string;
  status: 'captured' | 'unmapped';
  route: string | null;
  actualImage: string | null;
  targetImage: string;
  note?: string;
};

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

async function main() {
  const reportPath = path.join(OUTPUT_DIR, 'capture-report.json');
  const raw = await fs.readFile(reportPath, 'utf-8');
  const records = Object.values(JSON.parse(raw) as Record<string, CaptureRecord>).sort((a, b) =>
    a.screenId.localeCompare(b.screenId)
  );

  const captured = records.filter((r) => r.status === 'captured');
  const unmapped = records.filter((r) => r.status !== 'captured');

  const rows = captured
    .map((record) => {
      const target = `file://${record.targetImage}`;
      const actual = record.actualImage ? `file://${record.actualImage}` : '';
      return `
  <section class="screen" id="${escapeHtml(record.screenId)}">
    <h2>${escapeHtml(record.screenId)} <small>${escapeHtml(record.route ?? '')}</small></h2>
    ${record.note ? `<p class="note">${escapeHtml(record.note)}</p>` : ''}
    <div class="pair">
      <figure><figcaption>target(design)</figcaption><img src="${target}" loading="lazy" /></figure>
      <figure><figcaption>actual(実装)</figcaption><img src="${actual}" loading="lazy" /></figure>
    </div>
  </section>`;
    })
    .join('\n');

  const unmappedList = unmapped
    .map(
      (record) =>
        `<li><code>${escapeHtml(record.screenId)}</code> — ${escapeHtml(record.note ?? '未マッピング')}</li>`
    )
    .join('\n');

  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<title>Design Fidelity Report</title>
<style>
  body { font-family: -apple-system, "Noto Sans JP", sans-serif; margin: 24px; background: #f6f8fb; }
  h1 { font-size: 20px; }
  h2 { font-size: 15px; margin: 0 0 8px; }
  h2 small { color: #667; font-weight: normal; margin-left: 8px; }
  .screen { background: #fff; border: 1px solid #d8dee9; border-radius: 8px; padding: 16px; margin-bottom: 24px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  figure { margin: 0; }
  figcaption { font-size: 12px; color: #556; margin-bottom: 4px; }
  img { width: 100%; border: 1px solid #ccd4e0; border-radius: 4px; }
  .note { color: #875c00; font-size: 12px; }
  .toc { columns: 3; font-size: 13px; }
  ul.unmapped { font-size: 13px; color: #555; }
</style>
</head>
<body>
<h1>Design Fidelity Report(target vs actual)</h1>
<p>生成: ${new Date().toISOString()} / 撮影 ${captured.length} 画面・未マッピング ${unmapped.length} 画面</p>
<nav class="toc">
${captured.map((r) => `<div><a href="#${escapeHtml(r.screenId)}">${escapeHtml(r.screenId)}</a></div>`).join('\n')}
</nav>
${rows}
<h2>未マッピング(撮影スキップ)</h2>
<ul class="unmapped">
${unmappedList}
</ul>
</body>
</html>
`;

  const outPath = path.join(OUTPUT_DIR, 'report.html');
  await fs.writeFile(outPath, html, 'utf-8');
  console.log(`design fidelity report: ${outPath}`);
  console.log(`captured=${captured.length} unmapped=${unmapped.length}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
