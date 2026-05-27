package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

type mcpRequest struct {
	Method string `json:"method"`
	Params struct {
		Name     string                 `json:"name"`
		ToolName string                 `json:"toolName"`
		Arguments map[string]any        `json:"arguments"`
		Meta     map[string]interface{} `json:"_meta"`
	} `json:"params"`
}

type compiledRules struct {
	SchemaVersion           string   `json:"schemaVersion"`
	GeneratedAt             string   `json:"generatedAt"`
	SourcePolicyVersion     string   `json:"sourcePolicyVersion"`
	MinProxyVersion         string   `json:"minProxyVersion"`
	BlockedTools            []string `json:"blockedTools"`
	AllowedTools            []string `json:"allowedTools"`
	BlockedMethodSubstrings []string `json:"blockedMethodSubstrings"`
	PolicyMode              string   `json:"policyMode"`
	DefaultAction           string   `json:"defaultAction"`
}

type rulesCache struct {
	mu         sync.RWMutex
	rules      compiledRules
	lastSyncAt time.Time
	etag       string
	ready      bool
}

func (c *rulesCache) get() (compiledRules, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.rules, c.ready
}

func (c *rulesCache) set(r compiledRules, etag string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.rules = r
	c.etag = etag
	c.lastSyncAt = time.Now().UTC()
	c.ready = true
}

func (c *rulesCache) snapshot() map[string]any {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return map[string]any{
		"ready":            c.ready,
		"schemaVersion":    c.rules.SchemaVersion,
		"lastSyncAt":       c.lastSyncAt.Format(time.RFC3339),
		"sourcePolicy":     c.rules.SourcePolicyVersion,
		"blockedToolsCount": len(c.rules.BlockedTools),
		"etag":             c.etag,
	}
}

func envOrDefault(key string, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseBool(key string, fallback bool) bool {
	v := strings.TrimSpace(strings.ToLower(os.Getenv(key)))
	if v == "" {
		return fallback
	}
	return v == "1" || v == "true" || v == "yes" || v == "on"
}

func parseDurationMs(key string, fallback int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallback) * time.Millisecond
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return time.Duration(fallback) * time.Millisecond
	}
	return time.Duration(n) * time.Millisecond
}

func parseStaticDenylist() map[string]struct{} {
	deny := map[string]struct{}{}
	raw := envOrDefault("STATIC_DENYLIST", "delete_database,exfiltrate_keys")
	for _, item := range strings.Split(raw, ",") {
		name := strings.TrimSpace(strings.ToLower(item))
		if name == "" {
			continue
		}
		deny[name] = struct{}{}
	}
	return deny
}

func extractToolName(req mcpRequest) string {
	if req.Params.Name != "" {
		return req.Params.Name
	}
	if req.Params.ToolName != "" {
		return req.Params.ToolName
	}
	return req.Method
}

func shouldBlock(req mcpRequest, rules compiledRules, staticDenylist map[string]struct{}) (bool, string) {
	if req.Method != "tools/call" {
		return false, ""
	}
	tool := strings.ToLower(extractToolName(req))
	if tool == "" {
		return false, ""
	}
	if _, found := staticDenylist[tool]; found {
		return true, "blocked_by_static_denylist"
	}
	for _, name := range rules.BlockedTools {
		if strings.EqualFold(name, tool) {
			return true, "blocked_by_compiled_rules.blockedTools"
		}
	}
	for _, term := range rules.BlockedMethodSubstrings {
		if term != "" && strings.Contains(strings.ToLower(tool), strings.ToLower(term)) {
			return true, "blocked_by_compiled_rules.blockedMethodSubstrings"
		}
	}
	return false, ""
}

func writeJsonRPCDeny(w http.ResponseWriter, reason string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusForbidden)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"jsonrpc": "2.0",
		"error": map[string]any{
			"code":    -32003,
			"message": "MCP Guardian Data Plane blocked this tool call",
			"data": map[string]any{
				"reason": reason,
			},
		},
	})
}

func syncRules(cache *rulesCache, controlPlaneURL string, client *http.Client) {
	cache.mu.RLock()
	etag := cache.etag
	cache.mu.RUnlock()

	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(controlPlaneURL, "/")+"/internal/api/rules", nil)
	if err != nil {
		log.Printf("rules sync build request error: %v", err)
		return
	}
	if etag != "" {
		req.Header.Set("If-None-Match", etag)
	}
	res, err := client.Do(req)
	if err != nil {
		log.Printf("rules sync request failed: %v", err)
		return
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotModified {
		return
	}
	if res.StatusCode != http.StatusOK {
		log.Printf("rules sync non-200 status: %d", res.StatusCode)
		return
	}
	var rules compiledRules
	if err := json.NewDecoder(res.Body).Decode(&rules); err != nil {
		log.Printf("rules sync decode failed: %v", err)
		return
	}
	cache.set(rules, res.Header.Get("ETag"))
	log.Printf(
		"rules synced schema=%s policy=%s blockedTools=%d",
		rules.SchemaVersion,
		rules.SourcePolicyVersion,
		len(rules.BlockedTools),
	)
}

func main() {
	upstreamRaw := envOrDefault("UPSTREAM_URL", "http://localhost:8080")
	controlPlaneURL := envOrDefault("CONTROL_PLANE_URL", "http://localhost:3000")
	port := envOrDefault("DATA_PLANE_PORT", "9090")
	shadowMode := parseBool("DATA_PLANE_SHADOW_MODE", false)
	failOpen := parseBool("DATA_PLANE_FAIL_OPEN", true)
	refreshInterval := parseDurationMs("RULES_REFRESH_INTERVAL_MS", 3000)
	staticDenylist := parseStaticDenylist()

	upstream, err := url.Parse(upstreamRaw)
	if err != nil {
		log.Fatalf("invalid UPSTREAM_URL %q: %v", upstreamRaw, err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)

	cache := &rulesCache{}
	rulesClient := &http.Client{Timeout: 2 * time.Second}
	syncRules(cache, controlPlaneURL, rulesClient)

	go func() {
		ticker := time.NewTicker(refreshInterval)
		defer ticker.Stop()
		for range ticker.C {
			syncRules(cache, controlPlaneURL, rulesClient)
		}
	}()

	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"ok":      true,
			"service": "mcp-guardian-data-plane",
		})
	})
	mux.HandleFunc("/readyz", func(w http.ResponseWriter, _ *http.Request) {
		_, ready := cache.get()
		if !ready && !failOpen {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(cache.snapshot())
	})
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			proxy.ServeHTTP(w, r)
			return
		}

		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "failed to read request body", http.StatusBadRequest)
			return
		}
		r.Body.Close()
		r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

		var req mcpRequest
		if err := json.Unmarshal(bodyBytes, &req); err != nil {
			proxy.ServeHTTP(w, r)
			return
		}

		rules, ready := cache.get()
		if !ready && !failOpen {
			http.Error(w, "rules unavailable in strict mode", http.StatusServiceUnavailable)
			return
		}
		should, reason := shouldBlock(req, rules, staticDenylist)
		if should && !shadowMode {
			writeJsonRPCDeny(w, reason)
			return
		}
		if should && shadowMode {
			r.Header.Set("X-Guardian-Shadow-Blocked", "true")
			r.Header.Set("X-Guardian-Shadow-Reason", reason)
		}
		proxy.ServeHTTP(w, r)
	})

	log.Printf(
		"mcp-guardian data-plane listening on :%s -> %s (control=%s, shadow=%t, failOpen=%t)",
		port,
		upstream.String(),
		controlPlaneURL,
		shadowMode,
		failOpen,
	)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
