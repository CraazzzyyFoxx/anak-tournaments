package parser

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"time"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/apierr"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/edge"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/rpc"
)

const (
	// Matches the edge dispatcher's RPC ceiling (old Kong edge allowance).
	binaryRPCTimeout = 120 * time.Second
	// parser's RequestSizeLimitMiddleware allows 50 MiB (log-file uploads).
	maxUpload = 50 << 20
)

// Binary serves the parser-service endpoints the generic JSON edge.Dispatcher
// can't: the admin match-log upload (multipart, possibly many files[] -> base64
// into the RPC body). Permission is enforced in the worker; the gateway only
// resolves + injects identity for the authenticated route.
type Binary struct {
	rpc      edge.RPCCaller
	identity edge.IdentityResolver
	log      *slog.Logger
}

// NewBinary builds the binary handler set. identity must be non-nil (the upload
// route is authenticated).
func NewBinary(caller edge.RPCCaller, identity edge.IdentityResolver, log *slog.Logger) *Binary {
	return &Binary{rpc: caller, identity: identity, log: log}
}

// AdminLogsUpload: POST /api/v1/admin/logs/upload. Reads the multipart form
// (tournament_id, optional encounter_id, one or more files[]) and base64-encodes
// each file into the RPC body for rpc.parser.logs.upload.
func (b *Binary) AdminLogsUpload(w http.ResponseWriter, r *http.Request) {
	if b.identity == nil {
		writeDetail(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	id, ok, err := b.identity(r)
	if err != nil {
		b.log.Error("identity resolution unavailable", "err", err)
		w.Header().Set("Retry-After", "1")
		writeDetail(w, http.StatusServiceUnavailable, "service unavailable")
		return
	}
	if !ok {
		writeDetail(w, http.StatusUnauthorized, "Not authenticated")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxUpload)
	if err := r.ParseMultipartForm(maxUpload); err != nil {
		writeDetail(w, http.StatusBadRequest, "invalid multipart form")
		return
	}

	body := map[string]any{"identity": id}
	if v := r.FormValue("tournament_id"); v != "" {
		body["tournament_id"] = v
	}
	if v := r.FormValue("encounter_id"); v != "" {
		body["encounter_id"] = v
	}

	encoded := []map[string]string{}
	if r.MultipartForm != nil {
		for _, fh := range r.MultipartForm.File["files[]"] {
			f, err := fh.Open()
			if err != nil {
				writeDetail(w, http.StatusBadRequest, "failed to read file")
				return
			}
			raw, err := io.ReadAll(io.LimitReader(f, maxUpload))
			_ = f.Close()
			if err != nil {
				writeDetail(w, http.StatusBadRequest, "failed to read file")
				return
			}
			encoded = append(encoded, map[string]string{
				"filename":    fh.Filename,
				"content_b64": base64.StdEncoding.EncodeToString(raw),
			})
		}
	}
	body["files"] = encoded

	b.relayJSON(w, r, "rpc.parser.logs.upload", body, http.StatusOK)
}

// relayJSON calls the RPC and relays the success envelope data as a JSON response.
func (b *Binary) relayJSON(w http.ResponseWriter, r *http.Request, queue string, data map[string]any, success int) {
	body, _ := json.Marshal(data)
	ctx, cancel := context.WithTimeout(r.Context(), binaryRPCTimeout)
	defer cancel()

	reply, err := b.rpc.Call(ctx, queue, body)
	if err != nil {
		if rpc.IsUnavailable(err) {
			b.log.Error("rpc unavailable", "queue", queue, "err", err)
			w.Header().Set("Retry-After", "1")
			writeDetail(w, http.StatusServiceUnavailable, "service unavailable")
			return
		}
		b.log.Error("rpc failed", "queue", queue, "err", err)
		writeDetail(w, http.StatusGatewayTimeout, "service timeout")
		return
	}

	var env rpc.Envelope
	if err := json.Unmarshal(reply, &env); err != nil {
		b.log.Error("invalid rpc envelope", "queue", queue, "err", err)
		writeDetail(w, http.StatusBadGateway, "invalid service response")
		return
	}
	if !env.OK {
		apierr.WriteEnvelopeError(w, env.Error)
		return
	}
	apierr.WriteOK(w, success, env)
}

// writeDetail emits the gateway's error body for this handler's OWN failures;
// upstream envelope errors go through apierr.WriteEnvelopeError so their code,
// structured details and Retry-After survive.
func writeDetail(w http.ResponseWriter, status int, detail string) {
	apierr.WriteError(w, status, detail, "", nil)
}
