-- Roll back a spend reservation.
-- ARGV[1] = reservation_id

local reservation_id = ARGV[1]
local meta_key = 'mastyf_ai:reservation:' .. reservation_id
local entries = redis.call('HGETALL', meta_key)
if not entries or #entries == 0 then
  return 0
end

for i = 1, #entries, 2 do
  local field = entries[i]
  local val = entries[i + 1]
  if field ~= '_tokens' and field ~= '_usd_micro' then
    local delta = tonumber(val) or 0
    if delta > 0 then
      local current = tonumber(redis.call('GET', field) or '0')
      local next_val = current - delta
      if next_val <= 0 then
        redis.call('DEL', field)
      else
        redis.call('SET', field, next_val)
      end
    end
  end
end

redis.call('DEL', meta_key)
return 1
