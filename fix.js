const fs = require('fs');

const file = fs.readFileSync('index.js', 'utf8');

const correctTop = `const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const path = require('path');
const Groq = require('groq-sdk');
const multer = require('multer');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
const { selectSmartFrames } = require('./utils/smartFrameSelector');
const { sql, testConnection } = require('./db/index');
const prisma = require('./db/prisma');
const adminRouter = require('./routes/admin');
const adminAuthRouter = require('./routes/adminAuth');
const supportRouter = require('./routes/support');
const revenuecatWebhooks = require('./routes/revenuecat');
const userRouter = require('./routes/user');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { requireAuth, requireOwnership } = require('./middleware/clerkAuth');
const { sanitizeVideoUrl } = require('./utils/sanitize');
const { enqueueVideoJob, getQueueStats } = require('./utils/videoQueue');
const { getCachedAnalysis, setCachedAnalysis, getCacheStats } = require('./utils/analysisCache');
const { analyzeQueue } = require('./utils/queue');

dotenv.config();

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});

const app = express();
const port = process.env.PORT || 4000;

app.set('trust proxy', 1);

// Ensure uploads directory exists
const uploadsDir = process.env.UPLOAD_DIR || path.join(__dirname, 'uploads');
if (!require('fs').existsSync(uploadsDir)) {
  require('fs').mkdirSync(uploadsDir, { recursive: true });
}

const upload = multer({ 
  dest: uploadsDir,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

`;

const splitIndex = file.indexOf('app.use(cors({');
if (splitIndex !== -1) {
    const bottomPart = file.substring(splitIndex);
    fs.writeFileSync('index.js', correctTop + bottomPart);
    console.log("Fixed successfully.");
} else {
    console.error("Could not find cors setup!");
}
