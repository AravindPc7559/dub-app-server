const OpenAI = require("openai");
const { parseGPTResponse, validateSegments, generateTranslationPrompt } = require("../utils/jsonUtils");

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

  // Generate translation prompt
  const prompt = generateTranslationPrompt({
    segments,
    videoLanguage,
    targetLanguage,
    isTranslationNeeded
  });


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

  const content = response.choices[0].message.content.trim();
  
  const segmentsArray = parseGPTResponse(content);
  const validatedSegments = validateSegments(segmentsArray);
  
  // Validate character count matches original
  if (Array.isArray(validatedSegments) && Array.isArray(segments)) {
    validatedSegments.forEach((translatedSegment, index) => {
      if (segments[index] && translatedSegment && translatedSegment.text) {
        const originalLength = segments[index].text ? segments[index].text.length : 0;
        const translatedLength = translatedSegment.text.length;
        
        if (originalLength !== translatedLength) {
          console.warn(`Character count mismatch for segment ${index}: original=${originalLength}, translated=${translatedLength}`);
          console.warn(`Original: "${segments[index].text}"`);
          console.warn(`Translated: "${translatedSegment.text}"`);
        }
      }
    });
  }
  
  return validatedSegments;
};

module.exports = {
  translateSegments,
};
