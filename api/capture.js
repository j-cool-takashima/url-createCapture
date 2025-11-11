const os = require('os');
const path = require('path');

const { captureAll, sanitizeForFilename } = require('../lib/captureService');

const MAX_BODY_SIZE = 1 * 1024 * 1024; // 1MB

const readRequestBody = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    let size = 0;

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        reject(new Error('Payload too large.'));
        req.destroy();
        return;
      }
      body += chunk;
    });

    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON payload.'));
      }
    });

    req.on('error', (error) => reject(error));
  });

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  let body;
  try {
    body = await readRequestBody(req);
  } catch (error) {
    res.statusCode = error.message === 'Payload too large.' ? 413 : 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error.message }));
    return;
  }

  const { urls, format = 'png', destination } = body;

  const folderLabel = typeof destination === 'string' && destination.trim()
    ? destination.trim()
    : 'captures';

  const temporaryDestination = path.join(
    os.tmpdir(),
    sanitizeForFilename(folderLabel, 'captures')
  );

  try {
    const { results, archiveBuffer, archiveFolder } = await captureAll(urls, {
      format,
      destination: temporaryDestination,
      allowDiskWrites: false
    });

    res.setHeader('Content-Type', 'application/json');
    res.status(200).end(
      JSON.stringify({
        success: true,
        results,
        archiveFileName: `${archiveFolder}.zip`,
        archive: archiveBuffer.toString('base64')
      })
    );
  } catch (error) {
    const statusCode = /Please provide one or more URLs\./.test(error.message)
      ? 400
      : 500;
    res.setHeader('Content-Type', 'application/json');
    res.status(statusCode).end(
      JSON.stringify({ error: error.message || 'Capture process failed.' })
    );
  }
};
