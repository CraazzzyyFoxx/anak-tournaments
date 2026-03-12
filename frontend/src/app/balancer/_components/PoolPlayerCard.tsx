"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Save, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BalancerPlayerRecord, BalancerPlayerRoleEntry, BalancerRoleCode, BalancerRoleSubtype } from "@/types/balancer-admin.types";

const ROLE_OPTIONS: Array<{ value: BalancerRoleCode; label: string }> = [
  { value: "tank", label: "Tank" },
  { value: "dps", label: "Damage" },
  { value: "support", label: "Support" },
];

const SUBTYPE_OPTIONS: Record<BalancerRoleCode, Array<{ value: BalancerRoleSubtype; label: string }>> = {
  tank: [],
  dps: [
    { value: "hitscan", label: "Hitscan" },
    { value: "projectile", label: "Projectile" },
  ],
  support: [
    { value: "main_heal", label: "Main Heal" },
    { value: "light_heal", label: "Light Heal" },
  ],
};

function resolveRankFromDivision(divisionNumber: number | null): number | null {
  if (divisionNumber == null) {
    return null;
  }

  const map: Record<number, number> = {
    20: 100,
    19: 250,
    18: 350,
    17: 450,
    16: 550,
    15: 650,
    14: 750,
    13: 850,
    12: 950,
    11: 1050,
    10: 1150,
    9: 1250,
    8: 1350,
    7: 1450,
    6: 1550,
    5: 1650,
    4: 1750,
    3: 1850,
    2: 1950,
    1: 2000,
  };

  return map[divisionNumber] ?? null;
}

function normalizeRoleEntries(entries: BalancerPlayerRoleEntry[]): BalancerPlayerRoleEntry[] {
  const seen = new Set<BalancerRoleCode>();
  const sorted = [...entries].sort((a, b) => a.priority - b.priority);
  const normalized: BalancerPlayerRoleEntry[] = [];

  for (const entry of sorted) {
    if (seen.has(entry.role)) {
      continue;
    }
    seen.add(entry.role);
    const divisionNumber = entry.division_number ?? null;
    normalized.push({
      role: entry.role,
      priority: normalized.length + 1,
      division_number: divisionNumber,
      rank_value: entry.rank_value ?? resolveRankFromDivision(divisionNumber),
    });
  }

  return normalized;
}

type PoolPlayerCardProps = {
  player: BalancerPlayerRecord;
  onSave: (playerId: number, payload: { role_entries_json: BalancerPlayerRoleEntry[]; is_in_pool: boolean; admin_notes: string | null }) => void;
  onRemove?: (playerId: number) => void;
  saving?: boolean;
};

export function PoolPlayerCard({ player, onSave, onRemove, saving = false }: PoolPlayerCardProps) {
  const [roleEntries, setRoleEntries] = useState<BalancerPlayerRoleEntry[]>(normalizeRoleEntries(player.role_entries_json));
  const [isInPool, setIsInPool] = useState(player.is_in_pool);
  const [notes, setNotes] = useState(player.admin_notes ?? "");

  useEffect(() => {
    setRoleEntries(normalizeRoleEntries(player.role_entries_json));
    setIsInPool(player.is_in_pool);
    setNotes(player.admin_notes ?? "");
  }, [player]);

  const rankedRolesCount = useMemo(
    () => roleEntries.filter((entry) => entry.rank_value !== null).length,
    [roleEntries],
  );

  const addRole = () => {
    const availableRole = ROLE_OPTIONS.find((option) => !roleEntries.some((entry) => entry.role === option.value));
    if (!availableRole) {
      return;
    }

    setRoleEntries((current) => [
      ...current,
      {
        role: availableRole.value,
        subtype: null,
        priority: current.length + 1,
        division_number: null,
        rank_value: null,
      },
    ]);
  };

  const updateEntry = (index: number, nextEntry: BalancerPlayerRoleEntry) => {
    setRoleEntries((current) =>
      normalizeRoleEntries(current.map((entry, currentIndex) => (currentIndex === index ? nextEntry : entry))),
    );
  };

  const moveEntry = (index: number, direction: -1 | 1) => {
    setRoleEntries((current) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const reordered = [...current];
      const [entry] = reordered.splice(index, 1);
      reordered.splice(nextIndex, 0, entry);
      return normalizeRoleEntries(reordered);
    });
  };

  const removeEntry = (index: number) => {
    setRoleEntries((current) => normalizeRoleEntries(current.filter((_, currentIndex) => currentIndex !== index)));
  };

  return (
    <Card className="border-border/60 bg-background/80">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{player.battle_tag}</CardTitle>
          <div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {isInPool ? <Badge variant="outline">In pool</Badge> : <Badge variant="secondary">Excluded</Badge>}
            {rankedRolesCount > 1 ? <Badge>Flex</Badge> : null}
          </div>
        </div>
        {onRemove ? (
          <Button variant="ghost" size="icon" onClick={() => onRemove(player.id)}>
            <Trash2 className="h-4 w-4" />
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-sm">
          <Checkbox checked={isInPool} onCheckedChange={(checked) => setIsInPool(Boolean(checked))} />
          <span>Include in balancing pool</span>
        </div>

        <div className="space-y-3">
          {roleEntries.map((entry, index) => (
            <div key={`${player.id}-${entry.role}-${index}`} className="grid gap-3 rounded-xl border p-3 md:grid-cols-[1fr_120px_100px_auto]">
              <div className="space-y-2">
                <Label>Role</Label>
                <Select value={entry.role} onValueChange={(value) => updateEntry(index, { ...entry, role: value as BalancerRoleCode, subtype: null })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.filter(
                      (option) => option.value === entry.role || !roleEntries.some((candidate, candidateIndex) => candidate.role === option.value && candidateIndex !== index),
                    ).map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {SUBTYPE_OPTIONS[entry.role].length > 0 && (
                <div className="space-y-2">
                  <Label>Subtype</Label>
                  <Select
                    value={entry.subtype ?? "none"}
                    onValueChange={(value) => updateEntry(index, { ...entry, subtype: value === "none" ? null : (value as BalancerRoleSubtype) })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {SUBTYPE_OPTIONS[entry.role].map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-2">
                <Label>Division</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={entry.division_number ?? ""}
                  onChange={(event) => {
                    const divisionNumber = event.target.value ? Number(event.target.value) : null;
                    updateEntry(index, {
                      ...entry,
                      division_number: divisionNumber,
                      rank_value: resolveRankFromDivision(divisionNumber),
                    });
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label>Rank</Label>
                <div className="flex h-10 items-center rounded-md border px-3 text-sm text-muted-foreground">
                  {entry.rank_value ?? "—"}
                </div>
              </div>

              <div className="flex items-end gap-1">
                <Button variant="outline" size="icon" onClick={() => moveEntry(index, -1)} disabled={index === 0}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => moveEntry(index, 1)} disabled={index === roleEntries.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="outline" size="icon" onClick={() => removeEntry(index)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={addRole} disabled={roleEntries.length >= ROLE_OPTIONS.length}>
            <Plus className="mr-2 h-4 w-4" />
            Add role
          </Button>
        </div>

        <div className="space-y-2">
          <Label>Admin notes</Label>
          <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-20" />
        </div>

        <Button
          type="button"
          onClick={() => onSave(player.id, { role_entries_json: normalizeRoleEntries(roleEntries), is_in_pool: isInPool, admin_notes: notes || null })}
          disabled={saving}
        >
          <Save className="mr-2 h-4 w-4" />
          Save player
        </Button>
      </CardContent>
    </Card>
  );
}
