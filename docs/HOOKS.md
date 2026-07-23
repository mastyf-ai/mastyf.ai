# Hook Authoring Guide

Hooks are JavaScript functions that run before or after every tool call, allowing custom enforcement logic without modifying the proxy.

## Built-in Hooks

| Hook | Type | Trigger |
|---|---|---|
| `builtin-rate-limit` | Before | 60 calls/min per user per tool |
| `builtin-pii-redaction` | After | Strips PII from tool responses |
| `builtin-sensitive-path-guard` | Before | Blocks access to /etc/shadow, .env, .aws/*, .ssh/* |
| `builtin-slack-notifier` | Before/After | Posts to Slack (when webhook configured) |
| `builtin-pagerduty-alert` | After | Triggers PagerDuty on tool failure |
| `builtin-time-based-access` | Before | Blocks outside allowed hours/days |
| `builtin-geo-fencing` | Before | Blocks from unapproved regions |

## Conditional Activation

```bash
# Slack notifications
MASTYF_AI_SLACK_WEBHOOK=https://hooks.slack.com/services/xxx

# PagerDuty alerts
ALERT_PAGERDUTY_KEY=your-routing-key

# Time-based access
MASTYF_AI_ACCESS_HOURS=8-18          # Mon-Fri 8am-6pm UTC
MASTYF_AI_ACCESS_DENIED_DAYS=0,6     # Block weekends

# Geo-fencing
MASTYF_AI_ALLOWED_REGIONS=US,GB,CA   # Only allow these regions
```

## Custom Hooks

Register from the dashboard (Settings → Hooks → Register Custom Hook) or via API:

```bash
curl -X POST http://localhost:4000/api/hooks \
  -H "Content-Type: application/json" \
  -d '{
    "name": "prod-lock-weekend",
    "code": "const d=new Date().getUTCDay();if(d===0||d===6)return{allowed:false,reason:\"No production access on weekends\"};return{allowed:true}",
    "type": "before",
    "priority": 3
  }'
```

## Hook API Reference

### Before Hook

```javascript
// context.tool — serverName, toolName, arguments, identity
// context.identity — sub, clientId, scopes, issuer
// context.tenantId — tenant ID
// context.hookState — Map for sharing state between hooks

// Return { allowed: true } or { allowed: false, reason: "..." }
// Optionally return { allowed: true, modifiedArgs: { ... } }
```

### After Hook

```javascript
// result — success, output, error, durationMs, toolName
// Return { allowed: true } or { allowed: false, reason: "..." }
// Optionally return { allowed: true, modifiedResult: { ... } }
```

### Error Hook

```javascript
// context — same as before hook
// error — the Error object
// No return value — best-effort notification
```

## Examples

### Block production deployments on weekends
```javascript
const d = new Date().getUTCDay();
if (d === 0 || d === 6) {
  return { allowed: false, reason: "No deployments on weekends" };
}
return { allowed: true };
```

### Redact SQL query results
```javascript
if (!result.output) return { allowed: true };
const cleaned = JSON.stringify(result.output)
  .replace(/"password":"[^"]+"/g, '"password":"***"')
  .replace(/"email":"[^"]+"/g, '"email":"***@***"');
return { allowed: true, modifiedResult: JSON.parse(cleaned) };
```

### Notify security team on blocked attack
```javascript
if (context.policyDecision?.action === 'block') {
  fetch('https://hooks.slack.com/xxx', {
    method: 'POST',
    body: JSON.stringify({ text: `Blocked: ${context.tool.toolName}` })
  }).catch(() => {});
}
return { allowed: true };
```
