#include "balance_engine.hpp"
#include <functional>
#include <numeric>

// ==================== Constructor ====================

BalanceEngine::BalanceEngine(
    const QualitySettings& quality_settings,
    const std::vector<int>& role_ids,
    const std::unordered_map<int, RoleConstraint>& constraints,
    const EngineSettings& engine_settings
) : quality_settings_(quality_settings), 
    engine_settings_(engine_settings),
    role_ids_(role_ids), 
    constraints_(constraints) {
    
    if (engine_settings_.num_workers <= 0) {
        num_workers_ = static_cast<int>(std::thread::hardware_concurrency());
        if (num_workers_ <= 0) {
            num_workers_ = engine_settings_.fallback_workers;
        }
    } else {
        num_workers_ = engine_settings_.num_workers;
    }
}

// ==================== Role Mask Generation ====================

void BalanceEngine::generate_role_masks(int team_size) {
    int num_roles = static_cast<int>(role_ids_.size());
    role_masks_.init(team_size, num_roles);
    
    std::vector<int> current(team_size);
    std::vector<int> counts(num_roles, 0);
    
    std::vector<int> max_per_role(num_roles, team_size);
    std::vector<int> min_per_role(num_roles, 0);
    
    for (int i = 0; i < num_roles; ++i) {
        auto it = constraints_.find(role_ids_[i]);
        if (it != constraints_.end()) {
            max_per_role[i] = it->second.max_in_team;
            min_per_role[i] = it->second.min_in_team;
        }
    }
    
    std::function<void(int)> generate = [&](int pos) {
        if (pos == team_size) {
            for (int i = 0; i < num_roles; ++i) {
                if (counts[i] < min_per_role[i]) return;
            }
            role_masks_.push_back(current);
            return;
        }
        
        for (int role_idx = 0; role_idx < num_roles; ++role_idx) {
            if (counts[role_idx] < max_per_role[role_idx]) {
                current[pos] = role_idx;
                counts[role_idx]++;
                generate(pos + 1);
                counts[role_idx]--;
            }
        }
    };
    
    generate(0);
}

// ==================== Validation ====================

bool BalanceEngine::is_mask_valid(
    const std::vector<const PlayerInfo*>& team,
    const int* role_indices,
    int team_size
) const {
    for (int i = 0; i < team_size; ++i) {
        int role_id = role_ids_[role_indices[i]];
        if (!team[i]->can_play_role(role_id)) {
            return false;
        }
    }
    return true;
}

// ==================== Apply Mask ====================

void BalanceEngine::apply_mask(
    const std::vector<const PlayerInfo*>& team,
    const int* role_indices,
    std::vector<int>& ratings,
    std::vector<int>& actual_role_ids,
    int team_size
) const {
    for (int i = 0; i < team_size; ++i) {
        int role_id = role_ids_[role_indices[i]];
        actual_role_ids[i] = role_id;
        ratings[i] = team[i]->get_rating_for_role(role_id);
    }
}

// ==================== Quality Calculations ====================

float BalanceEngine::calc_fairness(
    const std::vector<int>& r1,
    const std::vector<int>& r2
) const {
    float p = quality_settings_.p;
    float sum1 = 0.0f, sum2 = 0.0f;
    
    for (int r : r1) sum1 += std::pow(static_cast<float>(r), p);
    for (int r : r2) sum2 += std::pow(static_cast<float>(r), p);
    
    return quality_settings_.alpha * std::abs(
        std::pow(sum1, 1.0f / p) - std::pow(sum2, 1.0f / p)
    );
}

float BalanceEngine::calc_uniformity(
    const std::vector<int>& r1,
    const std::vector<int>& r2
) const {
    size_t total = r1.size() + r2.size();
    if (total == 0) return 0.0f;
    
    float mean = 0.0f;
    for (int r : r1) mean += static_cast<float>(r);
    for (int r : r2) mean += static_cast<float>(r);
    mean /= static_cast<float>(total);
    
    float q = quality_settings_.q;
    float dev1 = 0.0f, dev2 = 0.0f;
    
    for (int r : r1) dev1 += std::pow(std::abs(static_cast<float>(r) - mean), q);
    for (int r : r2) dev2 += std::pow(std::abs(static_cast<float>(r) - mean), q);
    
    dev1 = r1.empty() ? 0.0f : std::pow(dev1 / static_cast<float>(r1.size()), 1.0f / q);
    dev2 = r2.empty() ? 0.0f : std::pow(dev2 / static_cast<float>(r2.size()), 1.0f / q);
    
    return std::abs(dev1 - dev2);
}

float BalanceEngine::calc_role_fairness(
    const std::vector<int>& r1,
    const std::vector<int>& r2,
    const int* m1,
    const int* m2,
    int team_size
) const {
    int num_roles = static_cast<int>(role_ids_.size());
    std::vector<int> sums1(num_roles, 0);
    std::vector<int> sums2(num_roles, 0);
    
    for (int i = 0; i < team_size; ++i) {
        sums1[m1[i]] += r1[i];
        sums2[m2[i]] += r2[i];
    }
    
    float g = quality_settings_.g;
    float weighted_sum = 0.0f;
    
    for (int i = 0; i < num_roles; ++i) {
        float weight = 1.0f;
        auto it = quality_settings_.role_weights.find(role_ids_[i]);
        if (it != quality_settings_.role_weights.end()) {
            weight = it->second;
        }
        
        float diff = std::abs(static_cast<float>(sums1[i] - sums2[i]));
        weighted_sum += std::pow(diff * weight, g);
    }
    
    return quality_settings_.beta * std::pow(weighted_sum / static_cast<float>(num_roles), 1.0f / g);
}

float BalanceEngine::calc_role_points(
    const std::vector<const PlayerInfo*>& t1,
    const std::vector<const PlayerInfo*>& t2,
    const std::vector<int>& roles1,
    const std::vector<int>& roles2
) const {
    int max_prio = quality_settings_.max_priority;
    int total_players = static_cast<int>(t1.size() + t2.size());
    int total_points = total_players * max_prio;
    
    int team1_points = static_cast<int>(t1.size()) * max_prio;
    int team2_points = static_cast<int>(t2.size()) * max_prio;
    
    for (size_t i = 0; i < t1.size(); ++i) {
        int pts = t1[i]->get_priority_for_role(roles1[i]);
        total_points -= pts;
        team1_points -= pts;
    }
    
    for (size_t i = 0; i < t2.size(); ++i) {
        int pts = t2[i]->get_priority_for_role(roles2[i]);
        total_points -= pts;
        team2_points -= pts;
    }
    
    int imbalance = std::abs(team1_points - team2_points);
    if (imbalance > engine_settings_.priority_imbalance_threshold) {
        total_points += static_cast<int>(quality_settings_.xi * static_cast<float>(imbalance));
    }
    
    return quality_settings_.gamma * static_cast<float>(total_points);
}

// ==================== Worker Function ====================

void BalanceEngine::worker_process(
    WorkerContext& ctx,
    const std::vector<PlayerInfo>& players,
    const TeamMaskArray& team_masks,
    size_t begin_idx,
    size_t end_idx,
    int team_size,
    float balance_limit
) {
    std::vector<int> temp_role_indices(team_size);
    
    for (size_t tm_idx = begin_idx; tm_idx < end_idx; ++tm_idx) {
        // Split players into teams using bit iteration
        int idx1 = 0, idx2 = 0;
        
        team_masks.for_each_team1(tm_idx, [&](int i) {
            ctx.team1_buf.players[idx1++] = &players[i];
        });
        
        team_masks.for_each_team2(tm_idx, [&](int i) {
            ctx.team2_buf.players[idx2++] = &players[i];
        });
        
        // Pre-filter valid role masks for each team
        ctx.valid_mask_indices1.clear();
        ctx.valid_mask_indices2.clear();
        
        for (size_t rm_idx = 0; rm_idx < role_masks_.size(); ++rm_idx) {
            role_masks_.unpack(rm_idx, temp_role_indices.data());
            
            bool valid1 = is_mask_valid(
                ctx.team1_buf.players,
                temp_role_indices.data(),
                team_size
            );
            bool valid2 = is_mask_valid(
                ctx.team2_buf.players,
                temp_role_indices.data(),
                team_size
            );
            
            if (valid1) {
                ctx.valid_mask_indices1.push_back(rm_idx);
            }
            if (valid2) {
                ctx.valid_mask_indices2.push_back(rm_idx);
            }
        }
        
        if (ctx.valid_mask_indices1.empty() || ctx.valid_mask_indices2.empty()) {
            continue;
        }
        
        ctx.any_mask_valid = true;
        
        // Dynamic threshold for early pruning
        float current_threshold = std::min(balance_limit, ctx.get_threshold());
        
        for (size_t mi1 : ctx.valid_mask_indices1) {
            role_masks_.unpack(mi1, ctx.team1_buf.role_indices.data());
            
            apply_mask(
                ctx.team1_buf.players,
                ctx.team1_buf.role_indices.data(),
                ctx.team1_buf.ratings,
                ctx.team1_buf.actual_role_ids,
                team_size
            );
            
            for (size_t mi2 : ctx.valid_mask_indices2) {
                role_masks_.unpack(mi2, ctx.team2_buf.role_indices.data());
                
                apply_mask(
                    ctx.team2_buf.players,
                    ctx.team2_buf.role_indices.data(),
                    ctx.team2_buf.ratings,
                    ctx.team2_buf.actual_role_ids,
                    team_size
                );
                
                // === EARLY PRUNING ===
                // Calculate cheapest metric first
                QualityMetrics quality;
                quality.fairness = calc_fairness(
                    ctx.team1_buf.ratings,
                    ctx.team2_buf.ratings
                );
                
                if (quality.fairness > current_threshold) {
                    continue;
                }
                
                quality.role_fairness = calc_role_fairness(
                    ctx.team1_buf.ratings,
                    ctx.team2_buf.ratings,
                    ctx.team1_buf.role_indices.data(),
                    ctx.team2_buf.role_indices.data(),
                    team_size
                );
                
                float partial_sum = quality.fairness + quality.role_fairness;
                if (partial_sum > current_threshold) {
                    continue;
                }
                
                quality.uniformity = calc_uniformity(
                    ctx.team1_buf.ratings,
                    ctx.team2_buf.ratings
                );
                
                partial_sum += quality.uniformity;
                if (partial_sum > current_threshold) {
                    continue;
                }
                
                quality.role_points = calc_role_points(
                    ctx.team1_buf.players,
                    ctx.team2_buf.players,
                    ctx.team1_buf.actual_role_ids,
                    ctx.team2_buf.actual_role_ids
                );
                
                float total = quality.total();
                
                if (total > current_threshold) {
                    continue;
                }
                
                ctx.any_balance_valid = true;
                
                // Build result
                BalanceResultData result;
                result.quality = quality;
                
                TeamResult team1_result;
                team1_result.name = "team_1";
                team1_result.players.reserve(team_size);
                for (int i = 0; i < team_size; ++i) {
                    team1_result.players.push_back({
                        ctx.team1_buf.players[i]->member_id,
                        ctx.team1_buf.actual_role_ids[i],
                        ctx.team1_buf.ratings[i]
                    });
                }
                
                TeamResult team2_result;
                team2_result.name = "team_2";
                team2_result.players.reserve(team_size);
                for (int i = 0; i < team_size; ++i) {
                    team2_result.players.push_back({
                        ctx.team2_buf.players[i]->member_id,
                        ctx.team2_buf.actual_role_ids[i],
                        ctx.team2_buf.ratings[i]
                    });
                }
                
                result.teams = {std::move(team1_result), std::move(team2_result)};
                
                // Add via heap
                ctx.add_result(std::move(result));
                
                // Update threshold as we collect better results
                current_threshold = std::min(balance_limit, ctx.get_threshold());
            }
        }
    }
}

// ==================== Main Algorithm ====================

BalanceResponse BalanceEngine::find_balances(
    const std::vector<PlayerInfo>& players,
    int team_size,
    float balance_limit,
    int max_results
) {
    BalanceResponse response;
    
    // Validation
    if (static_cast<int>(players.size()) != team_size * 2) {
        response.result_code = 500;
        response.status = "Not enough players in lobby";
        return response;
    }
    
    if (static_cast<int>(players.size()) > engine_settings_.max_players) {
        response.result_code = 500;
        response.status = "Too many players (max " + std::to_string(engine_settings_.max_players) + ")";
        return response;
    }
    
    // Generate team masks using Gosper's hack
    TeamMaskArray team_masks;
    team_masks.generate(
        static_cast<int>(players.size()), 
        team_size,
        engine_settings_.max_players,
        engine_settings_.mask_reserve_limit
    );
    
    // Generate role masks
    generate_role_masks(team_size);
    
    if (role_masks_.empty()) {
        response.result_code = 500;
        response.status = "Cannot generate valid role masks for constraints";
        return response;
    }
    
    // Determine actual worker count
    size_t total_team_masks = team_masks.size();
    int actual_workers = std::min(
        num_workers_,
        static_cast<int>(total_team_masks)
    );
    
    if (actual_workers <= 1) {
        actual_workers = 1;
    }
    
    // Calculate max results per worker
    size_t max_results_per_worker = static_cast<size_t>(max_results / actual_workers) 
                                    + static_cast<size_t>(engine_settings_.worker_result_buffer);
    
    // Create per-worker contexts
    std::vector<WorkerContext> contexts(actual_workers);
    for (auto& ctx : contexts) {
        ctx.init(team_size, role_masks_.size(), max_results_per_worker);
    }
    
    // Partition team_masks across workers
    size_t chunk_size = total_team_masks / actual_workers;
    size_t remainder = total_team_masks % actual_workers;
    
    // Launch worker threads
    std::vector<std::thread> threads;
    threads.reserve(actual_workers - 1);
    
    size_t offset = 0;
    for (int w = 0; w < actual_workers; ++w) {
        size_t this_chunk = chunk_size + (w < static_cast<int>(remainder) ? 1 : 0);
        size_t begin_idx = offset;
        size_t end_idx = offset + this_chunk;
        offset = end_idx;
        
        if (w < actual_workers - 1) {
            threads.emplace_back(
                &BalanceEngine::worker_process, this,
                std::ref(contexts[w]),
                std::cref(players),
                std::cref(team_masks),
                begin_idx, end_idx,
                team_size, balance_limit
            );
        } else {
            // Last chunk in current thread
            worker_process(
                contexts[w], players, team_masks,
                begin_idx, end_idx,
                team_size, balance_limit
            );
        }
    }
    
    // Join all threads
    for (auto& t : threads) {
        t.join();
    }
    
    // Merge results
    bool any_mask_valid = false;
    bool any_balance_valid = false;
    size_t total_results = 0;
    
    for (const auto& ctx : contexts) {
        total_results += ctx.top_results.size();
        any_mask_valid |= ctx.any_mask_valid;
        any_balance_valid |= ctx.any_balance_valid;
    }
    
    // Handle errors
    if (!any_mask_valid) {
        response.result_code = 500;
        response.status = "Not enough players for each role";
        return response;
    }
    
    if (!any_balance_valid) {
        response.result_code = 500;
        response.status = "Can't shuffle players within balance limit";
        return response;
    }
    
    // Extract and merge all results from heaps
    response.balances.reserve(total_results);
    for (auto& ctx : contexts) {
        auto results = ctx.extract_results();
        response.balances.insert(
            response.balances.end(),
            std::make_move_iterator(results.begin()),
            std::make_move_iterator(results.end())
        );
    }
    
    // Final sort and limit
    if (static_cast<int>(response.balances.size()) > max_results) {
        std::partial_sort(
            response.balances.begin(),
            response.balances.begin() + max_results,
            response.balances.end(),
            [](const BalanceResultData& a, const BalanceResultData& b) {
                return a.quality.total() < b.quality.total();
            }
        );
        response.balances.resize(max_results);
    } else {
        std::sort(
            response.balances.begin(),
            response.balances.end(),
            [](const BalanceResultData& a, const BalanceResultData& b) {
                return a.quality.total() < b.quality.total();
            }
        );
    }
    
    return response;
}
