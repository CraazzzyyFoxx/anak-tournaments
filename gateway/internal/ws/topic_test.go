package ws

import "testing"

// A draft board broadcasts draft presence on its session topic for both owners; the draft chat and the retired
// tournament draft topic do not, and a balancer topic keeps its own presence.
func TestPresenceTopics(t *testing.T) {
	cases := map[string]string{
		"draft:5:board":         DraftPresence,
		"tournament:1:balancer": BalancerPresence,
	}
	for topic, want := range cases {
		if !IsPresenceTopic(topic) || presenceEventType(topic) != want {
			t.Fatalf("%s: presence=%v type=%q, want %q", topic, IsPresenceTopic(topic), presenceEventType(topic), want)
		}
	}
	for _, topic := range []string{"draft:5:chat", "tournament:1:draft", "encounter:1:pick-ban:hero"} {
		if IsPresenceTopic(topic) {
			t.Fatalf("%s must not broadcast presence", topic)
		}
	}
}
