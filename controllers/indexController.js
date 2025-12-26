// Index/Home Controller
const indexController = {
  // Get home page
  getHome: (req, res) => {
    res.json({
      message: 'Welcome to Dub App API',
      status: 'Server is running',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    });
  },

  // Health check
  getHealth: (req, res) => {
    res.json({
      status: 'OK',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
    });
  },
};

module.exports = indexController;

