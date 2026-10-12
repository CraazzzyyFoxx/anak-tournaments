package workspace

import (
	"strings"
	"testing"
)

// The two encounter lookups run against the encounter layer (spec §13.3): the
// encounter root moved to `encounter.encounter`, and an encounter's
// participants are the live rows of `encounter.team` — there is no home/away
// pair and no `encounter_participant` table any more. These are raw SQL
// strings, so nothing but a test notices when they drift from the schema.
func TestEncounterTournamentSQLReadsTheEncounterSchema(t *testing.T) {
	if !strings.Contains(encounterTournamentSQL, "encounter.encounter") {
		t.Fatalf("encounterTournamentSQL must read encounter.encounter, got: %s", encounterTournamentSQL)
	}
	if strings.Contains(encounterTournamentSQL, "tournament.encounter") {
		t.Fatalf("encounterTournamentSQL still reads the moved table: %s", encounterTournamentSQL)
	}
}

func TestIsEncounterCaptainSQLReadsParticipations(t *testing.T) {
	for _, want := range []string{
		"encounter.team",
		"encounter_id = $1",
		"active",
		"team_id IS NOT NULL",
	} {
		if !strings.Contains(isEncounterCaptainSQL, want) {
			t.Fatalf("isEncounterCaptainSQL must contain %q, got: %s", want, isEncounterCaptainSQL)
		}
	}
	// The dropped columns and the dropped table: a captain is now any live
	// participation's source team, whatever the slot count.
	for _, gone := range []string{"home_team_id", "away_team_id", "encounter_participant"} {
		if strings.Contains(isEncounterCaptainSQL, gone) {
			t.Fatalf("isEncounterCaptainSQL still references %q: %s", gone, isEncounterCaptainSQL)
		}
	}
}
