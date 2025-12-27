const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Translate and rewrite segments for video dubbing
 * @param {Object} params - Translation parameters
 * @param {Array} params.segments - Array of transcription segments
 * @param {string} params.videoLanguage - Source language name (e.g., "English", "Malayalam")
 * @param {string} params.targetLanguage - Target language name (e.g., "Malayalam", "Hindi")
 * @returns {Promise<Array>} Translated and rewritten segments
 */
const translateSegments = async ({
  segments,
  videoLanguage,
  targetLanguage
}) => {
  console.log('videoLanguage', videoLanguage);
  console.log('targetLanguage', targetLanguage);
  const isTranslationNeeded = videoLanguage && targetLanguage && 
                               videoLanguage.toLowerCase() !== targetLanguage.toLowerCase();

  console.log('isTranslationNeeded', isTranslationNeeded);

  const prompt = `
  You are a professional video dubbing writer who specializes in making scripts sound
  natural, casual, and human — not formal, not robotic, and not like a textbook.
  
  Context:
  - Original video language: ${videoLanguage || 'Unknown'}
  - Target dubbing language: ${targetLanguage || videoLanguage || 'Unknown'}
  - The input is a segment-wise transcription of real human speech.
  - The transcription may contain repetition, filler words, pauses, or awkward phrasing.
  - The speaker may naturally use English words mixed into their speech.
  
  Your goal:
  ${isTranslationNeeded 
    ? `Translate the content from ${videoLanguage} to ${targetLanguage} and rewrite it into a natural, casual, and engaging spoken script suitable for voice dubbing in ${targetLanguage}.`
    : `Rewrite the content into a natural, casual, and engaging spoken script suitable for voice dubbing in ${targetLanguage || videoLanguage}.`
  }
  
  IMPORTANT LANGUAGE RULE (VERY IMPORTANT):
  - If an English word or phrase is clearly used intentionally in the original speech
    (for example: product names, technical terms, platform names, common English words),
    KEEP that English word AS-IS.
  - Do NOT translate, localize, or replace intentional English words unless it is
    absolutely necessary for clarity.
  - Treat English words as part of natural speech, not something that must be converted.
  
  GENERAL GUIDELINES:
  1. First, understand the full meaning and intent of each segment before rewriting or translating.
  2. Do NOT translate word-by-word. Focus on meaning and how a real person would speak.
  3. Use simple, everyday language — the way people normally talk.
  4. Rewrite each segment so it sounds:
     - natural and native
     - conversational and friendly
     - smooth when spoken out loud
     - clear and confident
  5. Remove filler words, repeated phrases, and broken sentences.
  6. If something is repeated only for emphasis, keep the emphasis but simplify it.
  7. Preserve the original message, tone, and intent.
  8. Do NOT add new ideas, examples, or explanations.
  9. Make it feel like a real person speaking directly to the viewer.
  
  TIMING & STRUCTURE RULES (STRICT):
  10. Keep the EXACT same start and end time for every segment.
  11. Do NOT merge or split segments.
  12. Keep the text length appropriate for the timing of each segment.
  
  OUTPUT RULES (STRICT):
  13. Output ONLY a valid JSON array.
  14. Keep the same structure as the input:
      { start, end, text }
  15. Do NOT include markdown, comments, or extra text.
  16. Output pure JSON only.
  
  DUBBING STYLE NOTES:
  - Short segments → short, punchy spoken lines.
  - Longer segments → smooth, flowing sentences.
  - The final script should sound like a creator talking naturally to their audience.
  - The result must be ready for voice-over recording without further editing.
  
  Input segments:
  ${JSON.stringify(segments, null, 2)}
  `;  

  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.2,
    messages: [
      { 
        role: "system", 
        content: `You are a professional translator and script writer for video dubbing. ${isTranslationNeeded ? `You translate from ${videoLanguage} to ${targetLanguage} and write natural, conversational scripts in ${targetLanguage}.` : `You rewrite scripts to make them natural and conversational.`} Always output ONLY a valid JSON array. Never use markdown code blocks. Output pure JSON only.`
      },
      { role: "user", content: prompt }
    ]
  });

  let content = response.choices[0].message.content.trim();
  
  // Remove markdown code blocks if present
  if (content.startsWith('```')) {
    // Remove opening ```json or ```
    content = content.replace(/^```(?:json)?\s*/i, '');
    // Remove closing ```
    content = content.replace(/\s*```$/g, '');
  }
  
  // Try to parse as JSON
  try {
    const parsed = JSON.parse(content);
    // If it's wrapped in an object, extract the array
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Check for common keys that might contain the array
      const possibleKeys = ['segments', 'result', 'data', 'output', 'translation'];
      for (const key of possibleKeys) {
        if (Array.isArray(parsed[key])) {
          return parsed[key];
        }
      }
      // If no array found, return the object values as array
      return Object.values(parsed).find(Array.isArray) || parsed;
    }
    return parsed;
  } catch (parseError) {
    console.error('JSON parse error. Content:', content.substring(0, 200));
    throw new Error(`Failed to parse translation response: ${parseError.message}`);
  }
};

module.exports = {
  translateSegments,
};
