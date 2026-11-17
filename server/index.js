import { createRequire } from 'node:module';
import express from 'express';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { ZipArchive } = require('archiver');

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = path.join(root, 'output');
const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(root, 'public')));
app.get('/assets/:file', async (req, res, next) => {
  const capture = req.get('referer')?.match(/\/output\/([^/]+)\//)?.[1];
  if (!capture || capture !== safeName(capture)) return next();
  try {
    const manifest = JSON.parse(await readFile(path.join(outputRoot, capture, 'manifest.json'), 'utf8'));
    const source = allowedUrl(manifest.source);
    const remote = new URL(`/assets/${encodeURIComponent(req.params.file)}`, source).href;
    const asset = await fetch(remote);
    if (!asset.ok) return res.status(asset.status).end();
    res.type(asset.headers.get('content-type') || 'application/octet-stream');
    res.send(Buffer.from(await asset.arrayBuffer()));
  } catch (error) {
    next(error);
  }
});
app.use('/output', express.static(outputRoot));
const safeName = (value) => value.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '').toLowerCase().slice(0, 64) || 'capture';
const allowedUrl = (value) => {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('URL must use HTTP or HTTPS.');
  return url;
};
const extension = (url, contentType = '') => {
  const fromUrl = path.extname(new URL(url).pathname).slice(0, 10);
  if (fromUrl) return fromUrl;
  if (contentType.includes('text/css')) return '.css';
  if (contentType.includes('javascript')) return '.js';
  if (contentType.includes('font/woff2')) return '.woff2';
  if (contentType.includes('font/woff')) return '.woff';
  if (contentType.includes('image/svg')) return '.svg';
  if (contentType.includes('image/png')) return '.png';
  if (contentType.includes('image/jpeg')) return '.jpg';
  if (contentType.includes('image/webp')) return '.webp';
  return '.bin';
};
const localUrl = (value, base, assets) => {
  if (!value || value.startsWith('#') || /^(data:|blob:|mailto:|tel:|javascript:)/i.test(value)) return value;
  try {
    return assets.get(new URL(value, base).href) || value;
  } catch {
    return value;
  }
};
const rewriteCss = (css, source, assets) => css.replace(/url\((['"]?)(.*?)\1\)/gi, (match, quote, value) => {
  const local = localUrl(value.trim(), source, assets);
  return local === value.trim() ? match : `url(${quote}${path.basename(local)}${quote})`;
});
const rewriteJavaScript = (javascript, source, assets) => javascript.replace(/(['"])(\.?\/?[^'"`\\\s]+\.(?:js|mjs|json)(?:\?[^'"`\\\s]*)?)\1/g, (match, quote, value) => {
  const local = localUrl(value, source, assets);
  return local === value ? match : `${quote}${path.basename(local)}${quote}`;
});
const rewriteHtml = (html, source, assets) => html
  .replace(/\b(src|href|poster|data-src)=(['"])(.*?)\2/gi, (match, attribute, quote, value) => `${attribute}=${quote}${localUrl(value, source, assets)}${quote}`)
  .replace(/\b(srcset|data-srcset)=(['"])(.*?)\2/gi, (match, attribute, quote, value) => `${attribute}=${quote}${value.split(',').map((item) => {
    const [url, descriptor] = item.trim().split(/\s+/, 2);
    return `${localUrl(url, source, assets)}${descriptor ? ` ${descriptor}` : ''}`;
  }).join(', ')}${quote}`)
  .replace(/<video\b(?=[^>]*\bsrc=(['"])assets\/[^'"]+\1)(?=[^>]*\bdata-inline-media-basepath=)/gi, '<video data-inline-media-local');
const preserveInlineVideos = '<script>!function(){const setAttribute=Element.prototype.setAttribute;Element.prototype.setAttribute=function(name,value){if(this.matches?.("video[data-inline-media-local]")&&name.toLowerCase()==="src")return;return setAttribute.call(this,name,value)};addEventListener("DOMContentLoaded",()=>document.querySelectorAll("video[data-inline-media-local]").forEach(video=>{video.autoplay=true;video.loop=true;video.play().catch(()=>{})}))}()</script>';
const rewriteDocument = (html, source, assets, inlineVideos = []) => {
  const document = rewriteHtml(html, source, assets);
  const videos = inlineVideos.map(({ tile, html }) => ({ tile, html: rewriteHtml(html, source, assets) }));
  return document.replace(/<div class="tile-wrapper[^>]*data-tile-id="([^"]+)"[\s\S]*?<div class="tile-image-wrapper">/g, (match, tile) => {
    const video = videos.find((entry) => entry.tile === tile);
    return video ? `${match}${video.html}` : match;
  }).replace('</head>', `${preserveInlineVideos}</head>`);
};
const trackInlineVideos = (page) => page.addInitScript(() => {
  window.__capturedInlineVideos = [];
  const save = (video) => {
    const tile = video.closest('[data-tile-id]')?.getAttribute('data-tile-id');
    if (!tile || !video.currentSrc && !video.src) return;
    const html = (video.closest('.inline-media-wrapper') || video).outerHTML;
    const index = window.__capturedInlineVideos.findIndex((entry) => entry.tile === tile);
    if (index < 0) window.__capturedInlineVideos.push({ tile, html });
    else window.__capturedInlineVideos[index] = { tile, html };
  };
  new MutationObserver((mutations) => mutations.forEach((mutation) => {
    if (mutation.type === 'attributes' && mutation.target.matches('video')) save(mutation.target);
    mutation.addedNodes?.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches?.('video')) save(node);
      node.querySelectorAll?.('video').forEach(save);
    });
  })).observe(document, { attributes: true, attributeFilter: ['src'], childList: true, subtree: true });
});
const scrollPage = async (page) => {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight) {
      scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(1000);
};
const pageAssets = (page) => page.evaluate(() => [...document.querySelectorAll('[src], [poster], [srcset], [data-src], [data-srcset], link[rel~="stylesheet"], link[rel~="preload"]')].flatMap((element) => {
  const values = ['src', 'poster', 'data-src', 'href'].flatMap((attribute) => element.getAttribute(attribute) ? [element.getAttribute(attribute)] : []);
  for (const attribute of ['srcset', 'data-srcset']) values.push(...(element.getAttribute(attribute) || '').split(',').map((item) => item.trim().split(/\s+/, 1)[0]));
  return values;
}));

app.post('/api/capture', async (req, res) => {
  let target;
  try {
    if (!req.body.authorized) throw new Error('Confirm you own or have permission for this URL.');
    target = allowedUrl(req.body.url);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const name = `${safeName(target.hostname)}-${Date.now()}`;
  const destination = path.join(outputRoot, name);
  const assetsDirectory = path.join(destination, 'assets');
  await mkdir(assetsDirectory, { recursive: true });

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    await trackInlineVideos(page);
    const responses = new Map();
    page.on('response', (response) => {
      const type = response.request().resourceType();
      if (['stylesheet', 'image', 'font', 'script', 'media'].includes(type) && response.ok()) responses.set(response.url(), response);
    });
    await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await scrollPage(page);

    const title = await page.title();
    await page.screenshot({ path: path.join(destination, 'desktop.png'), fullPage: true });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    mobile.on('response', (response) => {
      const type = response.request().resourceType();
      if (['stylesheet', 'image', 'font', 'script', 'media'].includes(type) && response.ok()) responses.set(response.url(), response);
    });
    await mobile.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await mobile.waitForTimeout(800);
    await scrollPage(mobile);
    await mobile.screenshot({ path: path.join(destination, 'mobile.png'), fullPage: true });
    const referencedUrls = [...new Set([...(await pageAssets(page)), ...(await pageAssets(mobile))])];
    const inlineVideos = await page.evaluate(() => window.__capturedInlineVideos);

    const assets = new Map();
    const records = [];
    let index = 1;
    for (const [url, response] of responses) {
      try {
        const type = response.request().resourceType();
        const body = type === 'media'
          ? Buffer.from(await (await fetch(url)).arrayBuffer())
          : await response.body();
        if (!body.length || body.length > 20 * 1024 * 1024) continue;
        const file = `asset-${String(index++).padStart(3, '0')}${extension(url, response.headers()['content-type'])}`;
        const local = `assets/${file}`;
        await writeFile(path.join(assetsDirectory, file), body);
        assets.set(url, local);
        records.push({ url, file: local, type: response.request().resourceType(), bytes: body.length });
      } catch {}
    }
    for (const value of referencedUrls) {
      let url;
      try {
        url = new URL(value, target).href;
        if (new URL(url).origin !== target.origin || assets.has(url)) continue;
        const asset = await fetch(url);
        const body = Buffer.from(await asset.arrayBuffer());
        if (!asset.ok || !body.length || body.length > 20 * 1024 * 1024) continue;
        const contentType = asset.headers.get('content-type') || '';
        const file = `asset-${String(index++).padStart(3, '0')}${extension(url, contentType)}`;
        const local = `assets/${file}`;
        await writeFile(path.join(assetsDirectory, file), body);
        assets.set(url, local);
        records.push({ url, file: local, type: contentType.includes('text/css') ? 'stylesheet' : 'html-asset', bytes: body.length });
      } catch {}
    }
    for (const record of records.filter((record) => record.type === 'stylesheet')) {
      const css = await readFile(path.join(destination, record.file), 'utf8');
      for (const match of css.matchAll(/url\((['"]?)(.*?)\1\)/gi)) {
        const url = new URL(match[2].trim(), record.url).href;
        if (assets.has(url) || /^(data:|blob:)/i.test(url)) continue;
        try {
          const asset = await fetch(url);
          const body = Buffer.from(await asset.arrayBuffer());
          if (!asset.ok || !body.length || body.length > 20 * 1024 * 1024) continue;
          const file = `asset-${String(index++).padStart(3, '0')}${extension(url, asset.headers.get('content-type') || '')}`;
          const local = `assets/${file}`;
          await writeFile(path.join(assetsDirectory, file), body);
          assets.set(url, local);
          records.push({ url, file: local, type: 'css-asset', bytes: body.length });
        } catch {}
      }
      await writeFile(path.join(destination, record.file), rewriteCss(css, record.url, assets));
    }
    for (const record of records.filter((record) => record.type === 'script')) {
      const script = await readFile(path.join(destination, record.file), 'utf8');
      await writeFile(path.join(destination, record.file), rewriteJavaScript(script, record.url, assets));
    }
    await writeFile(path.join(destination, 'index.html'), rewriteDocument(await page.content(), target.href, assets, inlineVideos));
    await mobile.close();
    await writeFile(path.join(destination, 'manifest.json'), JSON.stringify({ source: target.href, title, capturedAt: new Date().toISOString(), assets: records }, null, 2));
    res.json({ name, title, files: ['index.html', 'desktop.png', 'mobile.png', 'manifest.json'], assets: records.length });
  } catch (error) {
    await rm(destination, { recursive: true, force: true });
    res.status(500).json({ error: `Capture failed: ${error.message}` });
  } finally {
    await browser?.close();
  }
});

app.get('/api/captures', async (_req, res) => {
  await mkdir(outputRoot, { recursive: true });
  const entries = await readdir(outputRoot, { withFileTypes: true });
  const captures = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => ({ name: entry.name, createdAt: (await stat(path.join(outputRoot, entry.name))).birthtimeMs })));
  res.json(captures.sort((a, b) => b.createdAt - a.createdAt).map((capture) => capture.name));
});

app.get('/api/export/:name', async (req, res) => {
  const name = safeName(req.params.name);
  const source = path.join(outputRoot, name);
  if (!existsSync(source)) return res.status(404).json({ error: 'Capture not found.' });
  res.attachment(`${name}.zip`);
  const zip = new ZipArchive({ zlib: { level: 9 } });
  zip.on('error', (error) => res.destroy(error));
  zip.pipe(res);
  zip.directory(source, name);
  await zip.finalize();
});

app.delete('/api/captures/:name', async (req, res) => {
  const name = safeName(req.params.name);
  const source = path.join(outputRoot, name);
  if (!existsSync(source)) return res.status(404).json({ error: 'Capture not found.' });
  await rm(source, { recursive: true, force: true });
  res.status(204).end();
});

app.listen(4173, '127.0.0.1', () => console.log('Landing Cloner: http://127.0.0.1:4173'));
