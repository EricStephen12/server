const { GoogleGenerativeAI } = require('@google/generative-ai');

/**
 * Analyze video frames using Gemini Vision API
 * @param {Array} frames - Array of frame objects with {timestamp, base64, mimeType}
 * @param {string} productContext - Context about the product being advertised
 * @returns {Promise<Object>} - Detailed visual analysis
 */
async function analyzeVideoFrames(frames, productContext = '') {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

    // Prepare image parts for Gemini Vision
    const imageParts = frames.map(frame => ({
        inlineData: {
            data: frame.base64,
            mimeType: frame.mimeType
        }
    }));

    const prompt = `You are analyzing a TikTok ad video frame-by-frame. 
${productContext ? `Product Context: ${productContext}` : ''}

I'm providing you with ${frames.length} frames extracted at these timestamps: ${frames.map(f => f.timestamp + 's').join(', ')}.

Analyze the visual structure of this ad and provide a detailed breakdown:

1. **Hook (0-3s)**: What's happening in the opening? Describe:
   - Exact visual composition (what's in frame, camera angle)
   - Subject's actions and facial expressions
   - Camera work (handheld, static, movement type)
   - Energy level and pacing
   - Any text overlays or graphics

2. **Problem Scene (3-8s)**: How is the problem presented visually?
   - Visual storytelling approach
   - Facial expressions and body language
   - Scene transitions
   - Visual metaphors used

3. **Solution Scene (8-15s)**: How is the product/solution shown?
   - Product demonstration style
   - Camera focus and framing
   - Visual proof elements
   - Pacing and energy shift

4. **CTA Scene (15s+)**: How does it close?
   - Final visual
   - Call-to-action presentation
   - Closing energy

5. **Overall Style**:
   - Lighting style (natural, studio, moody, bright)
   - Color palette and mood
   - Editing pace (fast cuts, slow transitions)
   - Camera work consistency

Output as JSON with this structure:
{
  "hook_analysis": {
    "visual_description": "...",
    "camera_work": "...",
    "subject_action": "...",
    "energy_level": "...",
    "text_overlays": "..."
  },
  "problem_scene": {
    "visual_approach": "...",
    "transitions": "...",
    "emotional_cues": "..."
  },
  "solution_scene": {
    "product_demo_style": "...",
    "visual_proof": "...",
    "pacing": "..."
  },
  "cta_scene": {
    "closing_visual": "...",
    "cta_presentation": "..."
  },
  "overall_style": {
    "lighting": "...",
    "color_palette": "...",
    "editing_pace": "...",
    "camera_consistency": "..."
  },
  "actionable_directions": [
    "Specific direction 1 for recreating this ad",
    "Specific direction 2...",
    "..."
  ]
}`;

    try {
        const result = await model.generateContent([prompt, ...imageParts]);
        const response = await result.response;
        const text = response.text();

        // Extract JSON from response (handle markdown code blocks)
        let jsonText = text;
        if (text.includes('```json')) {
            jsonText = text.split('```json')[1].split('```')[0].trim();
        } else if (text.includes('```')) {
            jsonText = text.split('```')[1].split('```')[0].trim();
        }

        const analysis = JSON.parse(jsonText);
        return analysis;

    } catch (error) {
        console.error('Gemini Vision analysis error:', error);
        throw new Error(`Video analysis failed: ${error.message}`);
    }
}

module.exports = { analyzeVideoFrames };
