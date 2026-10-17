import IORedis from 'ioredis';

export function createRedisConnection() {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (redisUrl) {
    return new IORedis(redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
    });
  }

  const config = {
    host: process.env.REDIS_HOST?.trim() || '127.0.0.1',
    port: Number(process.env.REDIS_PORT || 6379),
    password: process.env.REDIS_PASSWORD?.trim() || undefined,
    db: Number(process.env.REDIS_DB || 0),
  };

  return new IORedis({
    host: config.host,
    port: config.port,
    password: config.password,
    db: config.db,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  });
}
