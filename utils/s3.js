const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('uuid');

const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;

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
      ACL: 'private',
    });

    await s3Client.send(command);

    return {
      key,
      url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      bucket: BUCKET_NAME,
    };
  } catch (error) {
    throw new Error(`S3 upload failed: ${error.message}`);
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
      ACL: 'private',
    });

    await s3Client.send(command);

    return {
      key,
      url: `https://${BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`,
      bucket: BUCKET_NAME,
    };
  } catch (error) {
    throw new Error(`S3 upload failed: ${error.message}`);
  }
};

const getFile = async (key) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const response = await s3Client.send(command);
    return response;
  } catch (error) {
    throw new Error(`S3 get file failed: ${error.message}`);
  }
};

const getSignedUrlForFile = async (key, expiresIn = 3600) => {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    throw new Error(`S3 signed URL generation failed: ${error.message}`);
  }
};

const deleteFile = async (key) => {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    return { success: true, key };
  } catch (error) {
    throw new Error(`S3 delete failed: ${error.message}`);
  }
};

const deleteMultipleFiles = async (keys) => {
  try {
    const deletePromises = keys.map(key => deleteFile(key));
    await Promise.all(deletePromises);
    return { success: true, deletedCount: keys.length };
  } catch (error) {
    throw new Error(`S3 bulk delete failed: ${error.message}`);
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

    const response = await s3Client.send(command);
    return response.Contents || [];
  } catch (error) {
    throw new Error(`S3 list files failed: ${error.message}`);
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

