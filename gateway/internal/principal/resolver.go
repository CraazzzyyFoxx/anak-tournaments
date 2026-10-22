// Package principal resolves the authenticated identity for a request by calling
// identity-svc's rpc.identity.validate_token (the gateway is the only auth
// authority), caching the result briefly. The resolved RBAC payload is injected
// into downstream RPC calls; headless workers rehydrate it without a DB hit.
package principal

import (
	"container/list"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/auth"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/rpc"
)

const (
	validateQueue   = "rpc.identity.validate_token"
	validateTimeout = 5 * time.Second
	cacheTTL        = 30 * time.Second
	// apiKeyCacheTTL is deliberately shorter than cacheTTL. An access token is
	// short-lived and self-expiring, so caching its verdict for 30s is bounded
	// by the token's own exp anyway. An API key lives for months and revocation
	// is the ONLY way to stop it — so every cached second is a second a revoked
	// key keeps working, on a credential that lives in scripts and CI rather
	// than a browser the operator can just log out. 5s still collapses the
	// burst these keys actually produce (a script firing calls back to back)
	// into one validate_token, while keeping the post-revocation window inside
	// a single human reaction.
	apiKeyCacheTTL  = 5 * time.Second
	maxCacheEntries = 4096

	// credentialAPIKey is the payload's credential_type for an opaque API key;
	// anything else (in practice "access_token", or absent) is a session.
	credentialAPIKey = "api_key"

	// rbacTopicPrefix/rbacTopicSuffix frame the realtime topic identity-svc
	// publishes whenever it drops a user's cached RBAC: "user:{id}:rbac"
	// (backend/identity-service/src/services/session_cache.py, RBAC_DOMAIN).
	rbacTopicPrefix = "user:"
	rbacTopicSuffix = ":rbac"
)

// RPCCaller is the subset of rpc.Client the resolver needs.
type RPCCaller interface {
	Call(ctx context.Context, queue string, body []byte) ([]byte, error)
}

// Info is the typed view of a validated identity payload: the handful of fields
// the gateway itself acts on, parsed ONCE when the payload is judged instead of
// re-walking the untyped map at every call site. Per-key rate limiting and
// WebSocket authentication both need them on every request.
type Info struct {
	// UserID is the credential's OWNING user — for an API key, the user who
	// created it, which is what workspace membership is keyed by.
	UserID int64
	// CredentialType is the payload's credential_type ("api_key" or
	// "access_token"); empty when the payload carried none.
	CredentialType string
	// APIKeyID and APIKeyPublicID identify the key itself (zero/empty for a
	// session). APIKeyID is the per-key rate-limit bucket.
	APIKeyID       int64
	APIKeyPublicID string
	// RequestsPerMinute is the key's own api_key.limits.requests_per_minute
	// budget; 0 when the key carries no explicit value, meaning "fall back to
	// the platform default".
	RequestsPerMinute int
	// WorkspaceGrants counts the rbac_permissions entries across every
	// workspace in the payload. Zero means the credential holds no workspace
	// authority at all — for an API key that is the empty-scope case, which
	// surfaces gated by MEMBERSHIP rather than permission (the WebSocket feed)
	// must not treat as authenticated.
	WorkspaceGrants int
	// IsSuperuser is the payload's is_superuser flag: a platform operator, who
	// may act on a workspace without appearing on its roster. Edge metering
	// trusts it to attribute such a request to the named workspace rather than
	// to the anonymous/public bucket.
	IsSuperuser bool
	// APIKeyWorkspaceID is the single workspace an API key is pinned to
	// (payload api_key.workspace_id); zero for a session.
	APIKeyWorkspaceID int64
	// WorkspaceIDs lists every workspace the payload carries, in order. It is
	// the membership set edge metering attributes a request to — a session may
	// hold several, an API key exactly one.
	WorkspaceIDs []int64
}

// IsAPIKey reports whether this identity was authenticated by an API key rather
// than a session access token.
func (i Info) IsAPIKey() bool { return i.CredentialType == credentialAPIKey }

type entry struct {
	payload map[string]any
	info    Info
	ok      bool
	exp     time.Time
}

// cacheItem is what the LRU list elements hold: the entry plus its own token,
// so eviction of the list tail can delete the map key without a reverse index.
type cacheItem struct {
	token string
	entry
}

// Resolver validates bearer tokens via identity-svc and caches the RBAC payload.
//
// The cache is a TTL'd LRU: hits refresh recency, and when it is full the
// least-recently-used token is evicted — a flood of one-off tokens can no
// longer wipe every active session's entry at once (the old behavior dropped
// the whole map on overflow). Concurrent misses for the same token are
// collapsed into a single validate_token RPC via singleflight.
//
// The TTL is only the backstop: identity-svc announces every RBAC change
// (membership, role, deny) on the realtime bus and Broadcast evicts that
// user's entries, so a grant or a revocation applies on the next request.
type Resolver struct {
	rpc    RPCCaller
	now    func() time.Time
	flight singleflight.Group
	mu     sync.Mutex
	cache  map[string]*list.Element // token -> element in order (holds *cacheItem)
	order  *list.List               // most recently used at the front
	// epoch counts EvictUser calls. A validation snapshots it before going to
	// identity-svc: an answer read before an RBAC change must neither be
	// stored after that change's eviction (which found nothing to drop yet)
	// nor be shared with a request that arrived after it.
	epoch uint64
}

// New builds a resolver over the shared RPC client.
func New(caller RPCCaller) *Resolver {
	return &Resolver{rpc: caller, now: time.Now, cache: make(map[string]*list.Element), order: list.New()}
}

// Resolve implements edge.IdentityResolver: bearer token -> RBAC payload.
//
// A non-nil error means the identity backend was unavailable (the RPC
// bulkhead shed the call, the client was disconnected, or the call timed
// out) — the caller should respond 503, not 401. Anonymous requests (no
// bearer token) never produce an error.
func (r *Resolver) Resolve(req *http.Request) (map[string]any, bool, error) {
	e, err := r.resolveToken(req.Context(), bearer(req))
	if err != nil {
		return nil, false, err
	}
	return e.payload, e.ok, nil
}

// ResolveWithSessionCookie is Resolve for the one class of route a browser
// NAVIGATES to rather than fetches: a file download behind `<a download>`,
// where no JavaScript runs to attach an Authorization header and the session
// cookie is the only credential the request can carry. Header first, cookie
// only as the fallback.
//
// Deliberately not the default for every route, and deliberately not widened to
// ?token=: a credential in a URL lands in every proxy access log and in browser
// history, and a cookie-authenticated MUTATION would need the CSRF defences a
// plain GET download does not. Downloads only.
func (r *Resolver) ResolveWithSessionCookie(req *http.Request) (map[string]any, bool, error) {
	token := bearer(req)
	if token == "" {
		token = sessionCookie(req)
	}
	e, err := r.resolveToken(req.Context(), token)
	if err != nil {
		return nil, false, err
	}
	return e.payload, e.ok, nil
}

// Principal is Resolve's typed sibling: the same bearer token, the same cache
// entry and the same single validate_token RPC, but the parsed Info instead of
// the untyped payload. Error semantics are identical to Resolve's.
func (r *Resolver) Principal(req *http.Request) (Info, bool, error) {
	e, err := r.resolveToken(req.Context(), bearer(req))
	if err != nil {
		return Info{}, false, err
	}
	return e.info, e.ok, nil
}

// PrincipalToken resolves an explicitly supplied credential, for the one
// surface where it does not arrive in an Authorization header: the WebSocket
// handshake also accepts ?token= (see auth.extractToken). bearer deliberately
// does NOT read the query string — accepting REST credentials there would put
// them in every proxy access log — so the WS path passes the token it already
// extracted rather than widening the header rule for everyone.
func (r *Resolver) PrincipalToken(ctx context.Context, token string) (Info, bool, error) {
	e, err := r.resolveToken(ctx, token)
	if err != nil {
		return Info{}, false, err
	}
	return e.info, e.ok, nil
}

// resolveToken is the single cache + singleflight path behind all three public
// views: exactly one validate_token per token per flight, one cache entry
// feeding both the raw payload and its typed form. An empty token is anonymous
// (zero entry, no error, no RPC).
func (r *Resolver) resolveToken(ctx context.Context, token string) (entry, error) {
	if token == "" {
		return entry{}, nil
	}

	e, epoch, ok := r.lookup(token)
	if ok {
		return e, nil
	}

	// Collapse concurrent misses for the same token into one RPC: a burst of
	// requests from one session (page load fans out N API calls) used to fire
	// N identical validate_token calls until the first reply landed in the
	// cache. DoChan (not Do) so each waiter still honors its own request
	// context instead of blocking past its client's disconnect. The epoch is
	// part of the key so a request arriving after an eviction never joins a
	// flight that started before it.
	ch := r.flight.DoChan(strconv.FormatUint(epoch, 10)+":"+token, func() (any, error) {
		return r.validate(ctx, token, epoch)
	})
	select {
	case res := <-ch:
		if res.Err != nil {
			return entry{}, res.Err
		}
		return res.Val.(entry), nil
	case <-ctx.Done():
		return entry{}, ctx.Err()
	}
}

// validate performs the validate_token RPC and stores the judged result. It
// runs at most once per token per flight; the result is shared by every
// concurrent waiter, so it detaches from the winning request's cancellation
// (one impatient client must not fail validation for the others) while keeping
// its context values (trace/correlation) and the validateTimeout deadline —
// which still drives the AMQP TTL via rpc/deadline.go.
func (r *Resolver) validate(ctx context.Context, token string, epoch uint64) (entry, error) {
	body, _ := json.Marshal(map[string]any{"token": token})
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), validateTimeout)
	defer cancel()

	raw, err := r.rpc.Call(ctx, validateQueue, body)
	if err != nil {
		// Transport failure: the token was never actually judged by identity-svc,
		// so we must not cache ok=false here — that would keep a valid session
		// "logged out" for cacheTTL after a single hiccup (shed/disconnect/timeout).
		return entry{}, err
	}

	var payload map[string]any
	ok := false
	var env rpc.Envelope
	if json.Unmarshal(raw, &env) == nil && env.OK && len(env.Data) > 0 {
		if json.Unmarshal(env.Data, &payload) == nil {
			ok = true
		}
	}

	// An API key gets a shorter cache life than a session (see apiKeyCacheTTL).
	// The discriminator is the TOKEN's own prefix rather than the payload's
	// credential_type, so a REJECTED key — where there is no payload to read a
	// type from — is not pinned for the full session TTL either.
	ttl := cacheTTL
	if auth.IsAPIKey(token) {
		ttl = apiKeyCacheTTL
	}
	e := entry{payload: payload, info: parseInfo(payload), ok: ok, exp: r.now().Add(ttl)}
	r.store(token, e, epoch)
	return e, nil
}

// parseInfo extracts the typed view from a validated payload. Every field is
// optional-tolerant: identity-svc owns this schema, and a missing or
// wrong-typed field must degrade to its zero value rather than fail the whole
// validation — the untyped payload is still forwarded downstream verbatim, so
// the workers' own checks stay authoritative.
func parseInfo(payload map[string]any) Info {
	if payload == nil {
		return Info{}
	}
	info := Info{
		CredentialType: asString(payload["credential_type"]),
		IsSuperuser:    asBool(payload["is_superuser"]),
	}
	// identity-svc dumps TokenPayload with "sub"; the Python rehydrate path
	// accepts either spelling (shared/rpc/identity.py::_payload_user_id), so
	// mirror it here rather than pinning one.
	if info.UserID = asInt64(payload["user_id"]); info.UserID == 0 {
		info.UserID = asInt64(payload["sub"])
	}
	if key, ok := payload["api_key"].(map[string]any); ok {
		info.APIKeyID = asInt64(key["id"])
		info.APIKeyPublicID = asString(key["public_id"])
		info.APIKeyWorkspaceID = asInt64(key["workspace_id"])
		if limits, ok := key["limits"].(map[string]any); ok {
			info.RequestsPerMinute = int(asInt64(limits["requests_per_minute"]))
		}
	}
	for _, raw := range asSlice(payload["workspaces"]) {
		if ws, ok := raw.(map[string]any); ok {
			info.WorkspaceGrants += len(asSlice(ws["rbac_permissions"]))
			if id := asInt64(ws["workspace_id"]); id > 0 {
				info.WorkspaceIDs = append(info.WorkspaceIDs, id)
			}
		}
	}
	return info
}

// asInt64 coerces a decoded JSON scalar to int64. encoding/json turns numbers
// into float64, but ids have historically also arrived stringly-typed (JWT
// "sub" is a string claim), so both are accepted.
func asInt64(v any) int64 {
	switch t := v.(type) {
	case float64:
		return int64(t)
	case string:
		n, _ := strconv.ParseInt(t, 10, 64)
		return n
	}
	return 0
}

func asString(v any) string {
	s, _ := v.(string)
	return s
}

func asBool(v any) bool {
	b, _ := v.(bool)
	return b
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}

// APIKeyQuota implements ratelimit.KeyQuota: the bucket key and per-minute
// request budget of the API key behind req, or ok=false when there is none.
//
// The local prefix test comes FIRST, and that is what keeps the per-key limiter
// free for everything else: session and anonymous traffic never reach the
// resolver here, so wrapping the whole API mux adds no validate_token call that
// the route itself would not already have made. For a real key the verdict is
// shared with the route's own Resolve through the same cache entry, so it costs
// nothing extra there either.
//
// A resolver error (identity backend unavailable) reports ok=false rather than
// rejecting: the route behind the limiter resolves the same token and turns
// that into a 503, which is the honest answer — a 429 would not be.
func (r *Resolver) APIKeyQuota(req *http.Request) (string, int, bool) {
	if !auth.IsAPIKey(bearer(req)) {
		return "", 0, false
	}
	info, ok, err := r.Principal(req)
	if err != nil || !ok || info.APIKeyID == 0 {
		return "", 0, false
	}
	return strconv.FormatInt(info.APIKeyID, 10), info.RequestsPerMinute, true
}

// lookup returns the cached entry for token if present and unexpired,
// refreshing its LRU recency, plus the eviction epoch a miss must validate
// under. Expired entries are removed eagerly.
func (r *Resolver) lookup(token string) (entry, uint64, bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	el, ok := r.cache[token]
	if !ok {
		return entry{}, r.epoch, false
	}
	it := el.Value.(*cacheItem)
	if !r.now().Before(it.exp) {
		delete(r.cache, token)
		r.order.Remove(el)
		return entry{}, r.epoch, false
	}
	r.order.MoveToFront(el)
	return it.entry, r.epoch, true
}

// store caches e unless an eviction happened since the validation started
// (epoch): that answer may predate the RBAC change, and the next request
// simply validates again.
func (r *Resolver) store(token string, e entry, epoch uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if epoch != r.epoch {
		return
	}
	if el, ok := r.cache[token]; ok {
		el.Value.(*cacheItem).entry = e
		r.order.MoveToFront(el)
		return
	}
	// Bound memory: evict the least-recently-used entry instead of dropping
	// the cache wholesale, so active sessions survive a flood of one-offs.
	for len(r.cache) >= maxCacheEntries {
		back := r.order.Back()
		if back == nil {
			break
		}
		it := back.Value.(*cacheItem)
		delete(r.cache, it.token)
		r.order.Remove(back)
	}
	r.cache[token] = r.order.PushFront(&cacheItem{token: token, entry: e})
}

// Broadcast implements events.Broadcaster: identity-svc publishes
// realtime:user:{id}:rbac after dropping a user's cached RBAC, and every other
// topic is ignored.
func (r *Resolver) Broadcast(topic string, _ []byte) {
	rest, ok := strings.CutPrefix(topic, rbacTopicPrefix)
	if !ok {
		return
	}
	raw, ok := strings.CutSuffix(rest, rbacTopicSuffix)
	if !ok {
		return
	}
	if id, err := strconv.ParseInt(raw, 10, 64); err == nil && id > 0 {
		r.EvictUser(id)
	}
}

// EvictUser drops every cached verdict for userID — sessions and API keys
// alike, since a key's UserID is the owner whose grants it carries — and
// fences the validations already in flight (see epoch).
func (r *Resolver) EvictUser(userID int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.epoch++
	// ponytail: linear scan of at most maxCacheEntries under the lock; add a
	// user -> tokens index if RBAC changes ever become frequent.
	for el := r.order.Front(); el != nil; {
		next := el.Next()
		if it := el.Value.(*cacheItem); it.info.UserID == userID {
			delete(r.cache, it.token)
			r.order.Remove(el)
		}
		el = next
	}
}

func bearer(r *http.Request) string {
	scheme, creds, found := strings.Cut(r.Header.Get("Authorization"), " ")
	if found && strings.EqualFold(scheme, "bearer") {
		return strings.TrimSpace(creds)
	}
	return ""
}

// sessionCookie reads the access token out of the browser session cookie. Only
// ResolveWithSessionCookie calls it — the legacy name is still accepted so the
// aqt->owt rename does not log anyone out mid-download.
func sessionCookie(r *http.Request) string {
	for _, name := range []string{auth.CookieName, auth.LegacyCookieName} {
		if c, err := r.Cookie(name); err == nil && c.Value != "" {
			return strings.TrimSpace(strings.TrimPrefix(c.Value, "Bearer "))
		}
	}
	return ""
}
