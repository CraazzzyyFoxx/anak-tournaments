package apidocs

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/openapi"
)

// The published request of the canonical ingest route is the bare owt.match/1 document: never the private
// raw_base64 RPC request nor the server-side producer envelope.
func TestIngestRoutesPublishTheBareMatchDocument(t *testing.T) {
	public, admin := Groups()
	raw := openapi.Build(openapi.Info{Title: "t", Version: "1"}, public)
	var spec struct {
		Paths      map[string]map[string]json.RawMessage `json:"paths"`
		Components struct {
			Schemas map[string]json.RawMessage `json:"schemas"`
		} `json:"components"`
	}
	if err := json.Unmarshal(raw, &spec); err != nil {
		t.Fatal(err)
	}
	submit, ok := spec.Paths["/api/v1/stats/matches"]["post"]
	if !ok {
		t.Fatal("POST /api/v1/stats/matches is not documented in the public spec")
	}
	text := string(submit)
	if !strings.Contains(text, `MatchDoc"`) {
		t.Fatalf("request does not resolve to MatchDoc: %s", text)
	}
	for _, private := range []string{"raw_base64", "producer"} {
		if strings.Contains(text, private) {
			t.Fatalf("private transport field %q leaked into the public operation", private)
		}
		for name, schema := range spec.Components.Schemas {
			if strings.HasSuffix(name, "MatchDoc") && strings.Contains(string(schema), `"`+private+`"`) {
				t.Fatalf("%q is a public MatchDoc property", private)
			}
		}
	}
	if _, ok := spec.Paths["/api/v1/stats/ingest-jobs/{id}"]["get"]; !ok {
		t.Fatal("GET /api/v1/stats/ingest-jobs/{id} is not documented")
	}
	if strings.Contains(string(openapi.Build(openapi.Info{Title: "t", Version: "1"}, admin)), "/api/v1/stats/matches") {
		t.Fatal("the producer API belongs to the public spec only")
	}
}
