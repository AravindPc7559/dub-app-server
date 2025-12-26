// Error handling middleware
const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Default error
  let error = { ...err };
  error.message = err.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = 'Resource not found';
    error = { message, statusCode: 404 };
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const message = 'Duplicate field value entered';
    error = { message, statusCode: 400 };
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = { message, statusCode: 400 };
  }

  // Multer errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      error = { message: 'File too large. Maximum size is 500MB', statusCode: 400 };
    } else if (err.code === 'LIMIT_FILE_COUNT') {
      error = { message: 'Too many files', statusCode: 400 };
    } else {
      error = { message: err.message, statusCode: 400 };
    }
  }

  // File type validation errors (from multer fileFilter)
  if (err.message && err.message.includes('Invalid file type')) {
    error = { message: err.message, statusCode: 400 };
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: error.message || 'Server Error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};

module.exports = errorHandler;

