// server.js (Vercelでは不要・ローカルテスト専用)
if (process.env.VERCEL) {
  console.log("Running on Vercel – Express server disabled.");
  process.exit(0);
}

const express = require('express');
const path = require('path');
const { captureAll } = require('./lib/captureService');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/capture', async (req, res) => {
  const { urls, format = 'png', destination } = req.body || {};
  if (!destination || typeof destination !== 'string') {
    return res.status(400).json({ error: 'Please provide a destination folder path.' });
  }

  try {
    const { results, archiveBuffer, archiveFolder } = await captureAll(urls, {
      format,
      destination,
      allowDiskWrites: true
    });

    res.json({
      success: true,
      results,
      archiveFileName: `${archiveFolder}.zip`,
      archive: archiveBuffer.toString('base64')
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Local test server running at http://localhost:${PORT}`);
});

