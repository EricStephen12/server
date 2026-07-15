// Removed Groq SDK in favor of fetch for OpenRouter

async function analyzeVideoFrames(frames, productContext = '', transcript = '', music = null, mode = 'ad') {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OpenRouter API Key is missing for Vision Analysis');
  }

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
  const roleDescription = isAd 
    ? "You are the most expensive Creative Director in digital advertising. You charge $2,000/hour. Clients pay because you see what others miss."
    : "You are the most sought-after Viral Content Strategist and Storyteller. You charge $2,000/hour. Clients pay because you decode virality and pacing.";

  const modeInstruction = isAd
    ? `YOU ARE WATCHING A VIDEO AD. Your goal is to analyze its hook power, pacing, conversion triggers, and ad strength.`
    : `YOU ARE WATCHING A STORYTELLING/ORGANIC VIDEO (TikTok, Reel, or Short). Your goal is to analyze its hook power, narrative pacing, engagement triggers, and virality potential.`;

  const structureInstructions = `
Your analysis must be structured exactly around the following sections:

1. **Dashboard Overview**:
   - Niche: Niche of the video (e.g., 'Beauty/Skincare', 'Fitness/Supplements', 'Tech Gadgets', 'Life Hacks').
   - Customer Awareness Level (Ad Mode) or Viewer Archetype/Interest Level (Content Mode)
   - Hook Power score (/10)
   - Retention Score (/10)
   - Conversion Trigger score (/10) representing:
     ${isAd ? '* Ad Conversion Trigger (ability to drive a purchase/action)' : '* Engagement Trigger (ability to drive likes, shares, comments, and watch time)'}
   - 'Big Idea': A one-line, punchy, copywriter-grade sentence capturing the core psychological or narrative angle.

2. **Creative Director's Breakdown**:
   - **Hook Verdict**:
     * Visual Hook score (/10)
     * Spoken Hook score (/10)
     * Scroll-Stopper analysis: Detail exactly what stops the scroll (referencing frames/timestamps).
     * Fatal Hook Flaw & Fix: Point out a specific fatal hook mistake and the exact instruction to fix it.
   - **Retention Map** (Pacing Map in Content Mode):
     * Attention Peak: Identify the exact moment (with frame and timestamp) where interest/attention spikes and why.
     * Dead Zone: Identify a specific range of frames where pacing dies and exactly what frames or segments to cut.
   - **Psychology Breakdown** (Storytelling Breakdown in Content Mode):
     * Primary Trigger: Name the core psychological driver (e.g. Social Proof, Scarcity, Authority for ads; or Curiosity, Shock, Identity, Emotional Resonance for content).
     * Detailed explanation referencing specific frames.
   - **Audio-Visual Sync**:
     * Audio-Visual Sync score (/10)
     * Specific strength moment (where audio and video align perfectly, with frame/timestamp).
     * Specific mismatch moment (where audio and video drift or conflict, with frame/timestamp).
   - **The Money Shot**:
     * Frame number & timestamp.
     * Explain why this specific moment makes the single best click-worthy thumbnail or cover image.

3. **Actionable Production Directions**:
   * Exactly 3 specific, shootable, and filmable next steps for improving this video.

4. **The Secret Sauce**:
   * One closing paragraph that delivers the single most important, non-obvious insight about why this specific video works. Write this with extreme conviction and personality.

CRITICAL RULES FOR WRITING ANALYSIS:
- Every insight must reference SPECIFIC frames, timestamps, or exact moments from the actual video — never generic statements.
- Never reuse the same phrasing across different analyses — ban phrases like 'strong hook' or 'clear CTA' without specific unique context attached.
- Write with opinion and conviction, not neutral observation — take a stance on what's good, what's flawed, what to fix.
- The 'Big Idea' and 'Secret Sauce' sections specifically should read like sharp, quotable copywriting — not analysis.
- Vary sentence structure and vocabulary based on the video's actual niche/industry — skincare language differs from tech gadget language differs from fashion language.
- This should read like a $500/hour creative director wrote it after actually watching the video closely, not like a templated report generator.
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
        model: process.env.AI_MODEL || 'google/gemini-2.0-flash-exp:free', // Configurable via .env
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
