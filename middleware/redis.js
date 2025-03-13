const { createClient } = require('redis');

const redisClient = createClient();

redisClient.connect().catch((err) => {
  console.error('Redis initial connection error:', err);
});

async function checkRedisConnection(req, res, next) {
  if (!redisClient.isOpen) {
    return res.status(500).json({ success: false, error: 'Redis disconnected' });
  }
  next();
}

module.exports = checkRedisConnection;
