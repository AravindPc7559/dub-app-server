import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getFile, uploadFileFromBuffer } from "../utils/r2.js";

/**
 * Save R2 stream to local file
 */
const saveStreamToFile = async (stream, outputPath) => {
  try {
    return new Promise((resolve, reject) => {
      const writeStream = fs.createWriteStream(outputPath);
      stream.pipe(writeStream);
      stream.on("error", reject);
      writeStream.on("finish", resolve);
      writeStream.on("error", reject);
    });
  } catch (error) {
    throw new Error
  }
};

/**
 * Final step:
 * - download video
 * - mix dubbed audio + background audio
 * - replace video audio
 * - upload final video to R2
 */
export async function finalizeVideo(userId, videoId, inputVideoKey) {
  try {
    const id = String(videoId);

  // ─────────────────────────────────────────────
  // 1️⃣ Prepare folders
  // ─────────────────────────────────────────────
  const finalDir = path.join("tmp", "final", id);
  fs.mkdirSync(finalDir, { recursive: true });

  const localVideoPath = path.join(finalDir, "input_video.mp4");
  const mixedAudioPath = path.join(finalDir, "mixed_audio.wav");
  const finalVideoPath = path.join(finalDir, "output.mp4");

  // ─────────────────────────────────────────────
  // 2️⃣ Download video from R2 (USING EXISTING getFile)
  // ─────────────────────────────────────────────
  const video = await getFile(inputVideoKey);
  await saveStreamToFile(video.Body, localVideoPath);

  // ─────────────────────────────────────────────
  // 3️⃣ Locate audio files
  // ─────────────────────────────────────────────
  const finalDubAudio = path.join(
    "tmp",
    "tts",
    id,
    "final_dub_audio.wav"
  );

  const backgroundAudio = path.join(
    "tmp",
    "htdemucs",
    "htdemucs",
    `${id}_audio`,
    "no_vocals.mp3"
  );

  if (!fs.existsSync(finalDubAudio)) {
    throw new Error("Final dub audio not found");
  }

  if (!fs.existsSync(backgroundAudio)) {
    throw new Error("Background (no_vocals) audio not found");
  }

  // ─────────────────────────────────────────────
  // 4️⃣ Mix dubbed voice + background audio
  // ─────────────────────────────────────────────
  execSync(
    `ffmpeg -y \
     -i "${finalDubAudio}" \
     -i "${backgroundAudio}" \
     -filter_complex "[1:a]volume=0.35[bg];[0:a][bg]amix=inputs=2:dropout_transition=0" \
     -c:a pcm_s16le \
     -ar 44100 \
     -ac 2 \
     "${mixedAudioPath}"`,
    { stdio: "inherit" }
  );  

  // ─────────────────────────────────────────────
  // 5️⃣ Replace video audio (copy video stream)
  // ─────────────────────────────────────────────
  execSync(
    `ffmpeg -y \
      -i "${localVideoPath}" \
      -i "${mixedAudioPath}" \
      -map 0:v:0 \
      -map 1:a:0 \
      -c:v copy \
      -c:a aac \
      -shortest \
      "${finalVideoPath}"`,
    { stdio: "inherit" }
  );

  // ─────────────────────────────────────────────
  // 6️⃣ Upload final video to R2
  // ─────────────────────────────────────────────
  const finalUrl = await uploadFileFromBuffer(
    fs.readFileSync(finalVideoPath),
    'video/mp4',
    `completed/${userId}/${videoId}`,
    "output"
  );

  return finalUrl;
  } catch (error) {
    throw new Error(error)
  }
}
