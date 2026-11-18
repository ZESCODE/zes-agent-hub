// zes-agent-hub — deploy pipelines
// Free tier: render the ZES template, QC the hero image, deploy to Cloudflare Pages.
// Premium: render then deploy to Vercel (or Cloudflare Workers).

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadSeatConfig } from './council.js';
import { buildImageUrl, generateHeroCopy } from './images.js';
import { qcCheck } from './qc.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

function templatePath(config) {
  return process.env.ZES_CODES_PATH || config.pipeline?.localPath || '/tmp/zes.codes';
}

function run(command, { cwd, timeout = 180_000 } = {}) {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout,
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = (result.stderr || result.stdout || '').trim().slice(-800);
    throw new Error(`${command.split(' ')[0]} exited ${result.status}: ${detail}`);
  }

  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function ensureTemplate(config) {
  const localPath = templatePath(config);

  if (fs.existsSync(path.join(localPath, 'index.html'))) {
    try {
      run(`git -C "${localPath}" pull --ff-only`, { timeout: 60_000 });
    } catch {
      // Offline or detached template checkout — render what is on disk.
    }

    return localPath;
  }

  fs.mkdirSync(path.dirname(localPath), { recursive: true });
  run(`git clone --depth 1 https://github.com/ZESCODE/zes.codes.git "${localPath}"`, {
    timeout: 120_000,
  });

  return localPath;
}

function slugify(value) {
  return String(value || 'zes-site')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
  });
}

export function renderSite({ templateDir, title, niche, heroCopy, heroImageUrl }) {
  let sourcePath = path.join(templateDir, 'index.html');

  /*
   * ZES_CODES_PATH may point at the public zes.codes site, which has no
   * placeholders. Fall back to the hub's own template in that case.
   */
  if (!fs.existsSync(sourcePath) || !fs.readFileSync(sourcePath, 'utf8').includes('{{TITLE}}')) {
    sourcePath = path.join(ROOT, 'index.html');
  }

  const source = fs.readFileSync(sourcePath, 'utf8');
  const html = source
    .replaceAll('{{TITLE}}', escapeHtml(title))
    .replaceAll('{{NICHE}}', escapeHtml(niche))
    .replaceAll('{{HERO_COPY}}', escapeHtml(heroCopy))
    .replaceAll('{{HERO_IMAGE_URL}}', escapeHtml(heroImageUrl));

  const outDir = path.join(ROOT, '.zes-builds', slugify(title));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'index.html'), html);

  for (const file of ['styles.css', 'script.js']) {
    const sourceFile = path.join(templateDir, file);

    if (fs.existsSync(sourceFile)) {
      fs.copyFileSync(sourceFile, path.join(outDir, file));
    }
  }

  return { outDir, html };
}

function extractUrl(output) {
  const match = output.match(/https:\/\/[^\s"'<>]+/g) || [];
  return match.find((url) => /\.(pages\.dev|vercel\.app)/.test(url)) || match[0] || null;
}

function deployCloudflarePages(outDir, projectName) {
  const output = run(
    `npx --yes wrangler@latest pages deploy "${outDir}" --project-name "${projectName}" --commit-dirty=true`,
    { timeout: 300_000 },
  );

  return { liveUrl: extractUrl(output), log: output };
}

function deployVercel(outDir) {
  const output = run(`npx --yes vercel@latest deploy --prod --yes "${outDir}"`, {
    timeout: 300_000,
  });

  return { liveUrl: extractUrl(output), log: output };
}

/**
 * Free-tier pipeline: copy → image → QC → render → Cloudflare Pages.
 */
export async function runFreeTier({ title, niche, templateId, dryRun = false, logger = () => {} }) {
  if (!title || !niche) {
    throw new Error('title and niche are required');
  }

  const config = loadSeatConfig();
  const castor = config.seats.find((seat) => seat.id === 'castor');
  const templateDir = templateId
    ? path.resolve(templateId)
    : process.env.ZES_CODES_PATH
      ? path.resolve(process.env.ZES_CODES_PATH)
      : ROOT;

  const heroCopy = await generateHeroCopy(castor, { title, niche });
  logger(`Hero copy: ${heroCopy}`);

  let image = null;
  let qc = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    image = buildImageUrl(`website hero photograph for a ${niche}, natural light, clean wide composition, no visible lettering or logos`, {
      seed: Math.floor(Math.random() * 1_000_000),
    });
    qc = await qcCheck(image.url, { prompt: `website hero photograph for a ${niche}`, config });
    logger(`QC attempt ${attempt}: ${qc.averageScore} (${qc.recommendation})`);

    if (qc.passed) {
      break;
    }
  }

  if (!qc?.passed) {
    return {
      ok: false,
      error: 'QC failed after 3 attempts',
      imageUrl: image?.url || null,
      qc,
    };
  }

  const { outDir } = renderSite({
    templateDir,
    title,
    niche,
    heroCopy,
    heroImageUrl: image.url,
  });

  if (dryRun) {
    return { ok: true, dryRun: true, liveUrl: null, previewPath: outDir, imageUrl: image.url, qc };
  }

  const projectName = process.env.CLOUDFLARE_PAGES_PROJECT || slugify(title);
  const deployed = deployCloudflarePages(outDir, projectName);

  return {
    ok: Boolean(deployed.liveUrl),
    liveUrl: deployed.liveUrl,
    provider: 'cloudflare-pages',
    project: projectName,
    previewPath: outDir,
    imageUrl: image.url,
    qc,
  };
}

/**
 * Premium pipeline: render then deploy to Vercel (default) or Cloudflare.
 */
export async function runPremium({
  title = 'ZES Site',
  niche = 'business',
  heroCopy = `Built with ${'ZES.codes'}`,
  imageUrl,
  deployTarget = 'vercel',
  dryRun = false,
  logger = () => {},
}) {
  const templateDir = process.env.ZES_CODES_PATH ? path.resolve(process.env.ZES_CODES_PATH) : ROOT;
  const image = imageUrl || buildImageUrl(`${title} ${niche} hero image`).url;
  const { outDir } = renderSite({ templateDir, title, niche, heroCopy, heroImageUrl: image });

  logger(`Rendered ${outDir}`);

  if (dryRun) {
    return { ok: true, dryRun: true, liveUrl: null, previewPath: outDir, provider: deployTarget };
  }

  if (deployTarget === 'cloudflare') {
    const project = process.env.CLOUDFLARE_PAGES_PROJECT || slugify(title);
    const deployed = deployCloudflarePages(outDir, project);
    return { ok: Boolean(deployed.liveUrl), liveUrl: deployed.liveUrl, provider: 'cloudflare-pages', previewPath: outDir };
  }

  const deployed = deployVercel(outDir);
  return { ok: Boolean(deployed.liveUrl), liveUrl: deployed.liveUrl, provider: 'vercel', previewPath: outDir };
}

/**
 * CLI-compatible deploy: clone/pull the template and deploy it as-is.
 */
export async function deployTemplate({ targets = ['vercel', 'cloudflare'] } = {}) {
  const config = loadSeatConfig();
  const dir = ensureTemplate(config);
  const result = {};

  if (targets.includes('vercel')) {
    result.vercel = deployVercel(dir);
  }

  if (targets.includes('cloudflare')) {
    const project = process.env.CLOUDFLARE_PAGES_PROJECT || 'zes-codes';
    result.cloudflare = deployCloudflarePages(dir, project);
  }

  return result;
}
