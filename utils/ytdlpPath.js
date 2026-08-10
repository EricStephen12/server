const fs = require('fs');
const path = require('path');

/**
 * Resolve yt-dlp binary for frame/audio extraction.
 * Order: env override → postinstall bin/ → bundled exe → common system paths → PATH.
 */
function resolveYtdlpPath() {
  const root = path.join(__dirname, '..');
  const binName = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';

  const candidates = [
    process.env.YTDLP_PATH,
    path.join(root, 'bin', binName),
    path.join(root, 'yt-dlp.exe'),
    '/usr/local/bin/yt-dlp',
    '/usr/bin/yt-dlp',
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).size > 1000) {
        return candidate;
      }
    } catch {
      /* try next */
    }
  }

  return 'yt-dlp';
}

function ytdlpReady() {
  const resolved = resolveYtdlpPath();
  if (resolved === 'yt-dlp') return { ready: false, path: resolved, reason: 'not installed (PATH lookup only)' };
  try {
    return { ready: fs.existsSync(resolved) && fs.statSync(resolved).size > 1000, path: resolved };
  } catch (err) {
    return { ready: false, path: resolved, reason: err.message };
  }
}

module.exports = { resolveYtdlpPath, ytdlpReady };
