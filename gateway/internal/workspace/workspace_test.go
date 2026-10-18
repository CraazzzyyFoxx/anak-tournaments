package workspace

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
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

// A mix round has no tournament (V2, D71): the lookup must answer "not found"
// instead of scanning NULL into an int64.
func TestEncounterTournamentSQLSkipsOwnerlessEncounters(t *testing.T) {
	if !strings.Contains(encounterTournamentSQL, "tournament_id IS NOT NULL") {
		t.Fatalf("encounterTournamentSQL must skip encounters without a tournament, got: %s", encounterTournamentSQL)
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

// The membership query decides who may spectate a hidden tournament. An observed_only anchor (a stats observation's
// row for a player nobody admitted) must not count, a real member and a removed one keep their answers. Runs against
// the real schema in a rolled-back transaction; skipped when no test database is reachable.
func TestIsMemberSQLIgnoresObservationOnlyAnchors(t *testing.T) {
	host, port := os.Getenv("POSTGRES_HOST"), os.Getenv("POSTGRES_PORT")
	if host == "" || port == "" {
		t.Skip("POSTGRES_HOST/POSTGRES_PORT not set")
	}
	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/%s", os.Getenv("POSTGRES_USER"), os.Getenv("POSTGRES_PASSWORD"), host, port, os.Getenv("POSTGRES_DB"))
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Skipf("test database unreachable: %v", err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	var workspaceID int64
	if err := tx.QueryRow(ctx, `INSERT INTO workspace (slug, name, disciplines_enabled) VALUES ('gw-observed-test', 'gw', ARRAY['overwatch']) RETURNING id`).Scan(&workspaceID); err != nil {
		t.Skipf("cannot seed workspace (schema not the expected one): %v", err)
	}
	var authID int64
	if err := tx.QueryRow(ctx, `INSERT INTO auth."user" (email, username, is_active, is_superuser, is_verified) VALUES ('gw-observed@example.com', 'gw_observed', true, false, false) RETURNING id`).Scan(&authID); err != nil {
		t.Skipf("cannot seed auth user: %v", err)
	}
	var playerID int64
	if err := tx.QueryRow(ctx, `INSERT INTO players."user" (name, auth_user_id) VALUES ('gw-observed-player', $1) RETURNING id`, authID).Scan(&playerID); err != nil {
		t.Skipf("cannot seed player: %v", err)
	}
	member := func(observed bool, removed bool) bool {
		if _, err := tx.Exec(ctx, `DELETE FROM workspace_member WHERE workspace_id = $1 AND player_id = $2`, workspaceID, playerID); err != nil {
			t.Fatal(err)
		}
		removedAt := "NULL"
		if removed {
			removedAt = "now()"
		}
		if _, err := tx.Exec(ctx, fmt.Sprintf(`INSERT INTO workspace_member (workspace_id, player_id, observed_only, removed_at) VALUES ($1, $2, $3, %s)`, removedAt), workspaceID, playerID, observed); err != nil {
			t.Fatal(err)
		}
		var is bool
		if err := tx.QueryRow(ctx, isMemberSQL, authID, workspaceID).Scan(&is); err != nil {
			t.Fatal(err)
		}
		return is
	}
	if !member(false, false) {
		t.Fatal("an admitted member must count")
	}
	if member(true, false) {
		t.Fatal("an observation-only anchor must not count as membership")
	}
	if member(false, true) {
		t.Fatal("a removed member must not count")
	}
}
