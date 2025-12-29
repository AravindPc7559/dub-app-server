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
  const isTranslationNeeded = videoLanguage && targetLanguage &&
    videoLanguage.toLowerCase() !== targetLanguage.toLowerCase();

    const prompt = `
    You are a professional video dubbing writer. Your task is to rewrite segments so they match the EXACT duration provided.
    
    Context:
    - Original Language: ${videoLanguage || 'Unknown'}
    - Target Language: ${targetLanguage || videoLanguage || 'Unknown'}
    - Goal: ${isTranslationNeeded ? 'Translate and rewrite' : 'Rewrite for timing'}
    
    MATHEMATICAL TIMING RULES (MANDATORY):
    1. For every segment, calculate Duration = (end - start).
    2. Use a "Natural Speech Constant" of 14 characters per second (including spaces).
    3. Target Character Count = Duration * 14.
    4. You MUST adjust the length of the sentence to be within +/- 10% of that Target Character Count.
    5. If a segment is 7.4 seconds, the text MUST be approximately 100-105 characters long. 
    6. If the text is too short, expand the sentence with descriptive but natural adjectives or connecting phrases. Do NOT use filler words like "um."
    
    REWRITE STRATEGY:
    - Too Short? Expand: Instead of "Be careful," use "So you really need to make sure that you are being extra careful."
    - Too Long? Condense: Instead of "It is a very important thing for you to remember," use "It's a vital thing to remember."
    
    STRICT OUTPUT FORMAT:
    - Output ONLY a valid JSON array.
    - Structure: [{ "start": float, "end": float, "text": string }]
    - No markdown, no preamble.
    
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
