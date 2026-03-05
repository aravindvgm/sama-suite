const Redis = require('ioredis');

let redis = null;

if (process.env.REDIS_HOST) {

  redis = new Redis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on('connect', () => {
    console.log('✅ Redis connected');
  });

  redis.on('error', (err) => {
    console.error('❌ Redis error:', err.message);
  });

} else {

  console.log('⚠️ Redis disabled (REDIS_HOST not provided)');

}

module.exports = redis;