const express = require('express');
const path = require('path');
const fsPromises = require('fs/promises');
const puppeteer = require('puppeteer');
const sharp = require('sharp');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sanitizeForFilename = (value) => {
  return value
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .toLowerCase() || 'page';
};

const ensureDirectory = async (targetPath) => {
  try {
    await fsPromises.mkdir(targetPath, { recursive: true });
  } catch (error) {
    console.error(`Failed to ensure directory at ${targetPath}`, error);
    throw new Error('Unable to access destination directory');
  }
};

const captureFullPage = async (page, filePath, format) => {
  const screenshotType = format === 'jpeg' ? 'jpeg' : 'png';
  const quality = format === 'jpeg' ? 85 : undefined;

  const metrics = await page.evaluate(() => {
    const body = document.body;
    const html = document.documentElement;
    const totalHeight = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );
    return {
      totalHeight,
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth
    };
  });

  const { totalHeight, viewportHeight, viewportWidth } = metrics;

  if (totalHeight <= 16384) {
    await page.screenshot({
      path: filePath,
      fullPage: true,
      type: screenshotType,
      quality
    });
    return;
  }

  console.log(`    Page is tall (${totalHeight}px). Capturing in segments...`);
  const segments = [];
  let offset = 0;

  while (offset < totalHeight) {
    const clipHeight = Math.min(viewportHeight, totalHeight - offset);
    await page.evaluate((y) => window.scrollTo(0, y), offset);
    await page.waitForTimeout(200);
    const buffer = await page.screenshot({
      type: screenshotType,
      clip: { x: 0, y: 0, width: viewportWidth, height: clipHeight },
      quality
    });
    segments.push({ buffer, height: clipHeight });
    offset += clipHeight;
  }

  const background = screenshotType === 'png'
    ? { r: 255, g: 255, b: 255, alpha: 0 }
    : { r: 255, g: 255, b: 255, alpha: 1 };

  const composite = sharp({
    create: {
      width: viewportWidth,
      height: totalHeight,
      channels: 4,
      background
    }
  });

  let currentTop = 0;
  const layers = segments.map(({ buffer, height }) => {
    const layer = { input: buffer, top: currentTop, left: 0 };
    currentTop += height;
    return layer;
  });

  let output = composite.composite(layers);
  output = screenshotType === 'jpeg' ? output.jpeg({ quality }) : output.png();
  await output.toFile(filePath);
  await page.evaluate(() => window.scrollTo(0, 0));
};

const captureUrl = async (browser, url, destination, format, index) => {
  console.log(`> Starting capture for ${url}`);
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const pageTitle = (await page.title()) || '';
    const baseName = sanitizeForFilename(
      pageTitle || new URL(url).hostname || `page-${index + 1}`
    );

    const extension = format === 'jpeg' ? 'jpg' : 'png';
    const filename = `${String(index + 1).padStart(2, '0')}-${baseName}.${extension}`;
    const filePath = path.join(destination, filename);

    await captureFullPage(page, filePath, format);
    console.log(`> Finished capture for ${url}. Saved to ${filePath}`);
    return { url, filePath, success: true };
  } catch (error) {
    console.error(`> Failed to capture ${url}:`, error.message);
    return { url, error: error.message, success: false };
  } finally {
    await page.close();
  }
};

app.post('/capture', async (req, res) => {
  const { urls, format = 'png', destination } = req.body || {};

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return res.status(400).json({ error: 'Please provide one or more URLs.' });
  }

  if (!destination || typeof destination !== 'string') {
    return res.status(400).json({ error: 'Please provide a destination folder path.' });
  }

  const normalizedFormat = format === 'jpeg' ? 'jpeg' : 'png';
  const resolvedDestination = path.isAbsolute(destination)
    ? destination
    : path.resolve(process.cwd(), destination);

  console.log(`Preparing to capture ${urls.length} URL(s).`);
  console.log(`Saving screenshots as ${normalizedFormat.toUpperCase()} in ${resolvedDestination}`);

  try {
    await ensureDirectory(resolvedDestination);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  let browser;
  try {
    browser = await puppeteer.launch({ headless: true });
    const results = [];
    for (let i = 0; i < urls.length; i += 1) {
      const currentUrl = urls[i];
      if (!currentUrl) continue;
      try {
        new URL(currentUrl);
      } catch (error) {
        console.error(`> Skipping invalid URL: ${currentUrl}`);
        results.push({ url: currentUrl, success: false, error: 'Invalid URL' });
        continue;
      }

      const result = await captureUrl(browser, currentUrl, resolvedDestination, normalizedFormat, i);
      results.push(result);
    }

    console.log('All captures complete.');
    res.json({ success: true, results });
  } catch (error) {
    console.error('Capture process failed:', error);
    res.status(500).json({ error: 'Capture process failed. Check server logs for details.' });
  } finally {
    if (browser) {
      await browser.close();
    }
  }
});

app.listen(PORT, () => {
  console.log(`Screenshot service running at http://localhost:${PORT}`);
});
