import React from "react";
import { Team } from "@/types/team.types";
import { sortTeamPlayers } from "@/utils/player";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import Image from "next/image";
import { CircleMinus, CirclePlus, Recycle } from "lucide-react";
import PlayerName from "@/components/PlayerName";
import PlayerRoleIcon from "@/components/PlayerRoleIcon";

const EncounterTeamPlayersTable = ({ team, isHome }: { team: Team; isHome: boolean }) => {
  const sortedPlayers = sortTeamPlayers(team.players);
  const backgroundColor = isHome
    ? "bg-[#104e48] hover:bg-[#104e48]"
    : "bg-[#4c2332] hover:bg-[#4c2332]";

  return (
    <Table>
      <TableHeader>
        <TableRow className={backgroundColor}>
          <TableHead className="text-white">Name</TableHead>
          <TableHead className="text-center text-white">Division</TableHead>
          <TableHead className="text-center text-white">New</TableHead>
          <TableHead className="text-center text-white">New Role</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedPlayers.map((player, index) => {
          const color = isHome ? "from-[#104e48]" : "from-[#4c2332]";

          return (
            <TableRow key={player.id} className="hover:bg-background">
              <TableCell
                className={`flex flex-row items-center gap-2 bg-gradient-to-r ${color} via-background to-background ${index == sortedPlayers.length - 1 ? "rounded-b-lg" : ""}`}
              >
                <div className="flex flex-row items-center gap-2">
                  {player.is_substitution ? (
                    <div>
                      <Recycle />
                    </div>
                  ) : (
                    <PlayerRoleIcon role={player.role} />
                  )}
                  <PlayerName player={player} includeSpecialization={true} />
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-center">
                  <Image
                    src={`/divisions/${player.division}.png`}
                    alt="Division"
                    width={32}
                    height={32}
                  />
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-center">
                  {player.is_newcomer ? (
                    <CirclePlus className="text-red-500" />
                  ) : (
                    <CircleMinus className="text-green-500" />
                  )}
                </div>
              </TableCell>
              <TableCell>
                <div className="flex justify-center">
                  {player.is_newcomer_role ? (
                    <CirclePlus className="text-red-500" />
                  ) : (
                    <CircleMinus className="text-green-500" />
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
};

export default EncounterTeamPlayersTable;
