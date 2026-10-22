package ws

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/auth"
	"github.com/CraazzzyyFoxx/anak-tournaments/gateway/internal/protocol"
)

// perUserAuthorizer allows every subscribe until a user is denied, so one test
// can subscribe both connections and then take the decision away from one of
// them — exactly what an organizer hiding a chat does.
type perUserAuthorizer struct {
	mu     sync.Mutex
	denied map[int64]bool
}

func (a *perUserAuthorizer) Allow(_ context.Context, user *auth.User, _ string) (bool, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if user == nil {
		return true, nil
	}
	return !a.denied[user.ID], nil
}

func (a *perUserAuthorizer) deny(userID int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.denied[userID] = true
}

type roomCall struct {
	kind  string
	refID int64
}

type fakeACLCache struct {
	mu      sync.Mutex
	calls   []roomCall
	evicted []int64
}

func (f *fakeACLCache) InvalidateRoomSpectatorRead(roomKind string, refID int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, roomCall{roomKind, refID})
}

func (f *fakeACLCache) EvictUser(userID int64) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.evicted = append(f.evicted, userID)
}

func (f *fakeACLCache) seen() []roomCall {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]roomCall(nil), f.calls...)
}

func (f *fakeACLCache) evictedUsers() []int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]int64(nil), f.evicted...)
}

// newServerWithHub is newServer with the hub supplied by the caller, so a test
// can inspect and fan out to the same registry the handler uses.
func newServerWithHub(t *testing.T, hub *Hub, authz Authorizer) string {
	t.Helper()
	h := NewHandler(hub, auth.New(wsSecret), authz, fakeReplayer{}, 30*time.Second,
		slog.New(slog.NewTextHandler(io.Discard, nil)), nil, nil, nil, nil, Limits{})
	mux := http.NewServeMux()
	mux.Handle("/ws", h)
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)
	return srv.URL
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func visibilityFrame(topic string, canRead bool) []byte {
	return protocol.EventFrame(topic, protocol.Envelope{
		EventType: "chat.visibility_changed",
		Data:      map[string]any{"spectators_can_read": canRead},
	})
}

// The whole point of the revoker: an organizer closing the chat must drop the
// spectators already subscribed, and must not disturb the participants.
func TestTopicRevoker_DropsSubscribersNowDenied(t *testing.T) {
	const topic = "encounter:1:chat"
	ctx := context.Background()

	hub := NewHub()
	authz := &perUserAuthorizer{denied: map[int64]bool{}}
	url := newServerWithHub(t, hub, authz)

	// 1 stays allowed (a captain), 2 loses access (a spectator).
	captain := dial(t, ctx, url, mintToken(t, "1"))
	writeJSON(t, ctx, captain, map[string]any{"op": "subscribe", "topic": topic})
	if m := readJSON(t, ctx, captain); m["op"] != "subscribed" {
		t.Fatalf("captain expected subscribed, got %v", m)
	}
	spectator := dial(t, ctx, url, mintToken(t, "2"))
	writeJSON(t, ctx, spectator, map[string]any{"op": "subscribe", "topic": topic})
	if m := readJSON(t, ctx, spectator); m["op"] != "subscribed" {
		t.Fatalf("spectator expected subscribed, got %v", m)
	}

	rooms := &fakeACLCache{}
	revoker := NewTopicRevoker(hub, authz, rooms, discardLogger())

	authz.deny(2)
	revoker.Broadcast(topic, visibilityFrame(topic, false))

	m := readJSON(t, ctx, spectator)
	if m["op"] != "error" || m["code"] != "forbidden" || m["topic"] != topic {
		t.Fatalf("spectator expected a forbidden revocation frame for %s, got %v", topic, m)
	}
	if subs := hub.SubscribersOf(topic); len(subs) != 1 {
		t.Fatalf("expected exactly one surviving subscriber, got %d", len(subs))
	}

	// The survivor is still receiving the room's traffic.
	hub.Broadcast(topic, protocol.EventFrame(topic, protocol.Envelope{EventType: "chat.message"}))
	if m := readJSON(t, ctx, captain); m["op"] != "event" {
		t.Fatalf("captain should still receive room events, got %v", m)
	}

	// The cached setting is dropped before the re-check, or the re-check would
	// be answered from the value the event just contradicted.
	if calls := rooms.seen(); len(calls) != 1 || calls[0] != (roomCall{"encounter", 1}) {
		t.Fatalf("expected one invalidation of (encounter, 1), got %v", calls)
	}
}

// Every realtime frame passes through Broadcast, so anything that is neither a
// visibility change nor an RBAC change must cost nothing: no invalidation, no
// eviction, no ACL pass.
func TestTopicRevoker_IgnoresOtherEvents(t *testing.T) {
	hub := NewHub()
	rooms := &fakeACLCache{}
	revoker := NewTopicRevoker(hub, &perUserAuthorizer{denied: map[int64]bool{}}, rooms, discardLogger())

	revoker.Broadcast("encounter:1:chat", protocol.EventFrame("encounter:1:chat", protocol.Envelope{EventType: "chat.message"}))
	revoker.Broadcast("tournament:1:bracket", visibilityFrame("tournament:1:bracket", false))
	revoker.Broadcast("user:1:notifications", protocol.EventFrame("user:1:notifications", protocol.Envelope{EventType: "notification.created"}))

	if calls := rooms.seen(); len(calls) != 0 {
		t.Fatalf("expected no invalidation, got %v", calls)
	}

	if users := rooms.evictedUsers(); len(users) != 0 {
		t.Fatalf("expected no user eviction, got %v", users)
	}
}

// workspaceAuthorizer admits workspace:1:* to its members only and every other
// topic to anyone, standing in for the membership the ACL reads from the DB.
type workspaceAuthorizer struct {
	mu      sync.Mutex
	members map[int64]bool
}

func (a *workspaceAuthorizer) Allow(_ context.Context, user *auth.User, topic string) (bool, error) {
	if !strings.HasPrefix(topic, "workspace:1:") {
		return true, nil
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	return user != nil && a.members[user.ID], nil
}

func (a *workspaceAuthorizer) remove(userID int64) {
	a.mu.Lock()
	defer a.mu.Unlock()
	delete(a.members, userID)
}

// identity-svc announces realtime:user:{id}:rbac after a membership change. A
// removed member's cached answers must go at once, and the workspace topics
// they already hold must stop delivering — not linger until the membership
// cache expires or the socket reconnects. Their other topics, and every other
// member, stay put.
func TestTopicRevoker_RBACChangeDropsTopicsTheUserLost(t *testing.T) {
	const wsTopic, publicTopic = "workspace:1:invalidation", "tournament:5:bracket"
	ctx := context.Background()

	hub := NewHub()
	authz := &workspaceAuthorizer{members: map[int64]bool{1: true, 2: true}}
	url := newServerWithHub(t, hub, authz)

	subscribe := func(c *websocket.Conn, topic string) {
		t.Helper()
		writeJSON(t, ctx, c, map[string]any{"op": "subscribe", "topic": topic})
		if m := readJSON(t, ctx, c); m["op"] != "subscribed" || m["topic"] != topic {
			t.Fatalf("expected subscribed to %s, got %v", topic, m)
		}
	}
	stays := dial(t, ctx, url, mintToken(t, "1"))
	subscribe(stays, wsTopic)
	removed := dial(t, ctx, url, mintToken(t, "2"))
	subscribe(removed, wsTopic)
	subscribe(removed, publicTopic)

	cache := &fakeACLCache{}
	revoker := NewTopicRevoker(hub, authz, cache, discardLogger())

	authz.remove(2)
	revoker.Broadcast("user:2:rbac", protocol.EventFrame("user:2:rbac", protocol.Envelope{EventType: "rbac.changed"}))

	// Evicted before Broadcast returns: a subscribe handled after the frame
	// must not be answered from the pre-change entry.
	if users := cache.evictedUsers(); len(users) != 1 || users[0] != 2 {
		t.Fatalf("expected user 2's cached ACL answers evicted, got %v", users)
	}

	m := readJSON(t, ctx, removed)
	if m["op"] != "error" || m["code"] != "forbidden" || m["topic"] != wsTopic {
		t.Fatalf("removed member expected a forbidden revocation frame for %s, got %v", wsTopic, m)
	}

	// The workspace frame reaches only the remaining member; the removed one's
	// next frame is the public topic it still holds.
	hub.Broadcast(wsTopic, protocol.EventFrame(wsTopic, protocol.Envelope{EventType: "workspace.changed"}))
	hub.Broadcast(publicTopic, protocol.EventFrame(publicTopic, protocol.Envelope{EventType: "bracket.changed"}))
	if m := readJSON(t, ctx, stays); m["op"] != "event" || m["topic"] != wsTopic {
		t.Fatalf("remaining member should still receive %s, got %v", wsTopic, m)
	}
	if m := readJSON(t, ctx, removed); m["op"] != "event" || m["topic"] != publicTopic {
		t.Fatalf("removed member should receive only %s now, got %v", publicTopic, m)
	}
}
