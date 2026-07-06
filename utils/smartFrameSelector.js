// utils/smartFrameSelector.js

/**
 * Selects frames based on tier limits and smart selection rules.
 * @param {Array} frames - The array of frames from the client [{ timestamp, base64, mimeType }, ...]
 * @param {number} maxFrames - Max allowed frames for the tier (Free: 5, Creator: 15, Studio: 25)
 * @returns {Array} - The selected frames
 */
function selectSmartFrames(frames, maxFrames) {
    if (!frames || frames.length === 0) return [];
    if (frames.length <= maxFrames) return frames;

    // 1. Always include first and last frames
    const selected = new Set();
    selected.add(0);
    selected.add(frames.length - 1);

    // 2. Identify potential scene changes based on simple structural diffs 
    // (Since we don't want to do heavy base64 decoding in node, we assume frames are roughly chronological)
    // We will just sample heavily from the first 3 seconds (Hook) and evenly spread the rest.
    
    const hookFrames = frames.map((f, i) => ({ ...f, index: i })).filter(f => f.timestamp <= 3.0);
    
    // Add up to half of the budget to the hook
    const hookBudget = Math.floor(maxFrames / 2);
    let hookAdded = 0;
    
    // Prioritize scene cuts in the hook if possible (here we just evenly sample the hook)
    if (hookFrames.length > 0) {
        const step = Math.max(1, Math.floor(hookFrames.length / hookBudget));
        for (let i = 0; i < hookFrames.length && hookAdded < hookBudget; i += step) {
            if (!selected.has(hookFrames[i].index)) {
                selected.add(hookFrames[i].index);
                hookAdded++;
            }
        }
    }

    // 3. Fill the rest evenly across the remainder of the video
    let remainingBudget = maxFrames - selected.size;
    if (remainingBudget > 0) {
        const remainingFrames = frames.map((f, i) => ({ ...f, index: i })).filter(f => f.timestamp > 3.0 && f.index !== frames.length - 1);
        if (remainingFrames.length > 0) {
            const step = Math.max(1, Math.floor(remainingFrames.length / remainingBudget));
            for (let i = 0; i < remainingFrames.length && remainingBudget > 0; i += step) {
                if (!selected.has(remainingFrames[i].index)) {
                    selected.add(remainingFrames[i].index);
                    remainingBudget--;
                }
            }
        }
    }

    // Sort by index and return
    const finalIndices = Array.from(selected).sort((a, b) => a - b);
    return finalIndices.map(i => frames[i]).map((f, idx, arr) => {
        // Label the phase based on timestamp
        let phase = 'MID-ROLL';
        if (f.timestamp <= 1) phase = 'HOOK OPEN';
        else if (f.timestamp <= 3) phase = 'HOOK';
        else if (f.timestamp <= 8) phase = 'PROBLEM/SETUP';
        if (idx === arr.length - 1) phase = 'CTA/CLOSE';
        return { ...f, phase };
    });
}

module.exports = { selectSmartFrames };
