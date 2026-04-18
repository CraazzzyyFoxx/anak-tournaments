#ifndef NSGA_ENGINE_HPP
#define NSGA_ENGINE_HPP

#include <vector>
#include <string>
#include <unordered_map>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <random>
#include <thread>
#include <mutex>
#include <set>
#include <limits>
#include <array>
#include <functional>

// ==================== Data Structures ====================

struct PlayerRoleInfo {
    int role_id;
    int rating;
    int priority;
    std::vector<int> subrole_ids;
};

struct PlayerInfo {
    int member_id;
    std::vector<PlayerRoleInfo> roles;

    bool can_play_role(int role_id) const {
        for (const auto& r : roles) {
            if (r.role_id == role_id) return true;
        }
        return false;
    }

    int get_rating_for_role(int role_id) const {
        for (const auto& r : roles) {
            if (r.role_id == role_id) return r.rating;
        }
        return 0;
    }

    int get_priority_for_role(int role_id) const {
        for (const auto& r : roles) {
            if (r.role_id == role_id) return r.priority;
        }
        return 0;
    }

    const std::vector<int>* get_subroles_for_role(int role_id) const {
        for (const auto& r : roles) {
            if (r.role_id == role_id) {
                return &r.subrole_ids;
            }
        }
        return nullptr;
    }
};

struct RoleSettings {
    int count_in_team = 1;
    std::unordered_map<int, int> subrole_capacities;
};

struct NSGASettings {
    int population_size = 200;
    int generations = 1000;
    int num_pareto_solutions = 50;

    float weight_team_variance = 1.0f;
    float role_imbalance_blend = 0.1f;
    float subrole_blend = 0.1f;
    float intra_team_std_blend = 0.0f;

    float penalty_invalid_role = 10000.0f;
    float penalty_prio_1 = 10.0f;
    float penalty_prio_2 = 3.0f;
    float penalty_prio_3 = 0.0f;
};

struct EngineSettings {
    int num_workers = 0;
    int fallback_workers = 4;
    int seed = 42;
};

struct AssignedPlayer {
    int member_id;
    int role_id;
    int rating;
    int priority;
};

struct TeamResult {
    int team_id;
    std::vector<AssignedPlayer> players;
    int total_rating = 0;
};

struct DraftSolution {
    int solution_id;
    float fitness_balance;
    float fitness_priority;
    float fitness_role_imbalance;
    float fitness_subrole;
    float fitness_intra_team_std;
    std::vector<TeamResult> teams;
};

struct EvaluationResult {
    std::array<float, 2> objectives;
    float fitness_balance;
    float fitness_priority;
    float fitness_role_imbalance;
    float fitness_subrole;
    float fitness_intra_team_std;
};

struct MetricSummary {
    float min_value = 0.0f;
    float avg_value = 0.0f;
    float max_value = 0.0f;
};

struct ProgressSnapshot {
    int generation = 0;
    int total_generations = 0;
    int pareto_front_size = 0;
    MetricSummary fitness_balance;
    MetricSummary fitness_priority;
    MetricSummary fitness_role_imbalance;
    MetricSummary fitness_subrole;
    MetricSummary fitness_intra_team_std;
};

// ==================== NSGA-II Engine ====================

class NSGA2Engine {
public:
    NSGA2Engine(
        const NSGASettings& nsga_settings,
        const std::vector<int>& role_ids,
        const std::unordered_map<int, RoleSettings>& role_settings,
        int players_in_team,
        const EngineSettings& engine_settings = EngineSettings{}
    );

    std::vector<DraftSolution> run(
        const std::vector<PlayerInfo>& players,
        const std::function<void(const ProgressSnapshot&)>& progress_callback = nullptr,
        int progress_every = 1
    );

    const NSGASettings& nsga_settings() const { return nsga_settings_; }
    const EngineSettings& engine_settings() const { return engine_settings_; }

private:
    NSGASettings nsga_settings_;
    EngineSettings engine_settings_;
    std::vector<int> role_ids_;
    std::unordered_map<int, RoleSettings> role_settings_;
    int players_in_team_;
    int num_workers_;
    int seed_;

    std::vector<int> team_slots_;
    int num_roles_;
    int num_players_;
    int num_teams_;

    std::vector<std::vector<int>> R_;
    std::vector<std::vector<int>> P_;
    std::vector<float> priority_penalties_;
    std::vector<std::vector<int>> dup_role_groups_;

    std::mt19937 rng_;

    void build_matrices(const std::vector<PlayerInfo>& players);

    std::vector<int> generate_individual();

    std::vector<EvaluationResult> evaluate_population(
        const std::vector<std::vector<int>>& population
    );

    std::vector<std::vector<int>> fast_non_dominated_sort(
        const std::vector<std::array<float, 2>>& objectives
    );

    std::vector<float> calculate_crowding_distance(
        const std::vector<std::array<float, 2>>& objectives,
        const std::vector<std::vector<int>>& fronts
    );

    std::vector<int> tournament_selection(
        int num_select,
        const std::vector<int>& ranks,
        const std::vector<float>& distances,
        const std::vector<std::array<float, 2>>& objectives
    );

    std::vector<int> mutate(const std::vector<int>& parent);

    std::vector<DraftSolution> decode_results(
        const std::vector<std::vector<int>>& chroms,
        const std::vector<EvaluationResult>& evaluations
    );

    ProgressSnapshot build_progress_snapshot(
        int generation,
        const std::vector<int>& pareto_front,
        const std::vector<EvaluationResult>& evaluations
    ) const;

    int compute_subrole_penalty_for_team_role(
        const std::vector<int>& chrom,
        int team_idx,
        int role_idx
    ) const;

    std::vector<std::vector<int>> role_slot_indices_;
    std::vector<std::vector<int>> role_subrole_ids_;
    std::vector<std::vector<int>> role_subrole_capacities_;
    std::vector<std::unordered_map<int, int>> role_subrole_index_;
    std::vector<std::vector<std::vector<int>>> S_;
};

#endif
