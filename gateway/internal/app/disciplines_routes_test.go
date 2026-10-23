package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
)

type captureCaller struct {
	queue string
	body  map[string]any
}

func (c *captureCaller) Call(_ context.Context, queue string, body []byte) ([]byte, error) {
	c.queue = queue
	c.body = map[string]any{}
	_ = json.Unmarshal(body, &c.body)
	return []byte(`{"ok":true,"data":[]}`), nil
}

// get serves one request through the real route table and returns what the worker received.
func getDiscipline(t *testing.T, identity edge.IdentityResolver, target string) *captureCaller {
	t.Helper()
	caller := &captureCaller{}
	d := edge.New(caller, slog.New(slog.NewTextHandler(io.Discard, nil)), identity)
	mux := http.NewServeMux()
	d.Register(mux, ReadRoutes)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
	if w.Code != http.StatusOK {
		t.Fatalf("GET %s -> %d %s", target, w.Code, w.Body.String())
	}
	return caller
}

func soleWorkspace(id float64) edge.IdentityResolver {
	return func(*http.Request) (map[string]any, bool, error) {
		return map[string]any{"user_id": float64(1), "workspaces": []any{map[string]any{"workspace_id": id}}}, true, nil
	}
}

func workspaceQuery(t *testing.T, c *captureCaller) []any {
	t.Helper()
	q, _ := c.body["query"].(map[string]any)
	got, _ := q["workspace_id"].([]any)
	return got
}

func TestDisciplineRoutesReachTheirQueuesAndAreNeverCached(t *testing.T) {
	for target, queue := range map[string]string{
		"/api/v1/disciplines?workspace_id=all":              "rpc.app.disciplines.list",
		"/api/v1/disciplines/lol/metadata?workspace_id=all": "rpc.app.disciplines.metadata",
	} {
		c := getDiscipline(t, nil, target)
		if c.queue != queue {
			t.Errorf("%s -> %q, want %q", target, c.queue, queue)
		}
	}
	if c := getDiscipline(t, nil, "/api/v1/disciplines/lol/metadata?workspace_id=all"); c.body["discipline"] != "lol" {
		t.Errorf("path discipline not forwarded: %v", c.body)
	}
	for pattern := range PublicCacheableReads {
		if pattern == "/api/v1/disciplines" || pattern == "/api/v1/disciplines/{discipline}/metadata" {
			t.Errorf("%s must not be gateway-cached", pattern)
		}
	}
}

func TestDisciplineRoutesAreAnonymousAndOptionalIdentity(t *testing.T) {
	// Anonymous: no identity key reaches the worker (rehydrate_user_optional(None) = viewer-less).
	c := getDiscipline(t, func(*http.Request) (map[string]any, bool, error) { return nil, false, nil }, "/api/v1/disciplines?workspace_id=5")
	if _, ok := c.body["identity"]; ok {
		t.Errorf("anonymous request carried identity: %v", c.body["identity"])
	}
	if got := workspaceQuery(t, c); len(got) != 1 || got[0] != "5" {
		t.Errorf("concrete workspace not forwarded: %v", got)
	}
	// Authenticated: the viewer reaches the worker so a hidden workspace's members can be recognised.
	c = getDiscipline(t, soleWorkspace(7), "/api/v1/disciplines/overwatch/metadata?workspace_id=7")
	if _, ok := c.body["identity"]; !ok {
		t.Error("authenticated request lost its identity")
	}
}

// A one-workspace credential must still be able to ask for the global view: an explicit `all` wins over the scope the
// gateway would otherwise fill in from the credential. Stripping authentication is not a global-scope workaround.
func TestExplicitAllWinsOverTheSingleWorkspaceCredential(t *testing.T) {
	for _, target := range []string{"/api/v1/disciplines?workspace_id=all", "/api/v1/disciplines/lol/metadata?workspace_id=all"} {
		c := getDiscipline(t, soleWorkspace(7), target)
		if got := workspaceQuery(t, c); len(got) != 1 || got[0] != "all" {
			t.Errorf("%s: workspace_id=%v, want [all]", target, got)
		}
		if _, ok := c.body["identity"]; !ok {
			t.Errorf("%s: viewer identity must stay attached", target)
		}
	}
}

func TestExplicitWorkspaceWinsAndAnOmittedOneIsTheCredentialDefault(t *testing.T) {
	if got := workspaceQuery(t, getDiscipline(t, soleWorkspace(7), "/api/v1/disciplines?workspace_id=9")); len(got) != 1 || got[0] != "9" {
		t.Errorf("explicit workspace overridden: %v", got)
	}
	// The frontend never omits the parameter; an omitted one keeps the gateway's existing credential default.
	if got := workspaceQuery(t, getDiscipline(t, soleWorkspace(7), "/api/v1/disciplines")); len(got) != 1 || got[0] != "7" {
		t.Errorf("credential default lost: %v", got)
	}
	if got := workspaceQuery(t, getDiscipline(t, nil, "/api/v1/disciplines")); got != nil {
		t.Errorf("anonymous omitted scope must stay absent, got %v", got)
	}
}
