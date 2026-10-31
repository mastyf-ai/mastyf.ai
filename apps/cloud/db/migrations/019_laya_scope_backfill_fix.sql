-- Migration 019: 017 gave laya:classify to every live key, including keys deliberately limited
-- to a few scopes. Keep it only on keys that held at least the old defaults (badge:read and
-- policy:read) and take it off narrower keys.
--
-- A key with no recognized scopes (an empty list, say) was read as having the defaults, but 017
-- turned it into ["laya:classify"], which dropped badge:read and policy:read. Those get the
-- defaults back explicitly and keep laya:classify.

WITH k AS (
  SELECT id,
         scopes::jsonb AS j,
         (SELECT count(*)
            FROM jsonb_array_elements_text(scopes::jsonb) AS s
           WHERE s IN ('badge:read', 'deep-scan:run', 'policy:read', 'policy:write', 'keys:manage')) AS known
    FROM api_keys
   WHERE revoked_at IS NULL
     AND scopes LIKE '[%'
     AND scopes::jsonb @> '["laya:classify"]'::jsonb
)
UPDATE api_keys AS a
   SET scopes = CASE
         WHEN k.known = 0 THEN (k.j || '["badge:read","policy:read"]'::jsonb)::text
         ELSE (SELECT COALESCE(jsonb_agg(e.s ORDER BY e.i), '[]'::jsonb)
                 FROM jsonb_array_elements(k.j) WITH ORDINALITY AS e(s, i)
                WHERE e.s <> '"laya:classify"'::jsonb)::text
       END
  FROM k
 WHERE a.id = k.id
   AND NOT k.j @> '["badge:read","policy:read"]'::jsonb;
