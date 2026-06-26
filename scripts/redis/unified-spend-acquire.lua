-- Atomic multi-window spend acquire (tokens/min, USD/min, USD/day).
-- ARGV[1] = reservation_id
-- ARGV[2] = tokens_delta (metadata)
-- ARGV[3] = usd_micro_delta (metadata)
-- ARGV[4] = num_windows
-- Per window: key, cap, ttl, delta (repeated num_windows times)

local reservation_id = ARGV[1]
local tokens_delta = tonumber(ARGV[2]) or 0
local usd_micro_delta = tonumber(ARGV[3]) or 0
local num_windows = tonumber(ARGV[4]) or 0
local idx = 5
local meta_key = 'mastyf_ai:reservation:' .. reservation_id

for i = 1, num_windows do
  local key = ARGV[idx]; idx = idx + 1
  local cap = tonumber(ARGV[idx]); idx = idx + 1
  local ttl = tonumber(ARGV[idx]); idx = idx + 1
  local delta = tonumber(ARGV[idx]); idx = idx + 1
  if key and cap and cap > 0 and delta and delta > 0 then
    local current = tonumber(redis.call('GET', key) or '0')
    if current + delta > cap then
      return {0, 'exceeded'}
    end
  end
end

idx = 5
for i = 1, num_windows do
  local key = ARGV[idx]; idx = idx + 1
  local cap = tonumber(ARGV[idx]); idx = idx + 1
  local ttl = tonumber(ARGV[idx]); idx = idx + 1
  local delta = tonumber(ARGV[idx]); idx = idx + 1
  if key and cap and cap > 0 and delta and delta > 0 then
    redis.call('INCRBY', key, delta)
    redis.call('EXPIRE', key, ttl)
    redis.call('HSET', meta_key, key, delta)
  end
end

redis.call('HSET', meta_key, '_tokens', tokens_delta)
redis.call('HSET', meta_key, '_usd_micro', usd_micro_delta)
redis.call('EXPIRE', meta_key, 900)
return {1, reservation_id}
