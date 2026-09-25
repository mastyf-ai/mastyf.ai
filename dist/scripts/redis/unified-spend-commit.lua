-- Commit reservation and reconcile daily USD delta vs estimate.
-- ARGV[1] = reservation_id
-- ARGV[2] = actual_usd_micro
-- ARGV[3] = day_key (optional, for delta reconcile)
-- ARGV[4] = day_ttl (optional)

local reservation_id = ARGV[1]
local actual_micro = tonumber(ARGV[2]) or 0
local day_key = ARGV[3]
local day_ttl = tonumber(ARGV[4]) or 86400
local meta_key = 'mastyf_ai:reservation:' .. reservation_id

local reserved_micro = tonumber(redis.call('HGET', meta_key, '_usd_micro') or '0') or 0
local delta = actual_micro - reserved_micro

if day_key and day_key ~= '' and delta ~= 0 then
  redis.call('INCRBY', day_key, delta)
  redis.call('EXPIRE', day_key, day_ttl)
end

redis.call('DEL', meta_key)
return 1
