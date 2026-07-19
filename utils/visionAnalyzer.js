// Hybrid AI routing: Creator → Gemma free (OpenRouter), Studio → Claude Sonnet 5 (OpenRouter)
const { sql } = require('../db/index');

// Model routing by plan
const VISION_MODELS = {
  creator: 'qwen/qwen3-vl-32b-instruct',  // Qwen for Creator
  studio:  'anthropic/claude-sonnet-5',   // Premium Claude vision
  free:    'qwen/qwen3-vl-32b-instruct',  // Fallback
};

async function analyzeVideoFrames(frames, productContext = '', transcript = '', music = null, mode = 'ad', plan = 'free') {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API Key is missing for Vision Analysis');
  }

  // Pick vision model based on subscription plan
  const visionModel = VISION_MODELS[plan] || VISION_MODELS['free'];
  console.log(`[Vision] Using model: ${visionModel} for plan: ${plan}`);

  // Build the FULL frame map so the AI knows the entire video structure
  const frameMap = frames.map((f, i) => 
    `Frame ${i + 1} (${f.timestamp}s — ${f.phase})`
  ).join('\n');

  // Select the 5 most strategically important frames to send as images
  const selectKeyFrames = (allFrames) => {
    if (allFrames.length <= 5) return allFrames;
    const indices = [
      0,                                          // First frame (HOOK OPEN)
      Math.min(3, allFrames.length - 1),          // ~1.5-2s (HOOK END)  
      Math.floor(allFrames.length * 0.4),         // ~40% (PROBLEM/SETUP)
      Math.floor(allFrames.length * 0.7),         // ~70% (SOLUTION/PAYOFF)
      allFrames.length - 1                        // Last frame (CTA/CLOSE)
    ];
    const unique = [...new Set(indices)];
    return unique.map(i => ({ ...allFrames[i], keyFrameIndex: i + 1 }));
  };

  const keyFrames = selectKeyFrames(frames);
  const isAd = mode === 'ad';

  // Anti-Blueprint: Randomized Analytical Lens
  // Each analysis gets a randomly selected expert perspective to ensure
  // no two analyses feel structurally identical, even for similar videos.
  const lenses = isAd ? [
    { name: 'Creative Director', angle: 'You obsess over visual storytelling, editing rhythm, and whether every single frame earns its place. You think in cuts, transitions, and emotional beats.' },
    { name: 'Media Buyer', angle: 'You obsess over thumb-stop rate, CPM efficiency, and click-through psychology. You think in scroll-speed, pattern interrupts, and conversion architecture.' },
    { name: 'Consumer Psychologist', angle: 'You obsess over cognitive biases, decision triggers, and subconscious persuasion. You think in mental models, identity signaling, and emotional transfer.' },
    { name: 'Brand Strategist', angle: 'You obsess over positioning, competitive differentiation, and cultural relevance. You think in market context, audience worldview, and brand voice authenticity.' },
  ] : [
    { name: 'Viral Content Strategist', angle: 'You obsess over shareability mechanics, comment-bait triggers, and algorithmic signals. You think in watch-time curves, save-rates, and duet/stitch potential.' },
    { name: 'Storytelling Director', angle: 'You obsess over narrative arcs, emotional pacing, and character authenticity. You think in story beats, tension/release cycles, and audience identification.' },
    { name: 'Audience Psychologist', angle: 'You obsess over parasocial connection, identity mirroring, and community belonging. You think in relatability triggers, aspiration gaps, and tribal signaling.' },
    { name: 'Cultural Trend Analyst', angle: 'You obsess over trend timing, format innovation, and cultural reference layering. You think in trend lifecycle stages, remix potential, and zeitgeist alignment.' },
  ];
  const selectedLens = lenses[Math.floor(Math.random() * lenses.length)];

  let dbPrompt = null;
  try {
    const rows = await sql`SELECT value FROM system_settings WHERE key = 'ai_prompt'`;
    if (rows && rows.length > 0) {
      dbPrompt = JSON.parse(rows[0].value);
    }
  } catch (err) {
    console.error("Failed to load prompt from DB, using defaults:", err);
  }

  const roleDescription = dbPrompt?.roleDescriptionAd
    ? (isAd ? dbPrompt.roleDescriptionAd : dbPrompt.roleDescriptionContent)
    : `You are the most expensive ${selectedLens.name} in digital advertising. You charge $2,000/hour. Clients pay because you see what others miss. ${selectedLens.angle}

VOICE: Write like you've had two glasses of wine at the wrap party and you're being brutally honest with a friend who just spent $40k on this ad — not like you're presenting to the board tomorrow. You have taste, opinions, and zero patience for hedging.

BANNED REGISTER: Never use analyst/strategy-deck language like "leverages," "creates a dopamine spike," "high-contrast emotional gravity," "framework," "blueprint," "positions the brand as." Write like you're talking to a client face-to-face, not writing a slide. If a sentence could appear in a McKinsey deck, rewrite it before you output it.`;

  const modeInstruction = dbPrompt?.modeInstructionAd
    ? (isAd ? dbPrompt.modeInstructionAd : dbPrompt.modeInstructionContent)
    : (isAd
      ? `YOU ARE WATCHING A VIDEO AD. Your goal is to analyze its hook power, pacing, conversion triggers, and ad strength.`
      : `YOU ARE WATCHING A STORYTELLING/ORGANIC VIDEO (TikTok, Reel, or Short). Your goal is to analyze its hook power, narrative pacing, engagement triggers, and virality potential.`);

  const structureInstructions = dbPrompt?.structureInstructions || `
BEFORE WRITING YOUR ANALYSIS: Identify one specific mismatch or contradiction between what's said and what's shown, or between two frames that should agree but don't (e.g. audio energy vs visual energy, pacing vs emotional beat, promise vs proof). Name it explicitly in your Fatal Hook Flaw & Fix or Psychology Breakdown — a good creative director finds the crack, not just the surface.

ACCURACY CHECK: Only report a mismatch, contradiction, or flaw if you can point to the exact words in the transcript AND the exact visual detail in the frame description that actually conflict. If you cannot point to both precisely, do not claim a mismatch exists — describe what you actually see instead. A fabricated insight is worse than no insight.

Your analysis must be structured exactly around the following sections:

1. **Dashboard Overview**:
   - Niche
   - ${isAd ? 'Customer Awareness Level' : 'Viewer Archetype & Identity Segment'}
   - Hook Power score (/10) — follow every score with one sentence justifying why that number and not one point higher or lower
   - Retention Score (/10) — same justification rule applies
   - Conversion Trigger score (/10) representing ${isAd ? 'Ad Conversion Trigger (ability to drive a purchase/action)' : 'Engagement Trigger (ability to drive likes, shares, comments, and watch time)'} — same justification rule
   - 'Big Idea': Maximum 12 words. Must sound like something you'd say out loud to shock a client, not something you'd type in a strategy doc. If it has a semicolon or the word "angle," rewrite it.

2. **Creative Director's Breakdown**:
   - **Hook Verdict**:
     * Visual Hook score (/10) — one-sentence precision justification
     * Spoken Hook score (/10) — one-sentence precision justification
     * Scroll-Stopper analysis: Detail exactly what stops the scroll (referencing frames/timestamps).
     * Fatal Hook Flaw & Fix: Point out a specific fatal hook mistake and the exact instruction to fix it. This is where you name any audio/visual mismatch you found.
   - **Retention Map** ${isAd ? '' : '(Pacing Map)'}:
     * Attention Peak: Identify the exact moment (with frame and timestamp) where interest spikes and why.
     * Dead Zone: Identify a specific range of frames where pacing dies and exactly what to cut.
   - **Psychology Breakdown** ${isAd ? '' : '(Storytelling Breakdown)'}:
     * Primary Trigger: Name the core psychological driver.
     * Detailed explanation referencing specific frames — include any mismatch between spoken urgency and visual proof here if relevant.
   - **The Money Shot**:
     * Frame number & timestamp.
     * Explain why this specific moment makes the single best click-worthy thumbnail or cover image.

3. **Actionable Production Directions**:
   * Exactly 3 specific, shootable, and filmable next steps for improving this video.
   * ${isAd 
       ? "At least one of your 3 directions MUST address the OFFER itself — check for a missing timeframe, missing proof point (before/after, results, guarantee), or a scarcity/urgency mechanism that's underused. Don't just fix the edit; fix what's being promised." 
       : "At least one of your 3 directions MUST address the NARRATIVE PAYOFF — if the hook promises a story, ensure the climax actually delivers emotional weight, shock, or shareability, rather than just fizzling out."}

4. **The Secret Sauce**:
   * Must open with a single declarative sentence under 8 words that states the core truth bluntly — no throat-clearing, no "This ad moves the needle because…". Start with the punch, then explain in one closing paragraph with extreme conviction and personality.
   * End with one sentence naming the exact metric this ad's biggest fix should move (CTR, watch-time, or CVR) and a directional sense of why, based specifically on what's in these frames — not a generic promise.

CRITICAL RULES FOR WRITING ANALYSIS:
- Every insight must reference SPECIFIC frames, timestamps, or exact moments — never generic statements.
- Never reuse the same phrasing across different analyses — ban phrases like 'strong hook' or 'clear CTA' without specific unique context.
- Write with opinion and conviction, not neutral observation — take a stance on what's good, what's flawed, what to fix.
- The 'Big Idea' and 'Secret Sauce' must read like sharp, quotable copywriting — not analysis.
- Vary sentence structure and vocabulary based on the video's actual niche/industry.
- This should read like a $2,000/hour creative director wrote it after actually watching the video closely.

ANTI-BLUEPRINT RULES (MANDATORY — FOLLOW THESE OR THE OUTPUT IS WORTHLESS):
- CONTRARIAN TAKE: You MUST identify at least one element of this video where the obvious interpretation is wrong. State what most people would assume, then explain why they are wrong.
- VISUAL ANCHORING: When describing any frame, reference at least two of these: exact dominant colors, specific facial expressions, camera angle/distance, lighting direction, text font style, background elements, object positioning. Generic descriptions like 'bright shot' or 'close-up of face' are BANNED.
- NICHE-NATIVE VOCABULARY: Write using the specific language and mental models of the video's actual industry. A fitness ad sounds like a personal trainer. A beauty ad sounds like a makeup artist. A tech ad sounds like a product reviewer.
- UNIQUE STRUCTURAL EMPHASIS: Weight your analysis toward whatever is genuinely most interesting about THIS particular video.

THE "WORTH MORE THAN THIS COSTS" TEST: Before finalizing, ask yourself: if the client read only the Fatal Hook Flaw & Fix and The Secret Sauce, would they feel like they got something they couldn't have figured out themselves in five minutes? If not, dig one layer deeper.

FINAL SELF-EDIT PASS: Before finalizing, reread the Big Idea and Secret Sauce sections. If either sounds like it could've been written by a consultant instead of a person with actual taste, rewrite it once more before outputting.
`;

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${roleDescription}

${modeInstruction}
The video has ${frames.length} frames extracted at these timestamps:
${frameMap}

I'm attaching ${keyFrames.length} KEY FRAMES as images (marked with ★ below):
${keyFrames.map(f => `★ Frame ${f.keyFrameIndex || frames.indexOf(f) + 1} (${f.timestamp}s — ${f.phase}) [IMAGE ATTACHED]`).join('\n')}

The other frames exist but don't have images — use the timestamps and phase labels to infer pacing.

${transcript ? `EXACT WORDS SPOKEN IN THE VIDEO: "${transcript}"` : 'NO SPOKEN WORDS — this is a visual-only video.'}
${music ? `BACKGROUND TRACK IDENTIFIED: ${music}` : 'No identified background music.'}
${productContext ? `CONTEXT: ${productContext}` : ''}

YOUR ANALYSIS MUST BE HYPER-SPECIFIC. Reference exact frame numbers and timestamps.
Do NOT give generic advice. Every critique must reference what you SEE in the frames.

${structureInstructions}

Output as JSON with this EXACT structure (maintaining backward compatibility keys):
{
  "metrics": {
    "hook_power": <1-10 with 0.1 precision>,
    "retention_score": <1-10 with 0.1 precision>,
    "conversion_trigger": <1-10 with 0.1 precision>
  },
  "niche": "<specific niche — e.g. 'Beauty/Skincare', 'Fitness/Supplements', 'Fashion/Streetwear'>",
  "awareness_level": "${isAd ? '<Unaware|Problem-Aware|Solution-Aware|Product-Aware|Most-Aware>' : '<Low-Interest|Curious-Viewer|Engaged-Follower|Loyal-Fan|Viral-Share>'}",
  "big_idea": "<the core concept in one punchy copywriting sentence>",
  "hook_verdict": {
    "what_stops_the_scroll": "<reference specific frames and what you see>",
    "visual_hook_grade": <1-10 with 0.1 precision>,
    "spoken_hook_grade": <1-10 with 0.1 precision>,
    "fatal_hook_flaw_and_fix": "<specific hook mistake and exact fix instruction>"
  },
  "retention_map": {
    "attention_peaks": ["<Frame X at Xs — describe what spikes attention and why>"],
    "dead_zones": ["<Frame X to Frame Y — describe why attention drops here and what to cut>"],
    "critique": "<overall pacing analysis referencing frame numbers>"
  },
  "audio_visual_sync": {
    "score": <1-10 with 0.1 precision>,
    "mismatches": ["<specific moments where audio and visual don't align with frame/timestamp>"],
    "strengths": ["<specific moments where audio and visual align perfectly with frame/timestamp>"]
  },
  "money_shot": {
    "frame_number": <int>,
    "timestamp": "<Xs>",
    "why": "<why this frame makes the best click-worthy thumbnail/cover>"
  },
  "psychology_breakdown": {
    "primary_trigger": "<Curiosity|Fear|Desire|Social Proof|Scarcity|Authority|FOMO|Relatability|Shock|Identity|Emotional Resonance>",
    "explanation": "<how the trigger operates in THIS specific video — reference frames>"
  },
  "psychological_triggers": [
    "<Primary Trigger Name>",
    "<Secondary Trigger Name>"
  ],
  "actionable_directions": [
    "<specific, filmable instruction 1 — tell them exactly what to shoot>",
    "<specific, filmable instruction 2>",
    "<specific, filmable instruction 3>"
  ],
  "the_secret_sauce": "<deliver the single most important, non-obvious insight about why this specific video works, written with personality and conviction>",
  "hook_analysis": {
    "critique": "<duplicate of the_secret_sauce for backward compatibility>",
    "visual_description": "<visual hooks description of the opening scenes>",
    "camera_work": "<camera moves/angles in the hook scene>",
    "subject_action": "<subject action in the hook scene>",
    "energy_level": "<energy level in the hook scene>",
    "text_overlays": "<any text overlays present in the hook scene>"
  },
  "problem_scene": {
    "visual_approach": "<visual styling of the setup/problem scene>",
    "transitions": "<transition style used here>",
    "emotional_cues": "<emotional cues/expressions>"
  },
  "solution_scene": {
    "product_demo_style": "<product demo style used>",
    "transitions": "<transitions in the solution scene>",
    "clear_benefits": "<benefits visual representation>"
  },
  "cta_scene": {
    "closing_visual": "<closing visual description>",
    "cta_presentation": "<how the CTA is visually presented>"
  },
  "overall_style": {
    "lighting": "<lighting style>",
    "color_palette": "<colors used>",
    "editing_pace": "<editing pacing style>"
  }
}`
        },
        ...keyFrames.map((frame, index) => ({
          type: 'image_url',
          image_url: {
            url: `data:${frame.mimeType};base64,${frame.base64}`
          }
        }))
      ]
    }
  ];

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://eixora.com',
        'X-Title': 'Eixora Mobile',
      },
      body: JSON.stringify({
        model: visionModel,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.3,
      })
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter API error: ${response.status} - ${errText}`);
    }

    const completion = await response.json();
    const responseText = completion.choices[0]?.message?.content;
    
    if (!responseText) throw new Error('Empty response from OpenRouter/Claude');

    // Claude sometimes wraps JSON in markdown blocks
    let cleanedText = responseText.trim();
    if (cleanedText.startsWith('\`\`\`json')) {
        cleanedText = cleanedText.replace(/^\`\`\`json/, '').replace(/\`\`\`$/, '').trim();
    } else if (cleanedText.startsWith('\`\`\`')) {
        cleanedText = cleanedText.replace(/^\`\`\`/, '').replace(/\`\`\`$/, '').trim();
    }

    return JSON.parse(cleanedText);

  } catch (error) {
    console.error('Vision analysis error:', error);
    throw new Error(`Video analysis failed: ${error.message}`);
  }
}

module.exports = { analyzeVideoFrames };
