/**
 * Ensures yt-dlp is present for video URL resolution on deploy (Railway/Modal/local).
 * Skips download when a valid binary already exists.
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const root = path.join(__dirname, '..');
const binDir = path.join(root, 'bin');
const isWin = process.platform === 'win32';
const dest = path.join(binDir, isWin ? 'yt-dlp.exe' : 'yt-dlp');
const releaseUrl = isWin
  ? 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe'
  : 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp';

function isValidBinary(filePath) {
  try {
    return fs.existsSync(filePath) && fs.statSync(filePath).size > 100_000;
  } catch {
    return false;
  }
}

function download(url, outPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outPath);
    const req = https.get(url, { headers: { 'User-Agent': 'eixora-server' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close();
        fs.unlink(outPath, () => {});
        download(res.headers.location, outPath).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        file.close();
        fs.unlink(outPath, () => {});
        reject(new Error(`yt-dlp download HTTP ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => file.close(resolve));
    });
    req.on('error', (err) => {
      file.close();
      fs.unlink(outPath, () => {});
      reject(err);
    });
    req.setTimeout(120_000, () => req.destroy(new Error('yt-dlp download timed out')));
  });
}

async function main() {
  if (process.env.SKIP_YTDLP_INSTALL === '1') {
    console.log('[ensure-ytdlp] SKIP_YTDLP_INSTALL=1 — skipping');
    return;
  }

  const bundled = path.join(root, 'yt-dlp.exe');
  if (isValidBinary(dest)) {
    console.log('[ensure-ytdlp] OK:', dest);
    return;
  }
  if (isWin && isValidBinary(bundled)) {
    console.log('[ensure-ytdlp] using bundled', bundled);
    return;
  }

  if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });

  console.log('[ensure-ytdlp] downloading →', dest);
  await download(releaseUrl, dest);
  if (!isValidBinary(dest)) {
    throw new Error('[ensure-ytdlp] download finished but binary looks invalid');
  }
  if (!isWin) fs.chmodSync(dest, 0o755);
  console.log('[ensure-ytdlp] installed', dest, `(${fs.statSync(dest).size} bytes)`);
}

main().catch((err) => {
  console.warn('[ensure-ytdlp] failed (TikTok/URL fallback may break):', err.message);
  process.exit(0);
});
