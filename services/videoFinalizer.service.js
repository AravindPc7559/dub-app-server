const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const { getFile, uploadFileFromBuffer } = require("../utils/r2");

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
    throw new Error(error);
  }
};

async function finalizeVideo(userId, videoId, inputVideoKey) {
  try {
    const id = String(videoId);
  const finalDir = path.join("tmp", "final", id);
  fs.mkdirSync(finalDir, { recursive: true });

  const localVideoPath = path.join(finalDir, "input_video.mp4");
  const mixedAudioPath = path.join(finalDir, "mixed_audio.wav");
  const finalVideoPath = path.join(finalDir, "output.mp4");

  const video = await getFile(inputVideoKey);
  await saveStreamToFile(video.Body, localVideoPath);

    const finalDubAudio = path.join("tmp", "tts", id, "final_dub_audio.wav");
    const backgroundAudio = path.join("tmp", "htdemucs", "htdemucs", `${id}_audio`, "no_vocals.mp3");
    const ENABLE_DEMUCS = process.env.ENABLE_DEMUCS !== 'false'; // Default to true if not set

  if (!fs.existsSync(finalDubAudio)) {
    throw new Error("Final dub audio not found");
  }

  // If demucs is disabled or background audio doesn't exist, use TTS audio directly
  if (!ENABLE_DEMUCS || !fs.existsSync(backgroundAudio)) {
    console.log(`[Finalize] Demucs disabled or background audio not found, using TTS audio directly`);
    // Just normalize the TTS audio without mixing
    execSync(
      `ffmpeg -y -i "${finalDubAudio}" ` +
      `-af "loudnorm=I=-16:TP=-1.5:LRA=11" ` +
      `-c:a pcm_s16le -ar 44100 -ac 2 "${mixedAudioPath}"`,
      { stdio: "inherit" }
    );
  } else {
    console.log(`[Finalize] Mixing audio (background volume: 0.4, with normalization)`);
    // Mix audio with better balance and normalization
    // - Background at 40% volume for better clarity of dubbed audio
    // - Normalize the mix to prevent clipping
    // - Use crossfade to smooth transitions
    execSync(
        `ffmpeg -y -i "${finalDubAudio}" -i "${backgroundAudio}" ` +
        `-filter_complex "[1:a]volume=0.4,highpass=f=60[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2,` +
        `loudnorm=I=-16:TP=-1.5:LRA=11" ` +
        `-c:a pcm_s16le -ar 44100 -ac 2 "${mixedAudioPath}"`,
      { stdio: "inherit" }
    );
  }  

    console.log(`[Finalize] Replacing video audio`);
  execSync(
      `ffmpeg -y -i "${localVideoPath}" -i "${mixedAudioPath}" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -shortest "${finalVideoPath}"`,
    { stdio: "inherit" }
  );

  const finalUrl = await uploadFileFromBuffer(
    fs.readFileSync(finalVideoPath),
    'video/mp4',
    `completed/${userId}/${videoId}`,
    "output"
  );

    console.log(`[Finalize] Video finalized`);
  return finalUrl;
  } catch (error) {
    throw new Error(error);
  }
}

module.exports = {
  finalizeVideo,
};