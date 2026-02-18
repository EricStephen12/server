const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { extractFrames } = require('./utils/frameExtractor');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(express.json());

// Supabase Connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

// Initialize Supabase only if valid URL is provided
let supabase;
try {
  if (supabaseUrl && supabaseUrl.startsWith('http')) {
    supabase = createClient(supabaseUrl, supabaseKey);
  } else {
    console.warn('Skipping Supabase initialization: Invalid or missing URL');
  }
} catch (err) {
  console.error('Failed to initialize Supabase client:', err.message);
}

// Groq Connection
let groq;
try {
  if (process.env.GROQ_API_KEY) {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY
    });
  } else {
    console.warn('WARNING: GROQ_API_KEY is missing in .env file');
  }
} catch (err) {
  console.warn('Groq initialization failed:', err.message);
}

// Routes
// Health Check
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    message: 'Server is running.',
    groq_configured: !!groq,
    gemini_configured: !!genAI
  });
});

// Proxy Pollinations Image Generation (Securely with Secret Key)
app.get('/api/generate-image', async (req, res) => {
  const { prompt, seed } = req.query;
  if (!prompt) return res.status(400).send('Prompt required');

  const apiKey = process.env.POLLINATIONS_API_KEY;
  const s = seed || Math.floor(Math.random() * 1000000);
  const pollinationsUrl = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}?model=nanobanana&width=1024&height=1024&seed=${s}&nologo=true&key=${apiKey}`;

  try {
    console.log(`🎨 Proxying Nano Banana: "${prompt.substring(0, 50)}..."`);
    const response = await fetch(pollinationsUrl);

    if (!response.ok) {
      throw new Error(`Pollinations API error: ${response.status}`);
    }

    const buffer = await response.arrayBuffer();
    res.set('Content-Type', 'image/jpeg');
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('Pollinations Proxy Failed:', err.message);
    res.status(500).send('Image generation failed');
  }
});

// Private Vault - Save analyzed video to user collection
app.post('/api/save-to-vault', async (req, res) => {
  const { userId, title, videoUrl, visualDna } = req.body;

  if (!userId || !videoUrl) {
    return res.status(400).json({ error: 'User ID and Video URL are required' });
  }

  try {
    const { data, error } = await supabase
      .from('user_ads')
      .insert({
        user_id: userId,
        title: title || 'Saved Ad',
        video_url: videoUrl,
        visual_dna: visualDna
      })
      .select()
      .single();

    if (error) throw error;

    res.json({ success: true, ad: data });
  } catch (error) {
    console.error('Save to vault error:', error);
    res.status(500).json({ error: 'Failed to save to vault' });
  }
});

// STANDALONE VIDEO ANALYSIS ENDPOINT
// Private Vault - Fetch user's saved ads
app.get('/api/user-ads', async (req, res) => {
  const { userId, search, niche } = req.query;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    let query = supabase
      .from('user_ads')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (search) {
      query = query.ilike('title', `%${search}%`);
    } else if (niche && niche !== 'all') {
      query = query.eq('niche', niche);
    }

    const { data: ads, error } = await query;
    if (error) throw error;

    const formattedAds = ads.map(ad => ({
      id: ad.id,
      niche: ad.niche || 'custom',
      thumbnail: ad.thumbnail_url || 'https://via.placeholder.com/300x500?text=Vault+Ad',
      videoUrl: ad.video_url,
      title: ad.title,
      engagement: {
        views: 'N/A',
        likes: 'N/A',
        comments: '0'
      },
      date: new Date(ad.created_at).toISOString().split('T')[0],
      visual_dna: ad.visual_dna
    }));

    res.json(formattedAds);
  } catch (error) {
    console.error('Error fetching user ads:', error);
    res.status(500).json({ error: 'Failed to fetch user ads' });
  }
});

// STANDALONE VIDEO ANALYSIS ENDPOINT
app.post('/api/analyze-video', async (req, res) => {
  const { videoUrl, productName, description } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return res.status(503).json({ error: 'Gemini API not configured' });
  }

  try {
    console.log('🎥 Extracting frames from video...');
    const frames = await extractFrames(videoUrl);

    console.log('🔍 Analyzing frames with Gemini Vision...');
    const productContext = productName && description
      ? `Product: ${productName} - ${description}`
      : '';

    const analysis = await analyzeVideoFrames(frames, productContext);

    console.log('✅ Video analysis complete');
    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length
    });

  } catch (error) {
    console.error('Video analysis error:', error);
    res.status(500).json({
      error: 'Video analysis failed',
      details: error.message
    });
  }
});

app.post('/api/generate-script', async (req, res) => {
  const { productName, description, adId, answers, privateDna } = req.body;

  if (!productName || !description) {
    return res.status(400).json({ error: 'Product name and description are required' });
  }

  if (!groq) {
    return res.status(503).json({ error: 'AI service not available (API Key Missing)' });
  }

  try {
    let contextPrompt = "";
    let visualAnalysis = null;

    // If adId is provided, fetch the winning ad and use its DNA
    if (adId) {
      const { data: adData } = await supabase.from('ads').select('*').eq('id', adId).single();

      if (adData) {
        // PRIORITY 1: Use pre-processed Visual DNA (Instant & 100% Reliable)
        if (adData.visual_dna) {
          console.log(`🧠 Using pre-processed DNA for ad: ${adData.title}`);
          const dna = adData.visual_dna;
          contextPrompt = `
            WINNING AD VISUAL DNA (REPLICATE THIS EXACT STRUCTURE):
            
            **Hook (0-3s):**
            ${dna.hook_analysis.visual_description}
            Camera Work: ${dna.hook_analysis.camera_work}
            Subject Action: ${dna.hook_analysis.subject_action}
            Energy: ${dna.hook_analysis.energy_level}
            ${dna.hook_analysis.text_overlays ? `Text Overlays: ${dna.hook_analysis.text_overlays}` : ''}
            
            **Problem Scene (3-8s):**
            ${dna.problem_scene.visual_approach}
            Transitions: ${dna.problem_scene.transitions}
            Emotional Cues: ${dna.problem_scene.emotional_cues}
            
            **Solution Scene (8-15s):**
            Product Demo Style: ${dna.solution_scene.product_demo_style}
            Visual Proof: ${dna.solution_scene.visual_proof}
            Pacing: ${dna.solution_scene.pacing}
            
            **CTA Scene (15s+):**
            ${dna.cta_scene.closing_visual}
            CTA Presentation: ${dna.cta_scene.cta_presentation}
            
            **Overall Style:**
            Lighting: ${dna.overall_style.lighting}
            Color Palette: ${dna.overall_style.color_palette}
            Editing Pace: ${dna.overall_style.editing_pace}
            
            **ACTIONABLE DIRECTIONS:**
            ${dna.actionable_directions ? dna.actionable_directions.map((dir, i) => `${i + 1}. ${dir}`).join('\n') : "Copy the visual flow exactly."}
            
            CRITICAL INSTRUCTION: 
            Copy the EXACT visual structure, camera work, and pacing from the DNA above.
            Adapt it for "${productName}" while maintaining the same winning energy.
            Your script must be SPECIFIC and ACTIONABLE.
            `;
        }
        // PRIORITY 2: Fallback to real-time analysis (Slow & potentially unreliable)
        else if (adData.video_url && process.env.GEMINI_API_KEY) {
          try {
            console.log(`🎥 Falling back to real-time analysis for: ${adData.title}`);
            const frames = await extractFrames(adData.video_url);
            visualAnalysis = await analyzeVideoFrames(frames, `${productName} - ${description}`);
            console.log('✅ Video analysis complete');

            // Build context from visual analysis
            contextPrompt = `
            WINNING AD VISUAL ANALYSIS (REPLICATE THIS EXACT STRUCTURE):
            
            **Hook (0-3s):**
            ${visualAnalysis.hook_analysis.visual_description}
            Camera Work: ${visualAnalysis.hook_analysis.camera_work}
            Subject Action: ${visualAnalysis.hook_analysis.subject_action}
            Energy: ${visualAnalysis.hook_analysis.energy_level}
            ${visualAnalysis.hook_analysis.text_overlays ? `Text Overlays: ${visualAnalysis.hook_analysis.text_overlays}` : ''}
            
            **Problem Scene (3-8s):**
            ${visualAnalysis.problem_scene.visual_approach}
            Transitions: ${visualAnalysis.problem_scene.transitions}
            Emotional Cues: ${visualAnalysis.problem_scene.emotional_cues}
            
            **Solution Scene (8-15s):**
            Product Demo Style: ${visualAnalysis.solution_scene.product_demo_style}
            Visual Proof: ${visualAnalysis.solution_scene.visual_proof}
            Pacing: ${visualAnalysis.solution_scene.pacing}
            
            **CTA Scene (15s+):**
            ${visualAnalysis.cta_scene.closing_visual}
            CTA Presentation: ${visualAnalysis.cta_scene.cta_presentation}
            
            **Overall Style:**
            Lighting: ${visualAnalysis.overall_style.lighting}
            Color Palette: ${visualAnalysis.overall_style.color_palette}
            Editing Pace: ${visualAnalysis.overall_style.editing_pace}
            
            **ACTIONABLE DIRECTIONS:**
            ${visualAnalysis.actionable_directions.map((dir, i) => `${i + 1}. ${dir}`).join('\n')}
            
            STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
            ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

            CRITICAL INSTRUCTION: 
            Copy the EXACT visual structure, camera work, and pacing from the analysis above.
            Adapt it for "${productName}" while maintaining the same energy, timing, and visual approach.
            Your script must be SPECIFIC and ACTIONABLE - the user should know exactly what to film.
            `;
          } catch (visionError) {
            console.error('Video analysis failed, falling back to text analysis:', visionError.message);
            // Fall back to basic text analysis if video analysis fails
            if (adData.analysis) {
              contextPrompt = `
              WINNING AD STRUCTURE (REPLICATE THIS):
              - Original Hook Logic: "${adData.analysis.hook}"
              - Original Problem Logic: "${adData.analysis.problem}"
              - Original Solution Logic: "${adData.analysis.solution}"
              
              STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
              ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

              INSTRUCTION: Reuse the same psychological pattern and pacing as the Winning Ad "${adData.title}", but rewrite it specifically for the user's product (${productName}).
              IMPORTANT: Incorporate the Strategic Interview Context above to ensure the script matches the user's specific angle/preferences.
              `;
            }
          }
        } else if (adData.analysis) {
          // No video URL or Gemini not configured, use basic analysis
          contextPrompt = `
          WINNING AD STRUCTURE (REPLICATE THIS):
          - Original Hook Logic: "${adData.analysis.hook}"
          - Original Problem Logic: "${adData.analysis.problem}"
          - Original Solution Logic: "${adData.analysis.solution}"
          
          STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
          ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

          INSTRUCTION: Reuse the same psychological pattern and pacing as the Winning Ad "${adData.title}", but rewrite it specifically for the user's product (${productName}).
          IMPORTANT: Incorporate the Strategic Interview Context above to ensure the script matches the user's specific angle/preferences.
          `;
        }
      }
    } else if (privateDna) {
      contextPrompt = `
            PRIVATE VIDEO DNA STRUCTURE (REPLICATE THIS):
            - Original Hook Logic: "${privateDna.hook}"
            - Original Problem Logic: "${privateDna.problem}"
            - Original Solution Logic: "${privateDna.solution}"
            
            STRATEGIC INTERVIEW CONTEXT (USER PREFERENCES):
            ${answers && Array.isArray(answers) ? answers.map((a, i) => `Question ${i + 1} Answer: ${a}`).join('\n') : "No specific interview context provided."}

            INSTRUCTION: Reuse the same psychological pattern and pacing from the analyzed video, but rewrite it specifically for the user's product (${productName}).
            IMPORTANT: Incorporate the Strategic Interview Context above to ensure the script matches the user's specific angle/preferences.
            `;
    }

    const prompt = `
        ${contextPrompt}

        User Product: ${productName}
        Description: ${description}

        INSPIRATION MODE: REPRODUCE THE MAGIC.
        The user chose this source ad because it is a "Viral Winner". 
        Your job is to deconstruct why it won and RECREATE that same winning energy for the new product.

        - **Psychological Mirroring**: If the original used "Relatability" as a hook, find a Relatable hook for '${productName}'. 
        - **Visual Pacing**: Use the exact same storytelling arc (e.g. 2s Hook -> 5s Problem -> 10s Solution).
        - **Creative Parity**: The goal is to make a new ad that feels like it was made by the same Artistic Director as the original.

        Generate an Agency-Grade Viral Production Guide.
        Output JSON only: { 
            "summary": {
                "hook": "...", 
                "problem": "...", 
                "solution": "...", 
                "cta": "..."
            },
            "shot_list": [
                { 
                    "time": "...", 
                    "shot": "...", 
                    "visual": "Direct instructions to replicate the exact movement/lighting/energy of the source ad's corresponding scene.", 
                    "audio": "...", 
                    "text_overlay": "..." 
                }
            ],
            "aesthetic_guide": {
                "lighting": "Mimic source ad cinematography",
                "music_vibe": "Mimic source ad emotional frequency",
                "color_palette": "Mimic source ad visual mood"
            }
        }

        IMPORTANT: Replicate the EXACT visual pacing and transition style of the winning ad "${adId}". Preserve the SOUL of the creative while changing the product.
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    const fullGuide = JSON.parse(completion.choices[0]?.message?.content || '{}');
    const scriptContent = fullGuide.summary || fullGuide; // Backward compatibility for DB save

    // Save to Supabase if connected
    if (supabase) {
      try {
        await supabase.from('scripts').insert([
          {
            product_name: productName,
            description: description,
            script_content: scriptContent,
            created_at: new Date()
          }
        ]);
      } catch (dbErr) {
        console.error('Failed to save to Supabase:', dbErr);
      }
    }

    // Increment total_scripts in profiles
    if (supabase && req.body.userId) {
      try {
        await supabase.rpc('increment_profile_stat', {
          user_id: req.body.userId,
          stat_column: 'total_scripts'
        });
      } catch (statErr) {
        console.error('Failed to increment scripts stat:', statErr);
      }
    }

    res.json(fullGuide);

  } catch (error) {
    console.error('Groq Error:', error);
    res.status(500).json({ error: 'Failed to generate script', details: error.message });
  }
});

// Helper function to format numbers (e.g., 12345 -> 12.3K)
const formatNumber = (num) => {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  }
  return num.toString();
};

// Endpoint to fetch ads
app.get('/api/ads', async (req, res) => {
  const { niche, search, verifiedOnly } = req.query;

  try {
    let query = supabase.from('ads').select('*').order('created_at', { ascending: false });

    if (verifiedOnly === 'true') {
      query = query.eq('is_verified', true);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,niche.ilike.%${search}%`);
    } else if (niche && niche !== 'all') {
      query = query.eq('niche', niche);
    }

    const { data: ads, error } = await query;
    if (error) throw error;

    const formattedAds = ads.map(ad => ({
      id: ad.id,
      niche: ad.niche,
      thumbnail: ad.thumbnail_url,
      videoUrl: ad.video_url,
      title: ad.title,
      engagement: {
        views: formatNumber(ad.views_count || 0),
        likes: formatNumber(ad.likes_count || 0),
        comments: '0'
      },
      date: new Date(ad.created_at).toISOString().split('T')[0]
    }));

    res.json(formattedAds);
  } catch (error) {
    console.error('Error fetching ads:', error);
    res.status(500).json({ error: 'Failed to fetch ads' });
  }
});

app.post('/api/script-strategy-questions', async (req, res) => {
  const { adId, productName, description, privateDna } = req.body;

  if (!adId && !privateDna) return res.status(400).json({ error: 'Ad ID or Private DNA is required' });

  try {
    let adData = { title: "Private Analysis", niche: "custom" };
    let visualContext = "";

    if (adId) {
      const { data } = await supabase.from('ads').select('*').eq('id', adId).single();
      if (data) adData = data;
      console.log(`🧠 Remixing Ad Library Video: ${adData.title}`);

      if (adData.analysis && adData.analysis.hook) {
        visualContext = `
          VISUAL ANALYSIS (FROM PREVIOUS SCAN):
          - Hook: ${adData.analysis.hook}
          - Problem: ${adData.analysis.problem}
          - Solution: ${adData.analysis.solution}
        `;
      } else {
        visualContext = `
            AD CONTEXT:
            - Title: ${adData.title}
            - Niche: ${adData.niche}
        `;
      }
    } else if (privateDna) {
      console.log(`🧠 Remixing Private Video. DNA niche: ${privateDna.niche}`);
      visualContext = `
            PRIVATE VIDEO DNA (PREVIOUSLY ANALYZED):
            - Critique Hook: ${privateDna.hook}
            - Critique Problem/Pacing: ${privateDna.problem}
            - Critique Solution/CTA: ${privateDna.solution}
        `;
    }

    const prompt = `
      You are an Elite Viral Direct-Response Expert. 
      We are analyzing a high-performing ad: "${adData.title}".
      ${visualContext}
      
      The Objective: Guide the user to "Remix" this winner for their product: "${productName}".
      
      Generate 3 strategic internal-monologue style questions that extract the "Secrets" needed to bridge the original ad's psychology to this new product.
      Example: "The original ad relied on a 'messy room' relatable start. Do you have a relatable messy or stressful environment we can use, or should we go with a 'clean/minimalist' aesthetic for your brand?"

      Return JSON: { 
        "questions": ["q1", "q2", "q3"],
        "viral_blueprint": "Concise summary of why the original ad won (pacing, hook style, psychological trigger)",
        "analysis_logs": [
          "Deconstructing hook chemistry...",
          "Mapping emotional frequency...",
          "Extracting visual retention triggers...",
          "Syncing with ${adData.niche} viral trends..."
        ]
      }
    `;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: prompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    });

    res.json(JSON.parse(completion.choices[0]?.message?.content || '{"questions": [], "analysis_logs": []}'));
  } catch (error) {
    console.error('Questions error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Google Gemini Connection (For Vision/Images)
let genAI;
try {
  if (process.env.GEMINI_API_KEY) {
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  } else {
    console.warn('WARNING: GEMINI_API_KEY is missing in .env file');
  }
} catch (err) {
  console.warn('Gemini initialization failed:', err.message);
}

app.post('/api/generate-content', async (req, res) => {
  const { productName, description, imageBase64 } = req.body;

  if (!productName || !description) {
    return res.status(400).json({ error: 'Product name and description default required' });
  }

  // Clean base64 string if needed
  const imagePart = imageBase64 ? {
    inlineData: {
      data: imageBase64.split(',')[1] || imageBase64,
      mimeType: "image/jpeg",
    },
  } : null;

  try {
    let aiData = {};

    if (imageBase64 && genAI) {
      console.log("🔮 Using Google Gemini Vision to analyze image...");
      try {
        const models = ["gemini-flash-latest", "gemini-1.5-flash"];
        let result;
        for (const m of models) {
          try {
            console.log(`Trying model: ${m}...`);
            const model = genAI.getGenerativeModel({ model: m });
            result = await model.generateContent([`
              Analyze this product photo for high-end social media marketing.
              Product: ${productName}
              Description: ${description}
              
              Return ONLY valid JSON:
              {
                "pinterest_title": "string",
                "instagram_caption": "string with emojis",
                "hashtags": ["string"],
                "color_palette": ["hex"],
                "aesthetic_score": number 1-10
              }
            `, imagePart]);
            if (result) break;
          } catch (e) {
            console.warn(`Model ${m} failed: ${e.message}`);
          }
        }

        if (result) {
          const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
          aiData = JSON.parse(text);
        } else {
          throw new Error("No Gemini models available for vision analysis.");
        }
      } catch (geminiError) {
        console.error("Gemini failed, falling back to text analysis:", geminiError.message);
        aiData = {
          pinterest_title: `${productName} Moodboard`,
          instagram_caption: `Discover the elegance of ${productName}. ✨`,
          hashtags: ["aesthetic", "musthave", "trending"],
          color_palette: ["#1a1a1a", "#f5f5f5", "#d4d4d4"],
          aesthetic_score: 9.5
        };
      }

    } else if (groq) {
      console.log("⚡ Using Groq (Text Only) for content...");
      const prompt = `
            Generate social media content for:
            Product: ${productName} - ${description}
            
            Return JSON with:
            - pinterest_title (catchy)
            - instagram_caption (viral style with emojis)
            - hashtags (5-10, string array)
            - color_palette (suggest 3 aesthetic hex codes, string array)
            - aesthetic_score (1-10 number)
         `;

      const completion = await groq.chat.completions.create({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        response_format: { type: "json_object" },
      });
      aiData = JSON.parse(completion.choices[0]?.message?.content || '{}');
    }

    // Generate Visual Assets via Secure Backend Proxy
    const generateImage = (keyword) => {
      const seed = Math.floor(Math.random() * 1000000);
      const promptText = `Professional high-end product photography of ${productName}, ${keyword}, premium lighting, 8k, photorealistic, sharp focus, clean background`;
      return `${BASE_URL}/api/generate-image?prompt=${encodeURIComponent(promptText)}&seed=${seed}`;
    };

    const responseData = {
      pinterest: [
        { id: 1, url: generateImage("lifestyle aesthetic flatlay"), title: aiData.pinterest_title || 'Viral Pin' },
        { id: 2, url: generateImage("minimalist editorial display"), title: 'Editorial Choice' },
        { id: 3, url: generateImage("macro detailed product shot"), title: 'Detail View' },
      ],
      instagram: [
        { id: 1, url: generateImage("trending social media feed post"), caption: aiData.instagram_caption || `You need this ${productName}! 💸` },
        { id: 2, url: generateImage("high-end organic UGC lifestyle"), caption: `${productName} vibes ✨` },
      ],
      ai_analysis: aiData
    };

    // Increment total_pins in profiles
    if (supabase && req.body.userId) {
      try {
        await supabase.rpc('increment_profile_stat', {
          user_id: req.body.userId,
          stat_column: 'total_pins'
        });
      } catch (statErr) {
        console.error('Failed to increment pins stat:', statErr);
      }
    }

    console.log("🚀 Synthesis complete. Sending response.");
    res.json(responseData);

  } catch (error) {
    console.error('CRITICAL AI Gen Error:', error);

    const fallbackImage = (k) => `${BASE_URL}/api/generate-image?prompt=${encodeURIComponent(productName + " " + k)}`;

    res.json({
      pinterest: [{ id: 101, url: fallbackImage("aesthetic"), title: productName }],
      instagram: [{ id: 101, url: fallbackImage("product"), caption: `Check out ${productName}!` }],
      ai_analysis: { aesthetic_score: "N/A", color_palette: [], hashtags: [] },
      error: "AI generation hit a snag, but we synthesized basic assets."
    });
  }
});

// Apify Connection
const { ApifyClient } = require('apify-client');
let apifyClient;
if (process.env.APIFY_API_TOKEN) {
  apifyClient = new ApifyClient({
    token: process.env.APIFY_API_TOKEN,
  });
}

app.post('/api/scrape-ads', async (req, res) => {
  const { niche, searchQuery } = req.body;

  if (!apifyClient) {
    return res.status(503).json({ error: 'Apify client not configured' });
  }

  try {
    const searchTerm = searchQuery || niche || 'dropshipping';
    // Convert to hashtag format (remove spaces, lowercase) for reliability
    const hashtag = searchTerm.replace(/\s+/g, '').toLowerCase();

    console.log(`🕷️ Starting scrape for hashtag: #${hashtag}`);

    // Input for the free "TikTok Scraper" (clockworks/tiktok-scraper or similar)
    const input = {
      "hashtags": [hashtag],
      "resultsPerPage": 6, // Limit to 6 to save credits/time
      "shouldDownloadVideos": false,
      "shouldDownloadCovers": false,
      "searchSection": "" // Must be empty string, /video, or /user. Empty + hashtags -> tag search.
    };

    // This is a long-running process, so in a real app we'd use a queue.
    // For this MVP, we await it (might timeout on client, but server continues).
    // Better: Return "Scraping Started" and webhook back.
    // MVP: Just wait up to 30s.

    const run = await apifyClient.actor("clockworks/tiktok-scraper").call(input);

    const { items } = await apifyClient.dataset(run.defaultDatasetId).listItems();
    console.log(`📦 Found ${items.length} videos`);

    let savedCount = 0;
    if (supabase) {
      for (const item of items) {
        const videoUrl = item.videoUrl || item.webVideoUrl;
        if (!videoUrl) continue;

        const adData = {
          niche: searchQuery || niche || 'general',
          platform: 'tiktok',
          video_url: videoUrl,
          thumbnail_url: item.videoMeta?.coverUrl || 'https://via.placeholder.com/300x500?text=No+Cover',
          title: item.text || 'Viral Video',
          views_count: item.playCount || 0,
          likes_count: item.diggCount || 0,
          comments_count: item.commentCount || 0,
          external_id: item.id,
          created_at: new Date(),
          analysis: {
            hook: "AI Analysis Pending...",
            problem: "Pending...",
            solution: "Pending..."
          }
        };

        const { error } = await supabase.from('ads').upsert(adData, { onConflict: 'external_id' });
        if (!error) savedCount++;
      }
    }

    res.json({ success: true, message: `Scraped and saved ${savedCount} ads`, count: savedCount });

  } catch (error) {
    console.error('Scrape Error:', error);
    res.status(500).json({ error: 'Scraping failed', details: error.message });
  }
});

// Multer for file uploads
const multer = require('multer');
const upload = multer({ dest: 'uploads/' });
const { GoogleAIFileManager } = require("@google/generative-ai/server");

// Initialize Gemini File Manager if API Key exists
let fileManager;
if (process.env.GEMINI_API_KEY) {
  fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
}

app.post('/api/analyze-video', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  if (!genAI || !fileManager) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  try {
    console.log('📤 Uploading video to Gemini...');
    const uploadResult = await fileManager.uploadFile(req.file.path, {
      mimeType: req.file.mimetype,
      displayName: req.file.originalname,
    });

    console.log(`✅ Video uploaded: ${uploadResult.file.uri}`);

    // Wait for file to handle processing
    let file = await fileManager.getFile(uploadResult.file.name);
    while (file.state === "PROCESSING") {
      process.stdout.write(".");
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = await fileManager.getFile(uploadResult.file.name);
    }
    console.log(`\n✅ Video processing complete: ${file.state}`);

    if (file.state === "FAILED") {
      throw new Error("Video processing failed.");
    }

    // Analyze with Gemini
    console.log('🧠 Analyzing video with Gemini Flash...');
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `
      You are a World-Class Creative Director for TikTok Ads.
      Analyze this video frame-by-frame.

      Output strictly valid JSON (no markdown) with this structure:
      {
        "score": number (1-10),
        "niche": string (one of: "beauty", "tech", "fashion", "home", "fitness", "pets"),
        "keywords": [string] (5 relevant tags),
        "hook_analysis": {
          "score": number (1-10),
          "critique": string,
          "suggestion": string
        },
        "pacing_analysis": {
             "critique": string,
             "suggestion": string
        },
        "cta_analysis": {
             "critique": string,
             "suggestion": string
        },
        "viral_checklist": [
           { "label": "Strong Visual Hook?", "passed": boolean },
           { "label": "Problem/Solution Clear?", "passed": boolean },
           { "label": "Fast Pacing?", "passed": boolean },
           { "label": "Clear CTA?", "passed": boolean }
        ]
      }
    `;

    const result = await model.generateContent([
      { fileData: { mimeType: uploadResult.file.mimeType, fileUri: uploadResult.file.uri } },
      { text: prompt },
    ]);

    const text = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    let analysis;
    try {
      analysis = JSON.parse(text);
    } catch (e) {
      console.error("Failed to parse AI JSON", text);
      analysis = { score: 5, niche: "general", keywords: [], error: "AI Output Parse Error" };
    }

    // Fetch Recommendations based on Niche
    let recommendedAds = [];
    if (supabase) {
      console.log(`🔍 Fetching recommendations for niche: ${analysis.niche}`);
      // Try searching by niche first
      const { data: nicheAds } = await supabase
        .from('ads')
        .select('*')
        .eq('niche', analysis.niche)
        .order('likes_count', { ascending: false }) // Get most viral
        .limit(3);

      if (nicheAds && nicheAds.length > 0) {
        recommendedAds = nicheAds;
      } else {
        // Fallback to most viral general ads
        const { data: viralAds } = await supabase
          .from('ads')
          .select('*')
          .order('views_count', { ascending: false })
          .limit(3);
        recommendedAds = viralAds || [];
      }
    }

    // Cleanup (Optional: Delete from Gemini to save storage? Keep for now)
    // await fileManager.deleteFile(uploadResult.file.name); 

    // Increment total_videos_analyzed in profiles
    if (supabase && req.body.userId) {
      try {
        await supabase.rpc('increment_profile_stat', {
          user_id: req.body.userId,
          stat_column: 'total_videos_analyzed'
        });
      } catch (statErr) {
        console.error('Failed to increment videos stat:', statErr);
      }
    }

    res.json({
      analysis: analysis,
      recommendations: recommendedAds.map(ad => ({
        id: ad.id,
        title: ad.title,
        thumbnail: ad.thumbnail_url,
        videoUrl: ad.video_url,
        views: formatNumber(ad.views_count)
      }))
    });

  } catch (error) {
    console.error('Video Analysis Error:', error);
    res.status(500).json({ error: 'Failed to analyze video', details: error.message });
  }
});

app.listen(port, async () => {
  console.log(`Server running on port ${port}`);

  if (supabase) {
    try {
      const { count, error } = await supabase.from('ads').select('*', { count: 'exact', head: true });
      if (error) console.error('❌ Startup DB Connection Failed:', error.message);
      else console.log(`✅ Startup DB Connection Successful! Ads in DB: ${count}`);
    } catch (err) {
      console.error('❌ Startup DB Connection Error:', err.message);
    }
  } else {
    console.warn('⚠️ Supabase client not initialized');
  }
});
