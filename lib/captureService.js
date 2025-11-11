const fsPromises = require('fs/promises');
const path = require('path');
const os = require('os');
const { PassThrough } = require('stream');

const archiver = require('archiver');
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

chromium.setHeadlessMode = true;
chromium.setGraphicsMode = false;

const sanitizeForFilename = (value, fallback = 'page') => {
  return (value || '')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80)
    .toLowerCase() || fallback;
};

const ensureDirectory = async (targetPath) => {
  try {
    await fsPromises.mkdir(targetPath, { recursive: true });
  } catch (error) {
    throw new Error(`Unable to access destination directory: ${error.message}`);
  }
};

const launchBrowser = async () => {
  const executablePath = await chromium.executablePath();

  const launchArgs = [
    ...chromium.args,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu'
  ];

  return puppeteer.launch({
    args: launchArgs,
    defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
    executablePath,
    headless: 'new',  // ← これが重要。古いheadlessではLambdaで落ちる
    ignoreHTTPSErrors: true
  });
};




const applyAlphaToWhite = (rgbaBuffer) => {
  const totalPixels = rgbaBuffer.length / 4;
  const rgbBuffer = Buffer.alloc(totalPixels * 3);

  for (let i = 0; i < totalPixels; i += 1) {
    const rgbaIndex = i * 4;
    const rgbIndex = i * 3;
    const alpha = rgbaBuffer[rgbaIndex + 3] / 255;
    const inverseAlpha = 1 - alpha;

    rgbBuffer[rgbIndex] = Math.round(
      rgbaBuffer[rgbaIndex] * alpha + 255 * inverseAlpha
    );
    rgbBuffer[rgbIndex + 1] = Math.round(
      rgbaBuffer[rgbaIndex + 1] * alpha + 255 * inverseAlpha
    );
    rgbBuffer[rgbIndex + 2] = Math.round(
      rgbaBuffer[rgbaIndex + 2] * alpha + 255 * inverseAlpha
    );
  }

  return rgbBuffer;
};

const stitchSegments = (segments, width, totalHeight) => {
  const output = new PNG({ width, height: totalHeight });
  let currentTop = 0;

  segments.forEach(({ buffer }) => {
    const segmentImage = PNG.sync.read(buffer);
    const drawHeight = Math.min(segmentImage.height, totalHeight - currentTop);
    const drawWidth = Math.min(segmentImage.width, width);

    if (drawHeight > 0 && drawWidth > 0) {
      segmentImage.bitblt(output, 0, 0, drawWidth, drawHeight, 0, currentTop);
      currentTop += drawHeight;
    }
  });

  return output;
};

const encodeOutput = (pngImage, format) => {
  if (format === 'jpeg') {
    const rgbBuffer = applyAlphaToWhite(pngImage.data);
    return jpeg.encode(
      { data: rgbBuffer, width: pngImage.width, height: pngImage.height },
      85
    ).data;
  }

  return PNG.sync.write(pngImage);
};

const captureFullPage = async (page, format) => {
  const screenshotType = format === 'jpeg' ? 'jpeg' : 'png';

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
    return page.screenshot({
      fullPage: true,
      type: screenshotType,
      quality: format === 'jpeg' ? 85 : undefined,
      encoding: 'binary'
    });
  }

  const segments = [];
  let offset = 0;

  while (offset < totalHeight) {
    const clipHeight = Math.min(viewportHeight, totalHeight - offset);
    await page.evaluate((y) => window.scrollTo(0, y), offset);
    await page.waitForTimeout(200);
    const buffer = await page.screenshot({
      type: 'png',
      clip: { x: 0, y: 0, width: viewportWidth, height: clipHeight },
      encoding: 'binary'
    });
    segments.push({ buffer, height: clipHeight });
    offset += clipHeight;
  }

  await page.evaluate(() => window.scrollTo(0, 0));

  const stitched = stitchSegments(segments, viewportWidth, totalHeight);
  return encodeOutput(stitched, format);
};

const writeFileIfNeeded = async (destination, filename, buffer) => {
  if (!destination) return null;
  const filePath = path.join(destination, filename);
  await fsPromises.writeFile(filePath, buffer);
  return filePath;
};

const captureUrl = async (browser, url, destination, format, index) => {
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });
    const pageTitle = (await page.title()) || '';
    const baseName = sanitizeForFilename(
      pageTitle || new URL(url).hostname || `page-${index + 1}`
    );

    const extension = format === 'jpeg' ? 'jpg' : 'png';
    const filename = `${String(index + 1).padStart(2, '0')}-${baseName}.${extension}`;
    const buffer = await captureFullPage(page, format);
    const filePath = await writeFileIfNeeded(destination, filename, buffer);

    return { url, success: true, filename, filePath, buffer };
  } catch (error) {
    return { url, success: false, error: error.message };
  } finally {
    await page.close();
  }
};

const createArchiveBuffer = async (files, folderName) => {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = new PassThrough();
  const chunks = [];

  const manifest = {
    generatedAt: new Date().toISOString(),
    folder: folderName,
    files: files.map(({ filename, url, success, filePath, error }) => ({
      url,
      filename,
      success,
      filePath: filePath || null,
      error: error || null
    }))
  };

  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
    archive.on('error', reject);

    archive.pipe(stream);

    files.forEach((file) => {
      if (file.success && file.buffer) {
        archive.append(file.buffer, { name: `${folderName}/${file.filename}` });
      } else {
        const message = file.error || 'Unknown error';
        archive.append(message, {
          name: `${folderName}/${sanitizeForFilename(file.url, 'failed')}.txt`
        });
      }
    });

    archive.append(JSON.stringify(manifest, null, 2), {
      name: `${folderName}/manifest.json`
    });

    archive.finalize();
  });
};

const captureAll = async (urls, { format = 'png', destination, allowDiskWrites = true } = {}) => {
  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    throw new Error('Please provide one or more URLs.');
  }

  const normalizedFormat = format === 'jpeg' ? 'jpeg' : 'png';

  const sanitizedDestinationLabel = destination
    ? sanitizeForFilename(path.basename(destination))
    : null;

  let resolvedDestination = null;
  if (allowDiskWrites && destination) {
    resolvedDestination = path.isAbsolute(destination)
      ? destination
      : path.resolve(process.cwd(), destination);
    await ensureDirectory(resolvedDestination);
  }

  const archiveFolder = sanitizedDestinationLabel || `screenshots-${Date.now()}`;

  let browser;
  const results = [];

  try {
    browser = await launchBrowser();

    for (let i = 0; i < urls.length; i += 1) {
      const currentUrl = urls[i];
      if (!currentUrl) continue;

      try {
        // Throws if invalid
        new URL(currentUrl);
      } catch (error) {
        results.push({
          url: currentUrl,
          success: false,
          error: 'Invalid URL'
        });
        continue;
      }

      const result = await captureUrl(
        browser,
        currentUrl,
        resolvedDestination,
        normalizedFormat,
        i
      );
      results.push(result);
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  const archiveBuffer = await createArchiveBuffer(results, archiveFolder);

  return {
    results: results.map(({ buffer, ...rest }) => rest),
    archiveBuffer,
    archiveFolder,
    savedTo: resolvedDestination
  };
};

const getTemporaryDestination = (label) => {
  const base = sanitizeForFilename(label, 'captures');
  return path.join(os.tmpdir(), base);
};

module.exports = {
  captureAll,
  ensureDirectory,
  sanitizeForFilename,
  getTemporaryDestination
};
