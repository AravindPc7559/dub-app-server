// Application configuration
module.exports = {
  port: process.env.PORT || 3000,
  env: process.env.NODE_ENV || 'development',
  
  // API Configuration
  api: {
    version: 'v1',
    prefix: '/api/v1',
  },
  
  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  },
  
  // JWT Configuration (if needed)
  jwt: {
    secret: process.env.JWT_SECRET || 'your-secret-key',
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
};

