/**
 * Validates and sanitizes a video URL before passing it to the frame extractor.
 * Blocks private IPs, localhost, and non-video domains to prevent SSRF attacks.
 */

const ALLOWED_DOMAINS = [
  'tiktok.com', 'www.tiktok.com', 'vm.tiktok.com',
  'instagram.com', 'www.instagram.com',
  'youtube.com', 'www.youtube.com', 'youtu.be',
  'twitter.com', 'x.com', 'www.twitter.com',
  'facebook.com', 'www.facebook.com', 'fb.watch',
  'reddit.com', 'www.reddit.com', 'v.redd.it',
  'tikwm.com', // our TikTok proxy
];

// Private/internal IP ranges to block (SSRF prevention)
const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

function sanitizeVideoUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { valid: false, error: 'URL is required' };
  }

  // Trim and limit length
  const url = rawUrl.trim().substring(0, 2048);

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return { valid: false, error: 'Invalid URL format' };
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { valid: false, error: 'Only HTTP/HTTPS URLs are allowed' };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block private IPs
  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return { valid: false, error: 'URL points to a restricted address' };
    }
  }

  // Check against allowed domains
  const isAllowed = ALLOWED_DOMAINS.some(domain =>
    hostname === domain || hostname.endsWith('.' + domain)
  );

  if (!isAllowed) {
    return { valid: false, error: `Domain not supported. Supported: TikTok, Instagram, YouTube, Twitter/X, Facebook, Reddit` };
  }

  return { valid: true, url };
}

module.exports = { sanitizeVideoUrl };
