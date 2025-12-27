const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

// Validate R2 configuration
const validateR2Config = () => {
  const requiredVars = {
    R2_ENDPOINT: process.env.R2_ENDPOINT,
    R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
    R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
  };

  const missing = Object.entries(requiredVars)
    .filter(([key, value]) => !value || (typeof value === 'string' && value.trim() === ''))
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required R2 environment variables: ${missing.join(', ')}`);
  }
};

// Lazy initialization of R2 client
let r2Client = null;
const getR2Client = () => {
  if (!r2Client) {
    validateR2Config();
    r2Client = new S3Client({
      region: 'auto',
      endpoint: process.env.R2_ENDPOINT,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return r2Client;
};

const getBucketName = () => {
  validateR2Config();
  return process.env.R2_BUCKET_NAME;
};

const getR2PublicUrl = () => {
  return process.env.R2_PUBLIC_URL || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
};

const uploadFile = async (file, directory = '', fileName = null) => {
  try {
    const fileExtension = file.originalname.split('.').pop();
    const key = fileName 
      ? `${directory}/${fileName}.${fileExtension}` 
      : `${directory}/${uuidv4()}.${fileExtension}`;

    const command = new PutObjectCommand({
      Bucket: getBucketName(),
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype,
    });

    await getR2Client().send(command);

    return {
      key,
      url: `${getR2PublicUrl()}/${key}`,
      bucket: getBucketName(),
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
      Bucket: getBucketName(),
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    });

    await getR2Client().send(command);

    return {
      key,
      url: `${getR2PublicUrl()}/${key}`,
      bucket: getBucketName(),
    };
  } catch (error) {
    throw new Error(`R2 upload failed: ${error.message}`);
  }
};

const getFile = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    });

    console.log('Getting file', key, process.env.R2_ENDPOINT);

    const response = await getR2Client().send(command);
    return response;
  } catch (error) {
    // Provide more detailed error information
    if (error.message.includes('credential') || error.message.includes('credentials')) {
      throw new Error(`R2 get file failed: Invalid R2 credentials. Please check R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY environment variables. Original error: ${error.message}`);
    }
    throw new Error(`R2 get file failed: ${error.message}`);
  }
};

const getSignedUrlForFile = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    });

    const signedUrl = await getSignedUrl(getR2Client(), command, { expiresIn });
    return signedUrl;
  } catch (error) {
    throw new Error(`R2 signed URL generation failed: ${error.message}`);
  }
};

const deleteFile = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    });

    await getR2Client().send(command);
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
      Bucket: getBucketName(),
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    const response = await getR2Client().send(command);
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

