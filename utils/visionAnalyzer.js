const Groq = require('groq-sdk');


async function analyzeVideoFrames(frames, productContext = '', transcript = '', music = null) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error('Groq API Key is missing for Vision Analysis');
  }

  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, timeout: 30000 });

  // Build the FULL frame map so the AI knows the entire video structure
  const frameMap = frames.map((f, i) => 
    `Frame ${i + 1} (${f.timestamp}s — ${f.phase})`
  ).join('\n');

  // Select the 5 most strategically important frames to send as images
  // (Groq's Llama 4 Scout supports max 5 images)
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

  const messages = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `You are the most expensive Creative Director in digital advertising. You charge $2,000/hour. Clients pay because you see what others miss.

YOU ARE WATCHING A VIDEO AD. The video has ${frames.length} frames extracted at these timestamps:
${frameMap}

I'm attaching ${keyFrames.length} KEY FRAMES as images (marked with ★ below):
${keyFrames.map(f => `★ Frame ${f.keyFrameIndex || frames.indexOf(f) + 1} (${f.timestamp}s — ${f.phase}) [IMAGE ATTACHED]`).join('\n')}

The other frames exist but don't have images — use the timestamps and phase labels to infer pacing.

${transcript ? `EXACT WORDS SPOKEN IN THE VIDEO: "${transcript}"` : 'NO SPOKEN WORDS — this is a visual-only ad.'}
${music ? `BACKGROUND TRACK IDENTIFIED: ${music}` : 'No identified background music.'}
${productContext ? `CONTEXT: ${productContext}` : ''}

YOUR ANALYSIS MUST BE HYPER-SPECIFIC. Reference exact frame numbers and timestamps.
Do NOT give generic advice. Every critique must reference what you SEE in the frames.

BAD example: "The hook is attention-grabbing"
GOOD example: "Frame 1 (0s) opens with a close-up of hands unboxing — this triggers curiosity. But by Frame 5 (2.5s), the product still isn't visible. You're losing 40% of viewers here. Move the product reveal to Frame 3 (1s)."

ANALYZE:

1. **THE HOOK VERDICT (First 3 seconds)**: What EXACTLY stops the scroll? Reference specific frames and visual elements. Grade 1-10.

2. **THE RETENTION MAP**: Walk through the video frame by frame. Where does attention SPIKE? Where does it DROP? Identify dead zones — "Between Frame X and Frame Y, there's no new visual stimulus for N seconds."

3. **AUDIO-VISUAL SYNC**: Does the spoken word match what's on screen? Identify specific mismatches and strengths.

4. **THE MONEY SHOT**: Which single frame would make the best thumbnail or static ad? Why?

5. **CTA STRENGTH**: How does the video end? Is there urgency? Social proof? A clear next step?

6. **THE STEAL-WORTHY ELEMENT**: What ONE technique from this ad would you steal for any product?

7. **THE FATAL FLAW**: What ONE change would double this ad's performance?

Output as JSON with this EXACT structure:
{
  "metrics": {
    "hook_power": <1-10 with 0.1 precision>,
    "retention_score": <1-10>,
    "conversion_trigger": <1-10>
  },
  "niche": "<specific niche — e.g. 'Beauty/Skincare', 'Fitness/Supplements', 'Fashion/Streetwear'>",
  "awareness_level": "<Unaware|Problem-Aware|Solution-Aware|Product-Aware|Most-Aware>",
  "big_idea": "<the core concept in one punchy sentence>",
  "hook_verdict": {
    "what_stops_the_scroll": "<reference specific frames and what you see>",
    "visual_hook_grade": <1-10>,
    "spoken_hook_grade": <1-10>,
    "improvement": "<exact, filmable instruction to improve the hook>"
  },
  "retention_map": {
    "attention_peaks": ["<Frame X at Xs — describe what spikes attention and why>"],
    "dead_zones": ["<Frame X to Frame Y — describe why attention drops here>"],
    "critique": "<overall pacing analysis referencing frame numbers>"
  },
  "audio_visual_sync": {
    "score": <1-10>,
    "mismatches": ["<specific moments where audio and visual don't align>"],
    "strengths": ["<specific moments where audio and visual align perfectly>"]
  },
  "money_shot": {
    "frame_number": <int>,
    "timestamp": "<Xs>",
    "why": "<why this frame would convert as a thumbnail or static ad>"
  },
  "vibe_assessment": {
    "style": "<UGC Raw|UGC Polished|Studio|Cinematic|Screen-Record|Slideshow>",
    "emotional_arc": "<describe the emotional journey from Frame 1 to the last frame>",
    "critique": "<honest, specific assessment of the production quality>"
  },
  "cta_analysis": {
    "has_cta": <boolean>,
    "urgency_level": "<None|Low|Medium|High>",
    "critique": "<specific feedback referencing the final frames>",
    "rewrite": "<if CTA exists, a stronger rewrite. If no CTA, write one.>"
  },
  "psychology_breakdown": {
    "primary_trigger": "<Curiosity|Fear|Desire|Social Proof|Scarcity|Authority|FOMO|Relatability|Shock>",
    "explanation": "<how the trigger operates in THIS specific ad — reference frames>"
  },
  "steal_worthy": "<the ONE technique worth stealing, explained so anyone can replicate it>",
  "fatal_flaw": "<the ONE change that would double performance — be specific and filmable>",
  "viral_checklist": [
    { "label": "Pattern Interrupt in first 1s", "passed": <boolean>, "note": "<what you see in Frame 1>" },
    { "label": "Face visible in first 2s", "passed": <boolean>, "note": "<reference specific frames>" },
    { "label": "Text overlay reinforces hook", "passed": <boolean>, "note": "<what text is visible>" },
    { "label": "New visual stimulus every 2-3s", "passed": <boolean>, "note": "<identify any gaps>" },
    { "label": "Product shown before 50% mark", "passed": <boolean>, "note": "<which frame shows product>" },
    { "label": "Clear CTA in final frames", "passed": <boolean>, "note": "<what the viewer is told to do>" },
    { "label": "Audio-Visual alignment", "passed": <boolean>, "note": "<sync quality>" },
    { "label": "Emotional escalation throughout", "passed": <boolean>, "note": "<does energy build or stay flat>" }
  ],
  "actionable_directions": [
    "<specific, filmable instruction 1 — tell them exactly what to shoot>",
    "<specific, filmable instruction 2>",
    "<specific, filmable instruction 3>"
  ],
  "the_secret_sauce": "<the single psychological lever that makes this ad profitable — explain it like a mentor>"
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
    const completion = await groq.chat.completions.create({
      messages,
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) throw new Error('Empty response from Groq Vision');

    return JSON.parse(responseText);

  } catch (error) {

    throw new Error(`Video analysis failed: ${error.message}`);
  }
}

module.exports = { analyzeVideoFrames };
