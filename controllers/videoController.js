const { uploadFile, getFile, deleteFile, deleteMultipleFiles, listFiles } = require('../utils/r2');
const { sendSuccess, sendError } = require('../utils/response');
const variables = require('../const/variables');
const { getVideoDuration, formatSRTTime, formatVTTTime } = require('../utils/video');
const { Video, Job } = require('../models');
const { createJob } = require('../jobs/jobCreator');
const { default: mongoose } = require('mongoose');
const { streamToBuffer } = require('../utils/videoJob.utils');

const videoController = {
  uploadVideo: async (req, res) => {
    try {
      if (!req.file) {
        return sendError(res, 'No file uploaded', 400);
      }

      let duration = 0;

      if (req.file.mimetype.startsWith('video/')) {
        duration = await getVideoDuration(req.file.buffer);
        const maxDuration = 90; // 1 minute 30 seconds

        if (duration > maxDuration) {
          return sendError(
            res,
            `Video duration must be under 1 minute 30 seconds (${maxDuration} seconds). Your video is ${Math.ceil(duration)} seconds.`,
            400
          );
        }
      }

      const user = req.user;
      const { targetLanguage, selectedVoice, videoLanguage } = req.body;
      const directory = `${variables.VIDOES}/${user?._id}`;
      const fileName = req.file.originalname.replace(/\.[^/.]+$/, '') || null;
      const videoTitle = req.body.title || fileName || null;

      const uploadResult = await uploadFile(req.file, directory, fileName);
      if(!uploadResult) {
        return sendError(res, 'Failed to upload video', 500);
      }

      const video = await Video.create({
        userId: user._id,
        inputVideo: {
          s3Key: uploadResult.key,
          durationSec: Math.ceil(duration),
          format: req.file.mimetype.split('/')[1] || req.file.originalname.split('.').pop() || 'mp4',
        },
        targetLanguage,
        selectedVoice,
        videoLanguage,
        status: variables.PENDING,
      })

      if(!video) {
        return sendError(res, 'Failed to create video', 500);
      }

      await createJob(variables.VIDEO_PROCESS, video?._id, user?._id)

      return sendSuccess(
        res,
        'Video uploaded successfully',
        {
          key: uploadResult.key,
          url: uploadResult.url,
          bucket: uploadResult.bucket,
          title: videoTitle,
          uploadedBy: user._id,
        },
        201
      );
    } catch (error) {
      console.log("Error", error)
      return sendError(res, error.message, 500);
    }
  },

  getVideos: async(req, res) => {
    try {
      const { userId } = req.params

      const videoData = await Video.aggregate([
        {
          $match: {
            userId: new mongoose.Types.ObjectId(userId) 
          }
        },
        {
          $lookup: {
            from: "jobs",
            localField: "_id",
            foreignField: "videoId",
            as: "JobData"
          }
        },        
        {
          $unwind: {
            path: "$JobData",
            preserveNullAndEmptyArrays: true
          }
        }
      ])

      return sendSuccess(
        res,
        "All User Videos",
        videoData
      )
    } catch (error) {
      return sendError(res, error.message, 500)
    }
  },

  getSubtitles: async (req, res) => {
    try {
      const { videoId } = req.params
      const { format = 'json' } = req.query; // Accept format: json, srt, vtt
      
      const video = await Video.findById(videoId)
      if(!video) {
        return sendError(res, 'Video not found', 404)
      }
      
      // Format subtitles to only include start, end, and text
      const formattedSubtitles = (video.subTitles || []).map(subtitle => ({
        start: subtitle.start,
        end: subtitle.end,
        text: subtitle.text
      }))

      // If no subtitles, return error
      if (formattedSubtitles.length === 0) {
        return sendError(res, 'No subtitles found for this video', 404)
      }

      // Convert to requested format
      let content = '';
      let filename = `subtitles_${videoId}`;
      let contentType = 'application/json';

      switch (format.toLowerCase()) {
        case 'srt':
          // Convert to SRT format
          content = formattedSubtitles.map((sub, index) => {
            const startTime = formatSRTTime(sub.start);
            const endTime = formatSRTTime(sub.end);
            return `${index + 1}\n${startTime} --> ${endTime}\n${sub.text}\n`;
          }).join('\n');
          filename += '.srt';
          contentType = 'text/srt';
          break;

        case 'vtt':
          // Convert to WebVTT format
          content = 'WEBVTT\n\n';
          content += formattedSubtitles.map((sub) => {
            const startTime = formatVTTTime(sub.start);
            const endTime = formatVTTTime(sub.end);
            return `${startTime} --> ${endTime}\n${sub.text}\n`;
          }).join('\n');
          filename += '.vtt';
          contentType = 'text/vtt';
          break;

        case 'json':
        default:
          // Return JSON format
          content = JSON.stringify(formattedSubtitles, null, 2);
          filename += '.json';
          contentType = 'application/json';
          break;
      }

      // Set headers for file download
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', Buffer.byteLength(content, 'utf8'));
      
      return res.send(content);
    } catch (error) {
      return sendError(res, error.message, 500)
    }
  },

  deleteVideo: async (req, res) => {
    try {
      const { videoId } = req.params;
      const user = req.user;

      // Find the video and verify ownership
      const video = await Video.findOne({
        _id: videoId,
        userId: user._id
      });

      if (!video) {
        return sendError(res, 'Video not found or access denied', 404);
      }

      // Collect all R2 keys from the video document
      const r2KeysToDelete = [];

      // Original video
      if (video.inputVideo?.s3Key) {
        r2KeysToDelete.push(video.inputVideo.s3Key);
      }

      // Audio files
      if (video.audio?.original) r2KeysToDelete.push(video.audio.original);
      if (video.audio?.voice) r2KeysToDelete.push(video.audio.voice);
      if (video.audio?.background) r2KeysToDelete.push(video.audio.background);
      if (video.audio?.tts) r2KeysToDelete.push(video.audio.tts);

      // AI files
      if (video.ai?.rewrittenScript) r2KeysToDelete.push(video.ai.rewrittenScript);

      // Output video
      if (video.outputVideo?.s3Key) {
        r2KeysToDelete.push(video.outputVideo.s3Key);
      }

      // List and delete all files in video-related directories
      const directoriesToClean = [
        `extracted-audio/${user._id}/${videoId}`,
        `scripts/${user._id}/${videoId}`,
        `tts-audio/${user._id}/${videoId}`,
        `dubbed/${user._id}/${videoId}`,
        `completed/${user._id}/${videoId}`
      ];

      // Get all files from directories
      for (const directory of directoriesToClean) {
        try {
          const files = await listFiles(directory);
          files.forEach(file => {
            if (file.Key) {
              r2KeysToDelete.push(file.Key);
            }
          });
        } catch (error) {
          // Directory might not exist, continue
          console.log(`Directory ${directory} not found or empty:`, error.message);
        }
      }

      // Remove duplicates and null/undefined values
      const uniqueKeys = [...new Set(r2KeysToDelete.filter(key => key))];

      // Delete all R2 files
      if (uniqueKeys.length > 0) {
        try {
          await deleteMultipleFiles(uniqueKeys);
          console.log(`Deleted ${uniqueKeys.length} R2 files for video ${videoId}`);
        } catch (error) {
          console.error(`Error deleting some R2 files:`, error.message);
          // Continue with database deletion even if some files fail
        }
      }

      // Delete all related jobs
      const deleteJobsResult = await Job.deleteMany({ videoId: video._id });
      console.log(`Deleted ${deleteJobsResult.deletedCount} jobs for video ${videoId}`);

      // Delete the video document
      await Video.findByIdAndDelete(video._id);

      return sendSuccess(
        res,
        'Video and all related files deleted successfully',
        {
          videoId: video._id,
          deletedFiles: uniqueKeys.length,
          deletedJobs: deleteJobsResult.deletedCount
        }
      );
    } catch (error) {
      console.error('Error deleting video:', error);
      return sendError(res, error.message || 'Failed to delete video', 500);
    }
  },

  downloadAudio: async (req, res) => {
    try {
      const { videoId } = req.params;
      const user = req.user;

      // Find the video and verify ownership
      const video = await Video.findOne({
        _id: videoId,
        userId: user._id
      });

      if (!video) {
        return sendError(res, 'Video not found or access denied', 404);
      }

      // Check if final audio exists
      if (!video.audio?.tts) {
        return sendError(res, 'Final audio not available for this video', 404);
      }

      // Fetch file from R2
      const fileResponse = await getFile(video.audio.tts);
      
      if (!fileResponse || !fileResponse.Body) {
        return sendError(res, 'Audio file not found in R2', 404);
      }

      // Convert stream to buffer
      const fileBuffer = await streamToBuffer(fileResponse.Body);

      // Extract filename from key or use default
      const keyParts = video.audio.tts.split('/');
      const fileName = keyParts[keyParts.length - 1] || `final_audio_${videoId}.wav`;
      
      // Get content type from R2 metadata or infer from key
      const contentType = fileResponse.ContentType || 
        (video.audio.tts.endsWith('.wav') ? 'audio/wav' : 
         video.audio.tts.endsWith('.mp3') ? 'audio/mpeg' : 
         'audio/wav');

      // Set headers to force download
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', fileBuffer.length);

      // Send file
      res.send(fileBuffer);
    } catch (error) {
      console.error('Download audio error:', error);
      return sendError(res, error.message || 'Failed to download audio', 500);
    }
  },

  downloadVideo: async (req, res) => {
    try {
      const { videoId } = req.params;
      const user = req.user;

      // Find the video and verify ownership
      const video = await Video.findOne({
        _id: videoId,
        userId: user._id
      });

      if (!video) {
        return sendError(res, 'Video not found or access denied', 404);
      }

      // Check if final video exists
      if (!video.outputVideo?.s3Key) {
        return sendError(res, 'Final video not available for this video', 404);
      }

      // Fetch file from R2
      const fileResponse = await getFile(video.outputVideo.s3Key);
      
      if (!fileResponse || !fileResponse.Body) {
        return sendError(res, 'Video file not found in R2', 404);
      }

      // Convert stream to buffer
      const fileBuffer = await streamToBuffer(fileResponse.Body);

      // Extract filename from key or use default
      const keyParts = video.outputVideo.s3Key.split('/');
      const fileName = keyParts[keyParts.length - 1] || `final_video_${videoId}.mp4`;
      
      // Get content type from R2 metadata or infer from key
      const contentType = fileResponse.ContentType || 
        (video.outputVideo.s3Key.endsWith('.mp4') ? 'video/mp4' : 
         video.outputVideo.s3Key.endsWith('.webm') ? 'video/webm' : 
         'video/mp4');

      // Set headers to force download
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      res.setHeader('Content-Length', fileBuffer.length);

      // Send file
      res.send(fileBuffer);
    } catch (error) {
      console.error('Download video error:', error);
      return sendError(res, error.message || 'Failed to download video', 500);
    }
  }
};

module.exports = videoController;