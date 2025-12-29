import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { uploadFileFromBuffer } from "./r2.js";

const SAMPLE_RATE = 44100;

// Helper to get actual duration of the generated TTS file
function getDuration(filePath) {
  const output = execSync(
    `ffprobe -v error -show_entries format=duration -of csv=p=0 "${filePath}"`
  );
  return parseFloat(output.toString().trim());
}

export async function buildFinalAudio(userId, videoId, rawSegments) {
  let segments = rawSegments?.map((item) => item?.segment || item);
  if (!Array.isArray(segments) || segments.length === 0) throw new Error("No segments");

  const baseDir = path.join("tmp", "tts", String(videoId));
  const finalAudio = path.join(baseDir, "final_dub_audio.wav");

  let inputs = "";
  let filterComplex = "";
  let mixLabels = "";

  segments.forEach((s, i) => {
    const inputPath = path.join(baseDir, `segment-${i}.wav`);
    if (!fs.existsSync(inputPath)) throw new Error(`Missing: ${inputPath}`);

    const startMs = Math.round(s.start * 1000);
    const targetDuration = s.end - s.start;
    const actualDuration = getDuration(inputPath);

    // Calculate tempo: how much we need to change the speed
    // Example: Actual 5s / Target 3.8s = 1.31x speed (faster)
    // Example: Actual 2.5s / Target 3.8s = 0.65x speed (slower)
    let tempo = actualDuration / targetDuration;

    // FFmpeg atempo limit is 0.5 to 2.0. 
    // If tempo is outside this, we clamp it to avoid errors.
    const safeTempo = Math.max(0.5, Math.min(2.0, tempo)).toFixed(2);

    inputs += ` -i "${inputPath}"`;

    // 1. atempo: Adjusts speed without changing pitch
    // 2. adelay: Positions the audio at the exact start time
    filterComplex += `[${i}:a]atempo=${safeTempo},adelay=${startMs}|${startMs}[a${i}];`;
    mixLabels += `[a${i}]`;
  });

  const segmentCount = segments.length;
  // mix and normalize volume
  filterComplex += `${mixLabels}amix=inputs=${segmentCount}:dropout_transition=1000,volume=${segmentCount}[out]`;

  const ffmpegCmd = `ffmpeg -y ${inputs} -filter_complex "${filterComplex}" -map "[out]" -c:a pcm_s16le -ar ${SAMPLE_RATE} "${finalAudio}"`;

  try {
    console.log("Processing audio with dynamic speed adjustment...");
    execSync(ffmpegCmd, { stdio: 'inherit' });

    return await uploadFileFromBuffer(
      fs.readFileSync(finalAudio),
      "audio/wav",
      `dubbed/${userId}/${videoId}`,
      "final_dub_audio"
    );
  } catch (error) {
    console.error("FFmpeg Error:", error);
    throw error;
  }
}