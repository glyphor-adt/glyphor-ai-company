import express from 'express';
import { chromium } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';

const app = express();
app.use(express.json({ limit: '25mb' }));

function isHttpUrl(value) {
  return typeof value === 'string' && /^https?:\/\//i.test(value);
}

function extractHexColors(html) {
  if (!html) return [];
  const matches = html.match(/#[0-9A-Fa-f]{3,8}\b/g) || [];
  return [...new Set(matches.map((match) => match.toUpperCase()))].slice(0, 250);
}

function normalizeViewport(input) {
  const fallback = { width: 1440, height: 900 };
  if (!input || typeof input !== 'object') return fallback;
  const width = Number(input.width);
  const height = Number(input.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return fallback;
  return {
    width: Math.max(1, Math.min(3840, Math.floor(width))),
    height: Math.max(1, Math.min(3840, Math.floor(height))),
  };
}

function decodeBase64Png(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Missing base64 image payload');
  }

  const raw = value.startsWith('data:image') ? value.split(',')[1] : value;
  return Buffer.from(raw, 'base64');
}

async function withBrowserPage(viewport, fn) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({ viewport });
  const page = await context.newPage();

  try {
    return await fn(page);
  } finally {
    await context.close();
    await browser.close();
  }
}

async function captureScreenshot(options) {
  const {
    url,
    viewport,
    selector,
    fullPage,
    waitFor,
    timeoutMs = 45_000,
  } = options;

  if (!isHttpUrl(url)) {
    throw new Error('A valid http(s) url is required');
  }

  return withBrowserPage(viewport, async (page) => {
    page.setDefaultNavigationTimeout(timeoutMs);
    page.setDefaultTimeout(timeoutMs);

    await page.goto(url, { waitUntil: 'domcontentloaded' });

    if (waitFor === 'networkidle') {
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    } else if (waitFor === 'load') {
      await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => undefined);
    }

    let pngBuffer;

    if (typeof selector === 'string' && selector.trim()) {
      await page.waitForSelector(selector, { timeout: 10_000 });
      const handle = await page.$(selector);
      if (!handle) {
        throw new Error(`Selector not found: ${selector}`);
      }
      pngBuffer = await handle.screenshot({ type: 'png' });
      await handle.dispose();
    } else {
      pngBuffer = await page.screenshot({
        type: 'png',
        fullPage: Boolean(fullPage),
      });
    }

    const html = await page.content();
    const size = page.viewportSize() || viewport;

    return {
      image: pngBuffer.toString('base64'),
      width: size.width,
      height: size.height,
      html,
      colors: extractHexColors(html),
    };
  });
}

function comparePngBuffers(bufferA, bufferB, threshold = 0.1) {
  const imageA = PNG.sync.read(bufferA);
  const imageB = PNG.sync.read(bufferB);

  if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
    throw new Error(
      `Image dimensions must match for diff (${imageA.width}x${imageA.height} vs ${imageB.width}x${imageB.height})`,
    );
  }

  const diff = new PNG({ width: imageA.width, height: imageA.height });
  const mismatched = pixelmatch(
    imageA.data,
    imageB.data,
    diff.data,
    imageA.width,
    imageA.height,
    { threshold },
  );

  const totalPixels = imageA.width * imageA.height;
  const changedPercentage = Number(((mismatched / totalPixels) * 100).toFixed(2));

  return {
    diff_image: PNG.sync.write(diff).toString('base64'),
    changed_percentage: changedPercentage,
    regions_changed: mismatched > 0 ? 1 : 0,
  };
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/screenshot', async (req, res) => {
  try {
    const viewport = normalizeViewport(req.body?.viewport);
    const payload = await captureScreenshot({
      url: req.body?.url,
      viewport,
      selector: req.body?.selector,
      fullPage: req.body?.full_page ?? req.body?.fullPage ?? false,
      waitFor: req.body?.wait_for,
    });
    res.status(200).json(payload);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/responsive', async (req, res) => {
  try {
    const url = req.body?.url;
    const rawViewports = Array.isArray(req.body?.viewports)
      ? req.body.viewports
      : [
          { width: 375, height: 812 },
          { width: 768, height: 1024 },
          { width: 1024, height: 768 },
          { width: 1440, height: 900 },
          { width: 1920, height: 1080 },
        ];

    const screenshots = [];
    for (const rawViewport of rawViewports) {
      const viewport = normalizeViewport(rawViewport);
      const shot = await captureScreenshot({
        url,
        viewport,
        fullPage: false,
        waitFor: 'networkidle',
      });

      screenshots.push({
        viewport,
        image: shot.image,
        width: shot.width,
        height: shot.height,
      });
    }

    res.status(200).json({ screenshots });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/batch', async (req, res) => {
  try {
    const requests = Array.isArray(req.body?.requests) ? req.body.requests : [];
    const results = [];

    for (const request of requests) {
      try {
        const viewport = normalizeViewport(request?.viewport);
        const shot = await captureScreenshot({
          url: request?.url,
          viewport,
          fullPage: false,
          waitFor: request?.wait_for ?? 'networkidle',
        });

        results.push({
          story_id: request?.story_id ?? null,
          viewport: viewport.width,
          theme: request?.theme ?? null,
          image: shot.image,
          width: shot.width,
          height: shot.height,
        });
      } catch (requestError) {
        results.push({
          story_id: request?.story_id ?? null,
          error: requestError instanceof Error ? requestError.message : String(requestError),
        });
      }
    }

    res.status(200).json({ results });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/compare', async (req, res) => {
  try {
    if (Array.isArray(req.body?.pairs)) {
      const pairs = req.body.pairs;
      const changed = [];
      const newStories = [];

      for (const pair of pairs) {
        const storyId = pair?.story_id || 'unknown';
        const currentUrl = pair?.current_url;
        const baselineUrl = pair?.baseline_url;

        if (!isHttpUrl(currentUrl)) {
          continue;
        }

        if (!isHttpUrl(baselineUrl)) {
          newStories.push(storyId);
          continue;
        }

        try {
          const viewport = { width: 1440, height: 900 };
          const current = await captureScreenshot({
            url: currentUrl,
            viewport,
            fullPage: false,
            waitFor: 'networkidle',
          });

          const baseline = await captureScreenshot({
            url: baselineUrl,
            viewport,
            fullPage: false,
            waitFor: 'networkidle',
          });

          const diff = comparePngBuffers(
            Buffer.from(current.image, 'base64'),
            Buffer.from(baseline.image, 'base64'),
            0.1,
          );

          if (diff.changed_percentage > 0) {
            changed.push({
              story_id: storyId,
              diff_percentage: diff.changed_percentage,
            });
          }
        } catch {
          newStories.push(storyId);
        }
      }

      return res.status(200).json({
        changed,
        new_stories: [...new Set(newStories)],
        removed_baselines: [],
      });
    }

    const threshold = Number(req.body?.threshold ?? 0.1);
    const imageA = decodeBase64Png(req.body?.image_a);
    const imageB = decodeBase64Png(req.body?.image_b);

    const diff = comparePngBuffers(imageA, imageB, Number.isFinite(threshold) ? threshold : 0.1);
    return res.status(200).json(diff);
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/pdf', async (req, res) => {
  try {
    const { html, url, viewport: rawViewport, format = 'A4', landscape = false, margin } = req.body ?? {};

    if (!html && !url) {
      return res.status(400).json({ error: 'Either html or url is required' });
    }

    const viewport = normalizeViewport(rawViewport);
    const pdfBuffer = await withBrowserPage(viewport, async (page) => {
      if (html) {
        await page.setContent(html, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
      } else {
        if (!isHttpUrl(url)) throw new Error('A valid http(s) url is required');
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
      }

      return page.pdf({
        format,
        landscape: Boolean(landscape),
        margin: margin ?? { top: '0.5in', right: '0.5in', bottom: '0.5in', left: '0.5in' },
        printBackground: true,
      });
    });

    return res.status(200).json({
      pdf: pdfBuffer.toString('base64'),
      size_bytes: pdfBuffer.length,
    });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/audit', async (req, res) => {
  try {
    const url = req.body?.url;
    const type = req.body?.type;
    if (!isHttpUrl(url)) {
      return res.status(400).json({ error: 'A valid http(s) url is required' });
    }

    if (type !== 'accessibility') {
      return res.status(400).json({ error: `Unsupported audit type: ${type}` });
    }

    const violations = await withBrowserPage({ width: 1440, height: 900 }, async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

      const result = await new AxeBuilder({ page }).analyze();
      return result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        description: violation.description,
        helpUrl: violation.helpUrl,
        tags: violation.tags,
        nodes: violation.nodes.map((node) => ({
          html: node.html,
          target: node.target,
        })),
      }));
    });

    return res.status(200).json({ violations });
  } catch (error) {
    return res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`Playwright service listening on ${port}`);
});