const { uploadFile } = require('../utils/r2');
const { sendSuccess, sendError } = require('../utils/response');
const variables = require('../const/variables');
const { getVideoDuration } = require('../utils/video');
const { Video } = require('../models');
const { createJob } = require('../jobs/jobCreator');
const { default: mongoose } = require('mongoose');

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
  }
};

module.exports = videoController;