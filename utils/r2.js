const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

const uploadFile = async (file, directory = '', fileName = null) => {
  try {
    const fileExtension = file.originalname.split('.').pop();
    const key = fileName 
      ? `${directory}/${fileName}.${fileExtension}` 
      : `${directory}/${uuidv4()}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await r2Client.send(command);

    return {
      key,
      url: `${R2_PUBLIC_URL}/${key}`,
      bucket: BUCKET_NAME,
    };
  } catch (error) {
    throw new Error(`R2 upload failed: ${error.message}`);
  }
};

const uploadFileFromBuffer = async (buffer, mimetype, directory = '', fileName = null) => {
  try {
    const fileExtension = mimetype.split('/')[1] || 'bin';
    const key = fileName 
      ? `${directory}/${fileName}.${fileExtension}` 
      : `${directory}/${uuidv4()}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    });

    await r2Client.send(command);

    return {
      key,
      url: `${R2_PUBLIC_URL}/${key}`,
      bucket: BUCKET_NAME,
    };
  } catch (error) {
    throw new Error(`R2 upload failed: ${error.message}`);
  }
};

const getFile = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await r2Client.send(command);
    return response;
  } catch (error) {
    throw new Error(`R2 get file failed: ${error.message}`);
  }
};

const getSignedUrlForFile = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(r2Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    throw new Error(`R2 signed URL generation failed: ${error.message}`);
  }
};

const deleteFile = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await r2Client.send(command);
    return { success: true, key };
  } catch (error) {
    throw new Error(`R2 delete failed: ${error.message}`);
  }
};

const deleteMultipleFiles = async (keys) => {
  try {
    const deletePromises = keys.map(key => deleteFile(key));
    await Promise.all(deletePromises);
    return { success: true, deletedCount: keys.length };
  } catch (error) {
    throw new Error(`R2 bulk delete failed: ${error.message}`);
  }
};

const listFiles = async (directory = '', maxKeys = 1000) => {
  try {
    const prefix = directory ? `${directory}/` : '';
    const command = new ListObjectsV2Command({
      Bucket: BUCKET_NAME,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await r2Client.send(command);
    return response.Contents || [];
  } catch (error) {
    throw new Error(`R2 list files failed: ${error.message}`);
  }
};

const fileExists = async (key) => {
  try {
    await getFile(key);
    return true;
  } catch (error) {
    if (error.name === 'NoSuchKey' || error.name === 'NotFound') {
      return false;
    }
    throw error;
  }
};

module.exports = {
  uploadFile,
  uploadFileFromBuffer,
  getFile,
  getSignedUrlForFile,
  deleteFile,
  deleteMultipleFiles,
  listFiles,
  fileExists,
};

