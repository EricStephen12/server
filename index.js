const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const { createClient } = require('@supabase/supabase-js');
const Groq = require('groq-sdk');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const multer = require('multer');
const { ApifyClient } = require('apify-client');
const { extractFrames } = require('./utils/frameExtractor');
const { analyzeVideoFrames } = require('./utils/visionAnalyzer');
const { transcribeAudio } = require('./utils/audioTranscriber');

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;

// Multer for file uploads
const upload = multer({ dest: 'uploads/' });

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Supabase Connection
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

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
    gemini_configured: false // Gemini is no longer used
  });
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

// STANDALONE VIDEO ANALYSIS ENDPOINT (URL Based)
app.post('/api/analyze-video-url', async (req, res) => {
  const { videoUrl, userId } = req.body;

  if (!videoUrl) {
    return res.status(400).json({ error: 'Video URL is required' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Groq API not configured' });
  }

  try {
    console.log('🎥 Locating Viral DNA from URL...');
    const { frames, audioPath } = await extractFrames(videoUrl);

    if (!frames || frames.length === 0) {
      throw new Error('No frames could be extracted from this URL.');
    }

    // Transcription in parallel or sequence
    let transcript = "";
    if (audioPath) {
      try {
        transcript = await transcribeAudio(audioPath);
        console.log('🎙️ Transcript Extracted:', transcript.substring(0, 50) + '...');
      } catch (err) {
        console.warn('⚠️ Transcription failed, proceeding with vision only:', err.message);
      }
    }

    console.log('🧠 Analyzing Multi-Modal Masterclass Psychology...');
    const analysis = await analyzeVideoFrames(frames, `Analysis of: ${videoUrl}`, transcript);

    // Fuse transcript into analysis for the chat context
    analysis.transcript = transcript;

    console.log('✅ Masterclass DNA Extraction Complete');
    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length,
      hasAudio: !!transcript
    });

  } catch (error) {
    console.error('Video URL analysis error:', error);
    res.status(500).json({
      error: 'Failed to extract DNA from URL',
      details: error.message
    });
  }
});

app.post('/api/analyze-video', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'Groq API not configured' });
  }

  try {
    console.log('🎥 Extracting DNA from draft...');
    const { frames, audioPath } = await extractFrames(req.file.path);

    if (!frames || frames.length === 0) {
      throw new Error('No frames could be extracted from this video.');
    }

    // Transcription
    let transcript = "";
    if (audioPath) {
      try {
        transcript = await transcribeAudio(audioPath);
        console.log('🎙️ Transcript Extracted:', transcript.substring(0, 50) + '...');
      } catch (err) {
        console.warn('⚠️ Transcription failed:', err.message);
      }
    }

    console.log('🧠 Auditing Multi-Modal Mastery...');
    const analysis = await analyzeVideoFrames(frames, 'Uploaded Draft Analysis', transcript);

    // Fuse
    analysis.transcript = transcript;

    res.json({
      success: true,
      analysis,
      framesAnalyzed: frames.length,
      hasAudio: !!transcript
    });

  } catch (error) {
    console.error('Video analysis error:', error);
    res.status(500).json({
      error: 'Video audit failed',
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


// Creative Director Chat Loop
app.post('/api/creative-director-chat', async (req, res) => {
  const { messages, dna, isRoastMode } = req.body;

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  try {
    const isIntro = !messages || messages.length === 0;

    const systemPrompt = `You are an Elite Creative Director & Growth Partner. 
    You have just PERSONALLY deconstructed the video frames and analyzed the psychological DNA. 
    We are in a private "Lounge Session." You aren't an AI; you're a mentor who has built 8-figure brands.
    
    ${isRoastMode ? 'YOUR PERSONA: ROAST MODE. Be direct, ruthless, and bored of excuses. If the ad is bad, say it. If the hook is weak, kill it. No sugar-coating.' : 'YOUR PERSONA: Sophisticated Partner. Direct but collaborative. Ambitious and insightful.'}

    THE DATA (I just watched this and found):
    - Awareness: ${dna.awareness_level}
    - Trigger: ${dna.psychology_breakdown.trigger}
    - Style: ${dna.vibe_assessment?.style || 'Guerilla UGC'}
    
    The Rulebook (VETERAN CD ONLY):
    1. **Structural Arbitrage**: Your primary job is to treat the analyzed video as a "Psychological Blueprint." The user might want to steal a winning 'Hook' from a Toy ad and use it for a 'Kitchen Gadget.' You MUST facilitate this "Cross-Niche" transfer.
    2. **The "Anchor" Protocol**: You don't know about the user's product yet. In the intro, you MUST ask for their "Product Anchor" (what they are selling).
    3. **The "Steal & Adapt" Law**: Identify the "Secret Sauce" (e.g., a specific visual gesture or audio trigger) and explain how to apply it to *any* product the user mentions.
    4. **Friction Finder**: If the user is stuck, give 3 "Niche-Agnostic" hook ideas that work for their product based on the analyzed DNA.
    
    ${isIntro ? `
    INSTRUCTION: Opening message. Deliver a "DIRECTOR'S STRATEGIC MEMO":
    
    1. **The Verdict**: 1-sentence assessment of why this video is a winner/burner.
    2. **The Stealable Pattern**: Identify the one psychological trigger that is "Niche-Agnostic" (can be stolen for any product).
    3. **The Bridge**: Briefly explain how this pattern works for this ${dna.niche || 'specific'} niche.
    4. **The Anchor Request**: End with: "I've deconstructed the blueprint. Give me your **Product Anchor** (what are you selling?)—and tell me if you want to stay in this niche or 'Arbitrage' this hook to something completely different."
    
    Be direct, high-stakes, and elite.` : 'Chat with them like a partner. Act as their "Structural Arbitrage" expert. Bridge the analyzed DNA to whatever product they mention.'}
    `;

    let completion;
    const MAX_RETRIES = 3;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`💬 Generating script (attempt ${attempt}/${MAX_RETRIES})...`);
        completion = await groq.chat.completions.create({
          messages: [
            { role: "system", content: systemPrompt },
            ...(messages || [])
          ],
          model: "llama-3.3-70b-versatile",
          temperature: 0.7,
        }, { timeout: 60000 });
        break; // Success — exit retry loop
      } catch (err) {
        const isNetworkError = ['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND'].includes(err.cause?.code);
        console.warn(`⚠️ Chat attempt ${attempt} failed: ${err.message}`);
        if (attempt < MAX_RETRIES && isNetworkError) {
          console.log(`🔄 Retrying in 2s...`);
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }

    res.json({ message: completion.choices[0]?.message?.content });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed' });
  }
});

// Session Management Endpoints
app.post('/api/save-lounge-session', async (req, res) => {
  const { sessionId, userId, videoUrl, dna, messages, title } = req.body;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  try {
    let result;
    if (sessionId) {
      // Update existing session
      const { data, error } = await supabase
        .from('lounge_sessions')
        .update({ messages, updated_at: new Date() })
        .eq('id', sessionId)
        .eq('user_id', userId)
        .select()
        .single();
      if (error) throw error;
      result = data;
    } else {
      // Create new session
      const { data, error } = await supabase
        .from('lounge_sessions')
        .insert([{
          user_id: userId,
          title: title || `Analysis: ${videoUrl.substring(0, 30)}...`,
          video_url: videoUrl,
          dna,
          messages,
          created_at: new Date(),
          updated_at: new Date()
        }])
        .select()
        .single();
      if (error) throw error;
      result = data;
    }
    res.json(result);
  } catch (error) {
    console.error('Save session error:', error);
    res.status(500).json({ error: 'Failed to save session' });
  }
});

app.get('/api/user-sessions', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'User ID is required' });

  try {
    const { data, error } = await supabase
      .from('lounge_sessions')
      .select('id, title, video_url, created_at')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Fetch sessions error:', error);
    res.status(500).json({ error: 'Failed to fetch sessions' });
  }
});

app.get('/api/lounge-session/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('lounge_sessions')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Fetch session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

app.post('/api/generate-final-script', async (req, res) => {
  const { messages, dna, userId } = req.body;

  if (!groq) return res.status(503).json({ error: 'AI service not available' });

  try {
    const finalPrompt = `AS THE ELITE CREATIVE DIRECTOR, SYNTHESIZE THIS MASTERMIND SESSION INTO A PRODUCTION GUIDE.
    
    ORIGINAL DNA:
    - Awareness Level: ${dna.awareness_level}
    - Big Idea: ${dna.big_idea}
    - Critique Hook: ${dna.hook_analysis.critique}
    
    CHAT CONTEXT (THE USER PREFERENCES):
    ${messages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n')}
    
    INSTRUCTION: 
    - Create an Agency-Grade Viral Production Guide.
    - Replicate the psychological energy of the original DNA but adapt for the new product using the chat context.
    - The script must be high-AOV, high-RECOUP focused.
    
    Output JSON only:
    {
        "title": "Viral Script Name",
        "concept": "Brief concept summary",
        "awareness_level": "${dna.awareness_level}",
        "big_idea": "Synthesis of the chat + DNA",
        "shot_list": [
            { "time": "0-3s", "visual": "...", "audio": "...", "overlay": "..." },
            { "time": "3-8s", "visual": "...", "audio": "...", "overlay": "..." },
            { "time": "8-15s", "visual": "...", "audio": "...", "overlay": "..." },
            { "time": "15s+", "visual": "...", "audio": "...", "overlay": "..." }
        ]
    }`;

    const completion = await groq.chat.completions.create({
      messages: [{ role: "user", content: finalPrompt }],
      model: "llama-3.3-70b-versatile",
      response_format: { type: "json_object" },
    }, { timeout: 60000 });

    const script = JSON.parse(completion.choices[0]?.message?.content || '{}');

    // Save to Vault
    if (supabase && userId) {
      await supabase.from('scripts').insert([{
        user_id: userId,
        title: script.title,
        script_content: script,
        created_at: new Date()
      }]);
    }

    res.json(script);
  } catch (error) {
    console.error('Script generation error:', error);
    res.status(500).json({ error: 'Failed' });
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
