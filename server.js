const express = require('express');
const path = require('path');

const { captureAll } = require('./lib/captureService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const captureHandler = async (req, res) => {
  const { urls, format = 'png', destination } = req.body || {};

  if (!destination || typeof destination !== 'string') {
    return res.status(400).json({ error: 'Please provide a destination folder path.' });
  }

  try {
    const { results, archiveBuffer, archiveFolder, savedTo } = await captureAll(urls, {
      format,
      destination,
      allowDiskWrites: true
    });

    res.json({
      success: true,
      results,
      savedTo,
      archiveFileName: `${archiveFolder}.zip`,
      archive: archiveBuffer.toString('base64')
    });
  } catch (error) {
    const statusCode = /Please provide one or more URLs\./.test(error.message)
      ? 400
      : 500;
    res.status(statusCode).json({ error: error.message || 'Capture process failed.' });
  }
};

app.post('/capture', captureHandler);
app.post('/api/capture', captureHandler);

app.listen(PORT, () => {
  console.log(`Screenshot service running at http://localhost:${PORT}`);
});
