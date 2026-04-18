from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class PlayerRole(BaseModel):
    priority: int = Field(ge=0, description="Role priority for the player.")
    rating: int = Field(ge=0, description="Role rating for the player.")
    subrole_ids: list[UUID] | None = Field(
        default=None,
        description="Player subroles for this role. Empty or null means all role subroles.",
    )


class Player(BaseModel):
    member_id: UUID = Field(description="Unique player identifier.")
    roles: dict[UUID, PlayerRole] = Field(description="Player role settings: role UUID -> role data.")


class SubroleSettings(BaseModel):
    capacity: int = Field(default=1, ge=0, description="Maximum preferred count for this subrole in a team.")


class RoleSettings(BaseModel):
    original_game_role: UUID = Field(description="Original game role identifier.")
    count_in_team: int = Field(ge=0, description="Number of players with this role in a team.")
    subroles: dict[UUID, SubroleSettings] = Field(
        default_factory=dict,
        description="Subrole settings for this role: subrole UUID -> settings.",
    )

    @property
    def min_in_team(self) -> int:
        return self.count_in_team

    @property
    def max_in_team(self) -> int:
        return self.count_in_team

    @model_validator(mode="before")
    @classmethod
    def handle_legacy_fields(cls, data):
        if isinstance(data, dict):
            if "max_in_team" in data and "count_in_team" not in data:
                data["count_in_team"] = data.pop("max_in_team")
            if "min_in_team" in data:
                data.pop("min_in_team", None)
        return data
class MathSettings(BaseModel):
    fairness_coef: float = Field(default=3.0, description="Weight for fairness metric.")
    role_fairness_coef: float = Field(default=1.0, description="Weight for role fairness metric.")
    role_priority_coef: float = Field(default=80.0, description="Weight for role priority metric.")
    subrole_penalty_coef: float = Field(default=40.0, ge=0, description="Weight for subrole duplicate penalty metric.")
    role_priority_imbalance_coef: float = Field(
        default=0.2, ge=0, description="Weight of the role-priority imbalance penalty."
    )
    fairness_power_coef: float = Field(default=2.0, ge=1, description="Power coefficient for fairness calculation.")
    uniformity_power_coef: float = Field(default=2.0, ge=1, description="Power coefficient for uniformity calculation.")
    role_priority_imbalance_threshold: int = Field(default=1, ge=0, description="Threshold for role-priority imbalance penalty.")
    
    population_size: int = Field(default=200, ge=1, description="NSGA-II population size.")
    generations: int = Field(default=1000, ge=1, description="NSGA-II generations count.")
    num_pareto_solutions: int = Field(default=50, ge=1, description="Number of selected solutions from the Pareto front.")
    weight_team_variance: float = Field(default=1.0, description="Weight of team variance in balance objective.")
    role_imbalance_blend: float = Field(
        default=0.1, ge=0, description="Blend coefficient for role imbalance in the folded balance objective."
    )
    subrole_blend: float = Field(
        default=0.1, ge=0, description="Blend coefficient for subrole penalty in the folded priority objective."
    )
    intra_team_std_blend: float = Field(
        default=0.0,
        ge=0,
        description=(
            "Blend coefficient for intra-team rating std in the folded balance objective. "
            "Penalizes teams that pair top players with weak ones to hit a target average."
        ),
    )
    penalty_invalid_role: float = Field(default=10000.0, description="Penalty for assigning an invalid role.")
    penalty_prio_1: float = Field(default=10.0, description="Penalty for priority level 1.")
    penalty_prio_2: float = Field(default=3.0, description="Penalty for priority level 2.")
    penalty_prio_3: float = Field(default=0.0, description="Penalty for priority level 3.")


class BalanceSettings(BaseModel):
    players_in_team: int = Field(ge=1, description="Number of players in one team.")
    roles: dict[UUID, RoleSettings] = Field(
        default_factory=dict, description="Role settings: role UUID -> role settings."
    )
    math: MathSettings = Field(default_factory=MathSettings, description="Math and optimization settings.")

    @property
    def max_in_team(self) -> int:
        return self.players_in_team

    @model_validator(mode="before")
    @classmethod
    def handle_legacy_fields(cls, data):
        if isinstance(data, dict):
            if "max_in_team" in data and "players_in_team" not in data:
                data["players_in_team"] = data.pop("max_in_team")
        return data

    @model_validator(mode="after")
    def validate_settings(self) -> "BalanceSettings":
        total_count = sum(r.count_in_team for r in self.roles.values())
        if total_count != self.players_in_team:
            raise ValueError(
                f"Sum of role counts ({total_count}) must equal players_in_team ({self.players_in_team})"
            )
        return self


class BalanceRequest(BaseModel):
    draft_id: UUID = Field(description="Draft identifier for the balance request.")
    players: list[Player] = Field(description="Players included in this draft.")
    balance_settings: BalanceSettings = Field(description="Global balancing settings.")

    @model_validator(mode="after")
    def validate_players_roles(self) -> "BalanceRequest":
        role_ids = set(self.balance_settings.roles.keys())
        for player in self.players:
            for role_id, role_info in player.roles.items():
                if role_id not in role_ids:
                    raise ValueError(f"Player {player.member_id} has undefined role {role_id}")

                configured_subroles = set(self.balance_settings.roles[role_id].subroles.keys())
                if not configured_subroles:
                    if role_info.subrole_ids:
                        raise ValueError(
                            f"Player {player.member_id} has subroles for role {role_id}, "
                            "but this role has no configured subroles"
                        )
                    continue

                if not role_info.subrole_ids:
                    continue

                undefined_subroles = set(role_info.subrole_ids) - configured_subroles
                if undefined_subroles:
                    undefined_repr = ", ".join(str(subrole) for subrole in sorted(undefined_subroles, key=str))
                    raise ValueError(
                        f"Player {player.member_id} has undefined subroles for role {role_id}: {undefined_repr}"
                    )
        return self

    @model_validator(mode="after")
    def validate_players_count(self) -> "BalanceRequest":
        if len(self.players) % self.balance_settings.players_in_team != 0:
            raise ValueError(
                f"Number of players ({len(self.players)}) must be divisible by "
                f"players_in_team ({self.balance_settings.players_in_team})"
            )
        return self
