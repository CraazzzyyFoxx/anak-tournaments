#include "nsga_engine.hpp"
#include <functional>
#include <numeric>
#include <array>
#include <cmath>
#include <tuple>

namespace {

MetricSummary summarize_metric(
    const std::vector<int>& front,
    const std::vector<EvaluationResult>& evaluations,
    float EvaluationResult::*metric
) {
    MetricSummary summary;
    if (front.empty()) {
        return summary;
    }

    float min_value = (evaluations[front[0]].*metric);
    float max_value = min_value;
    float sum = 0.0f;

    for (int idx : front) {
        float value = evaluations[idx].*metric;
        min_value = std::min(min_value, value);
        max_value = std::max(max_value, value);
        sum += value;
    }

    summary.min_value = min_value;
    summary.avg_value = sum / static_cast<float>(front.size());
    summary.max_value = max_value;
    return summary;
}

}  // namespace

NSGA2Engine::NSGA2Engine(
    const NSGASettings& nsga_settings,
    const std::vector<int>& role_ids,
    const std::unordered_map<int, RoleSettings>& role_settings,
    int players_in_team,
    const EngineSettings& engine_settings
) : nsga_settings_(nsga_settings),
    engine_settings_(engine_settings),
    role_ids_(role_ids),
    role_settings_(role_settings),
    players_in_team_(players_in_team),
    rng_(engine_settings.seed)
{
    num_roles_ = static_cast<int>(role_ids_.size());
    num_workers_ = engine_settings_.num_workers <= 0
        ? static_cast<int>(std::thread::hardware_concurrency())
        : engine_settings_.num_workers;
    if (num_workers_ <= 0) num_workers_ = engine_settings_.fallback_workers;

    team_slots_.reserve(players_in_team_);
    role_slot_indices_.assign(num_roles_, {});
    for (int r_idx = 0; r_idx < num_roles_; ++r_idx) {
        auto it = role_settings_.find(role_ids_[r_idx]);
        int count = (it != role_settings_.end()) ? it->second.count_in_team : 1;
        for (int c = 0; c < count; ++c) {
            role_slot_indices_[r_idx].push_back(static_cast<int>(team_slots_.size()));
            team_slots_.push_back(r_idx);
        }
    }

    std::unordered_map<int, std::vector<int>> role_to_local;
    for (int local_idx = 0; local_idx < players_in_team_; ++local_idx) {
        role_to_local[team_slots_[local_idx]].push_back(local_idx);
    }
    for (auto& [role_idx, indices] : role_to_local) {
        if (indices.size() > 1) {
            dup_role_groups_.push_back(indices);
        }
    }

    role_subrole_ids_.assign(num_roles_, {});
    role_subrole_capacities_.assign(num_roles_, {});
    role_subrole_index_.assign(num_roles_, {});
    for (int r_idx = 0; r_idx < num_roles_; ++r_idx) {
        auto settings_it = role_settings_.find(role_ids_[r_idx]);
        if (settings_it == role_settings_.end() || settings_it->second.subrole_capacities.empty()) {
            continue;
        }

        std::vector<std::pair<int, int>> sorted_subroles(
            settings_it->second.subrole_capacities.begin(),
            settings_it->second.subrole_capacities.end()
        );
        std::sort(sorted_subroles.begin(), sorted_subroles.end(),
            [](const auto& a, const auto& b) {
                return a.first < b.first;
            }
        );

        role_subrole_ids_[r_idx].reserve(sorted_subroles.size());
        role_subrole_capacities_[r_idx].reserve(sorted_subroles.size());
        for (const auto& [subrole_id, capacity] : sorted_subroles) {
            role_subrole_index_[r_idx][subrole_id] = static_cast<int>(role_subrole_ids_[r_idx].size());
            role_subrole_ids_[r_idx].push_back(subrole_id);
            role_subrole_capacities_[r_idx].push_back(std::max(0, capacity));
        }
    }
}

void NSGA2Engine::build_matrices(const std::vector<PlayerInfo>& players) {
    num_players_ = static_cast<int>(players.size());
    num_teams_ = num_players_ / players_in_team_;

    R_.assign(num_players_, std::vector<int>(num_roles_, 0));
    P_.assign(num_players_, std::vector<int>(num_roles_, 0));
    S_.assign(num_players_, std::vector<std::vector<int>>(num_roles_));

    for (int i = 0; i < num_players_; ++i) {
        for (int j = 0; j < num_roles_; ++j) {
            R_[i][j] = players[i].get_rating_for_role(role_ids_[j]);
            P_[i][j] = players[i].get_priority_for_role(role_ids_[j]);

            if (role_subrole_ids_[j].empty() || P_[i][j] <= 0) {
                continue;
            }

            const auto* player_subroles = players[i].get_subroles_for_role(role_ids_[j]);
            if (player_subroles == nullptr || player_subroles->empty()) {
                S_[i][j].reserve(role_subrole_ids_[j].size());
                for (int idx = 0; idx < static_cast<int>(role_subrole_ids_[j].size()); ++idx) {
                    S_[i][j].push_back(idx);
                }
                continue;
            }

            std::vector<bool> seen(role_subrole_ids_[j].size(), false);
            for (int subrole_id : *player_subroles) {
                auto subrole_it = role_subrole_index_[j].find(subrole_id);
                if (subrole_it == role_subrole_index_[j].end()) {
                    continue;
                }
                int local_subrole_idx = subrole_it->second;
                if (!seen[local_subrole_idx]) {
                    seen[local_subrole_idx] = true;
                    S_[i][j].push_back(local_subrole_idx);
                }
            }
        }
    }

    priority_penalties_ = {
        nsga_settings_.penalty_invalid_role,
        nsga_settings_.penalty_prio_1,
        nsga_settings_.penalty_prio_2,
        nsga_settings_.penalty_prio_3
    };
}

std::vector<int> NSGA2Engine::generate_individual() {
    std::vector<int> individual(num_players_, 0);
    std::vector<bool> used(num_players_, false);

    std::uniform_int_distribution<int> dist(0, num_players_ - 1);

    for (int t = 0; t < num_teams_; ++t) {
        for (int s = 0; s < players_in_team_; ++s) {
            int slot_idx = t * players_in_team_ + s;
            int role_idx = team_slots_[s];

            std::vector<int> candidates;
            for (int p = 0; p < num_players_; ++p) {
                if (!used[p] && P_[p][role_idx] > 0) {
                    candidates.push_back(p);
                }
            }

            int chosen;
            if (!candidates.empty()) {
                std::uniform_int_distribution<int> cdist(0, static_cast<int>(candidates.size()) - 1);
                chosen = candidates[cdist(rng_)];
            } else {
                std::vector<int> remaining;
                for (int p = 0; p < num_players_; ++p) {
                    if (!used[p]) remaining.push_back(p);
                }
                std::uniform_int_distribution<int> rdist(0, static_cast<int>(remaining.size()) - 1);
                chosen = remaining[rdist(rng_)];
            }

            individual[slot_idx] = chosen;
            used[chosen] = true;
        }
    }

    return individual;
}

std::vector<EvaluationResult> NSGA2Engine::evaluate_population(
    const std::vector<std::vector<int>>& population
) {
    int pop_size = static_cast<int>(population.size());
    std::vector<EvaluationResult> evaluations(pop_size);

    for (int ind = 0; ind < pop_size; ++ind) {
        const auto& chrom = population[ind];

        // Team ratings + intra-team rating std (penalizes pairing top players
        // with weak ones to hit an average — keeps skill concentration low).
        std::vector<float> team_ratings(num_teams_, 0.0f);
        float intra_team_std_sum = 0.0f;
        for (int t = 0; t < num_teams_; ++t) {
            std::vector<float> slot_ratings(players_in_team_, 0.0f);
            for (int s = 0; s < players_in_team_; ++s) {
                int slot_idx = t * players_in_team_ + s;
                int p_idx = chrom[slot_idx];
                int r_idx = team_slots_[s];
                float rating = static_cast<float>(R_[p_idx][r_idx]);
                slot_ratings[s] = rating;
                team_ratings[t] += rating;
            }

            float mean_rating = team_ratings[t] / static_cast<float>(players_in_team_);
            float intra_variance = 0.0f;
            for (float rating : slot_ratings) {
                float diff = rating - mean_rating;
                intra_variance += diff * diff;
            }
            intra_variance /= static_cast<float>(players_in_team_);
            intra_team_std_sum += std::sqrt(intra_variance);
        }

        float role_imbalance_sum = 0.0f;
        for (int t = 0; t < num_teams_; ++t) {
            std::vector<float> team_role_sums(num_roles_, 0.0f);
            for (int s = 0; s < players_in_team_; ++s) {
                int slot_idx = t * players_in_team_ + s;
                int p_idx = chrom[slot_idx];
                int r_idx = team_slots_[s];
                team_role_sums[r_idx] += static_cast<float>(R_[p_idx][r_idx]);
            }

            float mean = 0.0f;
            for (float role_sum : team_role_sums) {
                mean += role_sum;
            }
            mean /= static_cast<float>(num_roles_);

            float variance = 0.0f;
            for (float role_sum : team_role_sums) {
                float diff = role_sum - mean;
                variance += diff * diff;
            }
            variance /= static_cast<float>(num_roles_);
            role_imbalance_sum += std::sqrt(variance);
        }

        float team_max = team_ratings[0];
        float team_min = team_ratings[0];
        float team_mean = 0.0f;
        for (float r : team_ratings) {
            if (r > team_max) team_max = r;
            if (r < team_min) team_min = r;
            team_mean += r;
        }
        team_mean /= static_cast<float>(num_teams_);

        float team_variance_sum = 0.0f;
        for (float r : team_ratings) {
            float diff = r - team_mean;
            team_variance_sum += diff * diff;
        }
        float team_std = std::sqrt(team_variance_sum / static_cast<float>(num_teams_));

        float fitness_balance = nsga_settings_.weight_team_variance * ((team_max - team_min) + team_std);

        // Priority penalties
        float priority_penalty = 0.0f;
        for (int t = 0; t < num_teams_; ++t) {
            for (int s = 0; s < players_in_team_; ++s) {
                int slot_idx = t * players_in_team_ + s;
                int p_idx = chrom[slot_idx];
                int r_idx = team_slots_[s];
                int prio = P_[p_idx][r_idx];
                int prio_clamped = std::max(0, std::min(3, prio));
                priority_penalty += priority_penalties_[prio_clamped];
            }
        }
        float fitness_priority = priority_penalty;

        float subrole_penalty = 0.0f;
        for (int t = 0; t < num_teams_; ++t) {
            for (int r = 0; r < num_roles_; ++r) {
                if (role_subrole_capacities_[r].empty()) {
                    continue;
                }
                subrole_penalty += static_cast<float>(
                    compute_subrole_penalty_for_team_role(chrom, t, r)
                );
            }
        }
        evaluations[ind].fitness_balance = fitness_balance;
        evaluations[ind].fitness_priority = fitness_priority;
        evaluations[ind].fitness_role_imbalance = role_imbalance_sum;
        evaluations[ind].fitness_subrole = subrole_penalty;
        evaluations[ind].fitness_intra_team_std = intra_team_std_sum;
        evaluations[ind].objectives[0] = fitness_balance
            + nsga_settings_.role_imbalance_blend * role_imbalance_sum
            + nsga_settings_.intra_team_std_blend * intra_team_std_sum;
        evaluations[ind].objectives[1] = fitness_priority + nsga_settings_.subrole_blend * subrole_penalty;
    }

    return evaluations;
}

int NSGA2Engine::compute_subrole_penalty_for_team_role(
    const std::vector<int>& chrom,
    int team_idx,
    int role_idx
) const {
    const auto& capacities = role_subrole_capacities_[role_idx];
    if (capacities.empty()) {
        return 0;
    }

    const auto& local_slots = role_slot_indices_[role_idx];
    if (local_slots.empty()) {
        return 0;
    }

    std::vector<std::vector<int>> allowed_by_player;
    allowed_by_player.reserve(local_slots.size());
    int forced_penalty = 0;

    for (int local_slot : local_slots) {
        int slot_idx = team_idx * players_in_team_ + local_slot;
        int p_idx = chrom[slot_idx];
        const auto& allowed_subroles = S_[p_idx][role_idx];
        if (allowed_subroles.empty()) {
            forced_penalty += 1;
            continue;
        }
        allowed_by_player.push_back(allowed_subroles);
    }

    if (allowed_by_player.empty()) {
        return forced_penalty;
    }

    const int players_count = static_cast<int>(allowed_by_player.size());
    const int subroles_count = static_cast<int>(capacities.size());
    const int base = players_count + 1;

    std::vector<int> counts(subroles_count, 0);
    std::unordered_map<std::uint64_t, int> memo;

    std::function<int(int)> dfs = [&](int idx) -> int {
        if (idx == players_count) {
            int penalty = 0;
            for (int s = 0; s < subroles_count; ++s) {
                if (counts[s] > capacities[s]) {
                    penalty += counts[s];
                }
            }
            return penalty;
        }

        bool can_encode = true;
        std::uint64_t key = static_cast<std::uint64_t>(idx);
        std::uint64_t multiplier = static_cast<std::uint64_t>(base);

        for (int count : counts) {
            if (multiplier > std::numeric_limits<std::uint64_t>::max() / static_cast<std::uint64_t>(base)) {
                can_encode = false;
                break;
            }
            key += static_cast<std::uint64_t>(count) * multiplier;
            multiplier *= static_cast<std::uint64_t>(base);
        }

        if (can_encode) {
            auto memo_it = memo.find(key);
            if (memo_it != memo.end()) {
                return memo_it->second;
            }
        }

        int best = std::numeric_limits<int>::max();
        for (int subrole_idx : allowed_by_player[idx]) {
            counts[subrole_idx] += 1;
            best = std::min(best, dfs(idx + 1));
            counts[subrole_idx] -= 1;
        }

        if (can_encode) {
            memo[key] = best;
        }
        return best;
    };

    return forced_penalty + dfs(0);
}

std::vector<std::vector<int>> NSGA2Engine::fast_non_dominated_sort(
    const std::vector<std::array<float, 2>>& objectives
) {
    int pop_size = static_cast<int>(objectives.size());
    std::vector<std::vector<int>> S(pop_size);
    std::vector<int> n(pop_size, 0);
    std::vector<int> rank(pop_size, 0);
    std::vector<std::vector<int>> fronts;

    for (int p = 0; p < pop_size; ++p) {
        for (int q = 0; q < pop_size; ++q) {
            if (p == q) continue;

            bool p_dominates_q = true;
            bool p_strict_better = false;
            bool q_dominates_p = true;
            bool q_strict_better = false;

            for (int m = 0; m < 2; ++m) {
                if (objectives[p][m] > objectives[q][m]) {
                    p_dominates_q = false;
                }
                if (objectives[p][m] < objectives[q][m]) {
                    p_strict_better = true;
                }

                if (objectives[q][m] > objectives[p][m]) {
                    q_dominates_p = false;
                }
                if (objectives[q][m] < objectives[p][m]) {
                    q_strict_better = true;
                }
            }

            p_dominates_q = p_dominates_q && p_strict_better;
            q_dominates_p = q_dominates_p && q_strict_better;

            if (p_dominates_q) {
                S[p].push_back(q);
            }
            if (q_dominates_p) {
                n[p]++;
            }
        }
        if (n[p] == 0) {
            rank[p] = 0;
            if (fronts.empty()) fronts.emplace_back();
            fronts[0].push_back(p);
        }
    }

    int i = 0;
    while (i < static_cast<int>(fronts.size()) && !fronts[i].empty()) {
        std::vector<int> next_front;
        for (int p : fronts[i]) {
            for (int q : S[p]) {
                n[q]--;
                if (n[q] == 0) {
                    rank[q] = i + 1;
                    next_front.push_back(q);
                }
            }
        }
        if (!next_front.empty()) {
            fronts.push_back(std::move(next_front));
        }
        i++;
    }

    if (!fronts.empty() && fronts.back().empty()) {
        fronts.pop_back();
    }

    return fronts;
}

std::vector<float> NSGA2Engine::calculate_crowding_distance(
    const std::vector<std::array<float, 2>>& objectives,
    const std::vector<std::vector<int>>& fronts
) {
    int pop_size = static_cast<int>(objectives.size());
    int num_obj = 2;
    std::vector<float> distances(pop_size, 0.0f);

    for (const auto& front : fronts) {
        if (front.size() <= 2) {
            for (int idx : front) {
                distances[idx] = std::numeric_limits<float>::infinity();
            }
            continue;
        }

        for (int m = 0; m < num_obj; ++m) {
            std::vector<int> sorted_front = front;
            std::sort(sorted_front.begin(), sorted_front.end(),
                [&objectives, m](int a, int b) {
                    return objectives[a][m] < objectives[b][m];
                });

            distances[sorted_front.front()] = std::numeric_limits<float>::infinity();
            distances[sorted_front.back()] = std::numeric_limits<float>::infinity();

            float f_min = objectives[sorted_front.front()][m];
            float f_max = objectives[sorted_front.back()][m];
            float range = f_max - f_min;

            if (range == 0.0f) continue;

            for (size_t k = 1; k + 1 < sorted_front.size(); ++k) {
                distances[sorted_front[k]] +=
                    (objectives[sorted_front[k + 1]][m] - objectives[sorted_front[k - 1]][m]) / range;
            }
        }
    }

    return distances;
}

std::vector<int> NSGA2Engine::tournament_selection(
    int num_select,
    const std::vector<int>& ranks,
    const std::vector<float>& distances,
    const std::vector<std::array<float, 2>>& objectives
) {
    (void)objectives;
    std::vector<int> selected;
    selected.reserve(num_select);

    std::uniform_int_distribution<int> dist(0, static_cast<int>(ranks.size()) - 1);

    for (int i = 0; i < num_select; ++i) {
        int idx1 = dist(rng_);
        int idx2 = dist(rng_);
        while (idx2 == idx1) idx2 = dist(rng_);

        if (ranks[idx1] < ranks[idx2]) {
            selected.push_back(idx1);
        } else if (ranks[idx1] > ranks[idx2]) {
            selected.push_back(idx2);
        } else {
            selected.push_back(distances[idx1] > distances[idx2] ? idx1 : idx2);
        }
    }

    return selected;
}

std::vector<int> NSGA2Engine::mutate(const std::vector<int>& parent) {
    std::vector<int> chrom = parent;

    std::uniform_real_distribution<float> prob_dist(0.0f, 1.0f);
    float mutation_type = prob_dist(rng_);

    if (mutation_type < 0.35f) {
        // Fix invalid roles
        std::vector<int> invalid_indices;
        for (int i = 0; i < num_players_; ++i) {
            int slot_idx = i % players_in_team_;
            int role_idx = team_slots_[slot_idx];
            if (P_[chrom[i]][role_idx] == 0) {
                invalid_indices.push_back(i);
            }
        }

        if (!invalid_indices.empty()) {
            std::uniform_int_distribution<int> inv_dist(0, static_cast<int>(invalid_indices.size()) - 1);
            int idx1 = invalid_indices[inv_dist(rng_)];
            int r_idx = team_slots_[idx1 % players_in_team_];

            std::vector<int> valid_candidates;
            for (int i = 0; i < num_players_; ++i) {
                if (team_slots_[i % players_in_team_] == r_idx && i != idx1) {
                    valid_candidates.push_back(i);
                }
            }

            if (!valid_candidates.empty()) {
                std::uniform_int_distribution<int> cand_dist(0, static_cast<int>(valid_candidates.size()) - 1);
                int idx2 = valid_candidates[cand_dist(rng_)];
                std::swap(chrom[idx1], chrom[idx2]);
                return chrom;
            }
        }
    }
    else if (mutation_type < 0.70f) {
        // Robin Hood mutation
        std::vector<float> team_ratings(num_teams_, 0.0f);
        for (int t = 0; t < num_teams_; ++t) {
            for (int s = 0; s < players_in_team_; ++s) {
                int slot_idx = t * players_in_team_ + s;
                int p_idx = chrom[slot_idx];
                int r_idx = team_slots_[s];
                team_ratings[t] += static_cast<float>(R_[p_idx][r_idx]);
            }
        }

        int best_team = 0;
        int worst_team = 0;
        for (int t = 1; t < num_teams_; ++t) {
            if (team_ratings[t] > team_ratings[best_team]) best_team = t;
            if (team_ratings[t] < team_ratings[worst_team]) worst_team = t;
        }

        std::uniform_int_distribution<int> slot_dist(0, players_in_team_ - 1);
        int s = slot_dist(rng_);
        int idx1 = best_team * players_in_team_ + s;
        int idx2 = worst_team * players_in_team_ + s;
        std::swap(chrom[idx1], chrom[idx2]);
        return chrom;
    }
    else if (mutation_type < 0.90f) {
        // Priority improvement
        std::uniform_int_distribution<int> team_dist(0, num_teams_ - 1);
        int t1 = team_dist(rng_);
        int t2 = team_dist(rng_);
        while (t2 == t1) t2 = team_dist(rng_);

        std::uniform_int_distribution<int> slot_dist(0, players_in_team_ - 1);
        int s1 = slot_dist(rng_);
        int s2 = slot_dist(rng_);
        while (s2 == s1) s2 = slot_dist(rng_);

        int idx1 = t1 * players_in_team_ + s1;
        int idx2 = t2 * players_in_team_ + s2;

        int p1 = chrom[idx1];
        int p2 = chrom[idx2];
        int r1 = team_slots_[s1];
        int r2 = team_slots_[s2];

        int cur_prio = 0;
        int prio1 = std::max(0, std::min(3, P_[p1][r1]));
        int prio2 = std::max(0, std::min(3, P_[p2][r2]));
        cur_prio = static_cast<int>(priority_penalties_[prio1]) + static_cast<int>(priority_penalties_[prio2]);

        int new_prio = 0;
        int new_prio1 = std::max(0, std::min(3, P_[p1][r2]));
        int new_prio2 = std::max(0, std::min(3, P_[p2][r1]));
        new_prio = static_cast<int>(priority_penalties_[new_prio1]) + static_cast<int>(priority_penalties_[new_prio2]);

        if (new_prio <= cur_prio) {
            std::swap(chrom[idx1], chrom[idx2]);
        }
        return chrom;
    }

    // Random shake
    std::uniform_int_distribution<int> dist(0, num_players_ - 1);
    int idx1 = dist(rng_);
    int idx2 = dist(rng_);
    while (idx2 == idx1) idx2 = dist(rng_);
    std::swap(chrom[idx1], chrom[idx2]);
    return chrom;
}

std::vector<DraftSolution> NSGA2Engine::decode_results(
    const std::vector<std::vector<int>>& chroms,
    const std::vector<EvaluationResult>& evaluations
) {
    std::vector<DraftSolution> solutions;
    solutions.reserve(chroms.size());

    for (size_t sol_id = 0; sol_id < chroms.size(); ++sol_id) {
        const auto& chrom = chroms[sol_id];
        DraftSolution sol;
        sol.solution_id = static_cast<int>(sol_id) + 1;
        sol.fitness_balance = evaluations[sol_id].fitness_balance;
        sol.fitness_priority = evaluations[sol_id].fitness_priority;
        sol.fitness_role_imbalance = evaluations[sol_id].fitness_role_imbalance;
        sol.fitness_subrole = evaluations[sol_id].fitness_subrole;
        sol.fitness_intra_team_std = evaluations[sol_id].fitness_intra_team_std;

        sol.teams.resize(num_teams_);

        for (int t = 0; t < num_teams_; ++t) {
            TeamResult& team = sol.teams[t];
            team.team_id = t + 1;
            team.total_rating = 0;

            for (int s = 0; s < players_in_team_; ++s) {
                int slot_idx = t * players_in_team_ + s;
                int p_idx = chrom[slot_idx];
                int r_idx = team_slots_[s];

                AssignedPlayer ap;
                ap.member_id = p_idx;
                ap.role_id = role_ids_[r_idx];
                ap.rating = R_[p_idx][r_idx];
                ap.priority = P_[p_idx][r_idx];

                team.total_rating += ap.rating;
                team.players.push_back(std::move(ap));
            }
        }

        solutions.push_back(std::move(sol));
    }

    return solutions;
}

ProgressSnapshot NSGA2Engine::build_progress_snapshot(
    int generation,
    const std::vector<int>& pareto_front,
    const std::vector<EvaluationResult>& evaluations
) const {
    ProgressSnapshot snapshot;
    snapshot.generation = generation;
    snapshot.total_generations = nsga_settings_.generations;
    snapshot.pareto_front_size = static_cast<int>(pareto_front.size());
    snapshot.fitness_balance = summarize_metric(
        pareto_front,
        evaluations,
        &EvaluationResult::fitness_balance
    );
    snapshot.fitness_priority = summarize_metric(
        pareto_front,
        evaluations,
        &EvaluationResult::fitness_priority
    );
    snapshot.fitness_role_imbalance = summarize_metric(
        pareto_front,
        evaluations,
        &EvaluationResult::fitness_role_imbalance
    );
    snapshot.fitness_subrole = summarize_metric(
        pareto_front,
        evaluations,
        &EvaluationResult::fitness_subrole
    );
    snapshot.fitness_intra_team_std = summarize_metric(
        pareto_front,
        evaluations,
        &EvaluationResult::fitness_intra_team_std
    );
    return snapshot;
}

std::vector<DraftSolution> NSGA2Engine::run(
    const std::vector<PlayerInfo>& players,
    const std::function<void(const ProgressSnapshot&)>& progress_callback,
    int progress_every
) {
    build_matrices(players);

    int pop_size = nsga_settings_.population_size;
    int normalized_progress_every = std::max(1, progress_every);

    // Initialize population
    std::vector<std::vector<int>> population(pop_size);
    for (int i = 0; i < pop_size; ++i) {
        population[i] = generate_individual();
    }

    auto evaluations = evaluate_population(population);
    std::vector<std::array<float, 2>> objectives(pop_size);
    for (int i = 0; i < pop_size; ++i) {
        objectives[i] = evaluations[i].objectives;
    }

    for (int gen = 0; gen < nsga_settings_.generations; ++gen) {
        auto fronts = fast_non_dominated_sort(objectives);

        if (progress_callback && !fronts.empty() && !fronts[0].empty()) {
            int generation = gen + 1;
            bool should_report =
                generation == 1
                || generation == nsga_settings_.generations
                || generation % normalized_progress_every == 0;
            if (should_report) {
                progress_callback(build_progress_snapshot(generation, fronts[0], evaluations));
            }
        }

        std::vector<int> ranks(pop_size, 0);
        for (size_t r = 0; r < fronts.size(); ++r) {
            for (int idx : fronts[r]) {
                ranks[idx] = static_cast<int>(r);
            }
        }

        auto distances = calculate_crowding_distance(objectives, fronts);

        auto selected_indices = tournament_selection(pop_size, ranks, distances, objectives);

        std::vector<std::vector<int>> offspring(pop_size);
        for (int i = 0; i < pop_size; ++i) {
            offspring[i] = mutate(population[selected_indices[i]]);
        }

        auto offspring_evaluations = evaluate_population(offspring);
        std::vector<std::array<float, 2>> offspring_objectives(pop_size);
        for (int i = 0; i < pop_size; ++i) {
            offspring_objectives[i] = offspring_evaluations[i].objectives;
        }

        // Combined population
        std::vector<std::vector<int>> combined_pop(pop_size * 2);
        std::vector<std::array<float, 2>> combined_obj(pop_size * 2);
        std::vector<EvaluationResult> combined_eval(pop_size * 2);

        for (int i = 0; i < pop_size; ++i) {
            combined_pop[i] = std::move(population[i]);
            combined_obj[i] = objectives[i];
            combined_eval[i] = evaluations[i];
        }
        for (int i = 0; i < pop_size; ++i) {
            combined_pop[pop_size + i] = std::move(offspring[i]);
            combined_obj[pop_size + i] = offspring_objectives[i];
            combined_eval[pop_size + i] = offspring_evaluations[i];
        }

        auto fronts_comb = fast_non_dominated_sort(combined_obj);

        std::vector<int> next_pop_indices;
        next_pop_indices.reserve(pop_size);

        for (const auto& front : fronts_comb) {
            if (next_pop_indices.size() + front.size() <= static_cast<size_t>(pop_size)) {
                next_pop_indices.insert(next_pop_indices.end(), front.begin(), front.end());
            } else {
                auto distances_comb = calculate_crowding_distance(combined_obj, {front});
                std::vector<int> sorted_front = front;
                std::sort(sorted_front.begin(), sorted_front.end(),
                    [&distances_comb](int a, int b) {
                        return distances_comb[a] > distances_comb[b];
                    });

                size_t needed = pop_size - next_pop_indices.size();
                next_pop_indices.insert(next_pop_indices.end(), sorted_front.begin(), sorted_front.begin() + needed);
                break;
            }
        }

        // Build next generation
        population.resize(next_pop_indices.size());
        objectives.resize(next_pop_indices.size());
        evaluations.resize(next_pop_indices.size());
        for (size_t i = 0; i < next_pop_indices.size(); ++i) {
            population[i] = std::move(combined_pop[next_pop_indices[i]]);
            objectives[i] = combined_obj[next_pop_indices[i]];
            evaluations[i] = combined_eval[next_pop_indices[i]];
        }
    }

    // Extract Pareto front
    auto final_fronts = fast_non_dominated_sort(objectives);
    if (final_fronts.empty() || final_fronts[0].empty()) {
        return {};
    }

    const auto& pareto_front = final_fronts[0];

    // Filter duplicates
    std::vector<int> unique_front;
    std::set<std::tuple<float, float, float, float>> seen_fitness;

    for (int idx : pareto_front) {
        float fit_balance = std::round(evaluations[idx].fitness_balance * 10000.0f) / 10000.0f;
        float fit_priority = std::round(evaluations[idx].fitness_priority * 10000.0f) / 10000.0f;
        float fit_role_imbalance = std::round(evaluations[idx].fitness_role_imbalance * 10000.0f) / 10000.0f;
        float fit_subrole = std::round(evaluations[idx].fitness_subrole * 10000.0f) / 10000.0f;
        auto fit_tuple = std::make_tuple(fit_balance, fit_priority, fit_role_imbalance, fit_subrole);

        if (seen_fitness.find(fit_tuple) == seen_fitness.end()) {
            seen_fitness.insert(fit_tuple);
            unique_front.push_back(idx);
        }
    }

    // Sort by the folded balance objective.
    std::sort(unique_front.begin(), unique_front.end(),
        [&evaluations](int a, int b) {
            float folded_a = evaluations[a].objectives[0];
            float folded_b = evaluations[b].objectives[0];
            if (folded_a != folded_b) {
                return folded_a < folded_b;
            }
            return evaluations[a].objectives[1] < evaluations[b].objectives[1];
        });

    int num_to_select = std::min(nsga_settings_.num_pareto_solutions, static_cast<int>(unique_front.size()));
    if (num_to_select == 0) return {};

    int step = std::max(1, static_cast<int>(unique_front.size()) / num_to_select);

    std::vector<int> selected_solutions;
    selected_solutions.reserve(num_to_select);
    for (int i = 0; i < static_cast<int>(unique_front.size()) && static_cast<int>(selected_solutions.size()) < num_to_select; i += step) {
        selected_solutions.push_back(unique_front[i]);
    }

    // Build result chromosomes and objectives
    std::vector<std::vector<int>> result_chroms;
    std::vector<EvaluationResult> result_evaluations;
    result_chroms.reserve(selected_solutions.size());
    result_evaluations.reserve(selected_solutions.size());

    for (int idx : selected_solutions) {
        result_chroms.push_back(population[idx]);
        result_evaluations.push_back(evaluations[idx]);
    }

    return decode_results(result_chroms, result_evaluations);
}
