#ifndef BALANCE_ENGINE_HPP
#define BALANCE_ENGINE_HPP

#include <vector>
#include <string>
#include <unordered_map>
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <bit>
#include <cassert>
#include <thread>
#include <queue>
#include <limits>

// ==================== Data Structures ====================

struct RoleRating {
    int role_id;
    int rating;
    int priority;
};

struct PlayerInfo {
    int member_id;
    std::vector<RoleRating> roles;
    
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
};

struct RoleConstraint {
    int min_in_team;
    int max_in_team;
};

struct QualitySettings {
    // Quality calculation weights
    float alpha = 1.0f;
    float beta = 1.0f;
    float gamma = 1.0f;
    float xi = 0.2f;
    
    // Norm powers
    float p = 1.0f;
    float q = 1.0f;
    float g = 1.0f;
    
    // Role priority
    int max_priority = 3;
    std::unordered_map<int, float> role_weights;
};

struct EngineSettings {
    // Threading
    int num_workers = 0;              // 0 = auto-detect
    int fallback_workers = 4;         // Fallback if auto-detect fails
    
    // Memory/performance tuning
    int worker_result_buffer = 1000;  // Extra buffer per worker for results
    int max_players = 32;             // Maximum players supported (due to bitmask)
    int mask_reserve_limit = 20;      // Limit for mask pre-allocation (1 << this)
    
    // Priority imbalance threshold
    int priority_imbalance_threshold = 1;  // Imbalance must exceed this to apply penalty
};

struct QualityMetrics {
    float fairness = 0.0f;
    float role_fairness = 0.0f;
    float role_points = 0.0f;
    float uniformity = 0.0f;
    
    float total() const {
        return fairness + role_fairness + role_points + uniformity;
    }
};

struct TeamPlayerResult {
    int member_id;
    int role_id;
    int rating;
};

struct TeamResult {
    std::string name;
    std::vector<TeamPlayerResult> players;
};

struct BalanceResultData {
    QualityMetrics quality;
    std::vector<TeamResult> teams;
};

struct BalanceResponse {
    int result_code = 200;
    std::string status = "ok";
    std::vector<BalanceResultData> balances;
};

// ==================== Compact Mask Storage ====================

class TeamMaskArray {
    std::vector<uint32_t> data_;
    uint8_t total_players_ = 0;
    uint8_t team_size_ = 0;
    
public:
    TeamMaskArray() = default;
    
    void generate(int total_players, int team_size, int max_players = 32, int reserve_limit = 20) {
        assert(total_players <= max_players);
        total_players_ = static_cast<uint8_t>(total_players);
        team_size_ = static_cast<uint8_t>(team_size);
        
        data_.clear();
        
        if (team_size == 0 || team_size > total_players) {
            return;
        }
        
        uint32_t mask = (1u << team_size) - 1;
        uint32_t limit = 1u << total_players;
        
        data_.reserve(1u << std::min(total_players, reserve_limit));
        
        while (mask < limit) {
            data_.push_back(mask);
            
            uint32_t c = mask & (0u - mask);
            uint32_t r = mask + c;
            mask = (((r ^ mask) >> 2) / c) | r;
        }
        
        data_.shrink_to_fit();
    }
    
    size_t size() const { return data_.size(); }
    bool empty() const { return data_.empty(); }
    uint8_t total_players() const { return total_players_; }
    uint8_t team_size() const { return team_size_; }
    
    uint32_t raw(size_t idx) const { return data_[idx]; }
    
    template<typename Func>
    void for_each_team1(size_t mask_idx, Func&& func) const {
        uint32_t m = data_[mask_idx];
        while (m) {
            int idx = std::countr_zero(m);
            func(idx);
            m &= m - 1;
        }
    }
    
    template<typename Func>
    void for_each_team2(size_t mask_idx, Func&& func) const {
        uint32_t all_bits = (1u << total_players_) - 1;
        uint32_t m = data_[mask_idx] ^ all_bits;
        while (m) {
            int idx = std::countr_zero(m);
            func(idx);
            m &= m - 1;
        }
    }
    
    std::string to_string(size_t mask_idx) const {
        std::string result(total_players_, '1');
        uint32_t m = data_[mask_idx];
        for (int i = 0; i < total_players_; ++i) {
            if ((m >> i) & 1) {
                result[i] = '0';
            }
        }
        return result;
    }
};

class RoleMaskArray {
    std::vector<uint64_t> data_;
    
    uint8_t team_size_ = 0;
    uint8_t num_roles_ = 0;
    uint8_t bits_per_role_ = 0;
    uint8_t bits_per_mask_ = 0;
    uint8_t masks_per_word_ = 0;
    size_t count_ = 0;
    
    static constexpr int select_bpr(int num_roles) {
        if (num_roles <= 2) return 1;
        if (num_roles <= 4) return 2;
        if (num_roles <= 16) return 4;
        return 8;
    }
    
    static constexpr int round_to_divisor(int bits) {
        if (bits <= 1) return 1;
        if (bits <= 2) return 2;
        if (bits <= 4) return 4;
        if (bits <= 8) return 8;
        if (bits <= 16) return 16;
        if (bits <= 32) return 32;
        return 64;
    }
    
public:
    RoleMaskArray() = default;
    
    void init(int team_size, int num_roles) {
        team_size_ = static_cast<uint8_t>(team_size);
        num_roles_ = static_cast<uint8_t>(num_roles);
        bits_per_role_ = static_cast<uint8_t>(select_bpr(num_roles));
        
        int raw_bits = team_size * bits_per_role_;
        bits_per_mask_ = static_cast<uint8_t>(round_to_divisor(raw_bits));
        masks_per_word_ = static_cast<uint8_t>(64 / bits_per_mask_);
        
        data_.clear();
        count_ = 0;
    }
    
    void reserve(size_t count) {
        size_t words = (count + masks_per_word_ - 1) / masks_per_word_;
        data_.reserve(words);
    }
    
    void clear() {
        data_.clear();
        count_ = 0;
    }
    
    void push_back(const int* role_indices) {
        size_t word_idx = count_ / masks_per_word_;
        size_t slot = count_ % masks_per_word_;
        
        if (slot == 0) {
            data_.push_back(0);
        }
        
        uint64_t packed = 0;
        for (int i = 0; i < team_size_; ++i) {
            packed |= static_cast<uint64_t>(role_indices[i]) << (i * bits_per_role_);
        }
        
        data_[word_idx] |= packed << (slot * bits_per_mask_);
        ++count_;
    }
    
    void push_back(const std::vector<int>& role_indices) {
        push_back(role_indices.data());
    }
    
    size_t size() const { return count_; }
    bool empty() const { return count_ == 0; }
    int team_size() const { return team_size_; }
    int num_roles() const { return num_roles_; }
    
    int get_role(size_t mask_idx, int player_idx) const {
        size_t word_idx = mask_idx / masks_per_word_;
        size_t slot = mask_idx % masks_per_word_;
        int shift = static_cast<int>(slot * bits_per_mask_ + player_idx * bits_per_role_);
        
        uint64_t role_mask = (1ULL << bits_per_role_) - 1;
        return static_cast<int>((data_[word_idx] >> shift) & role_mask);
    }
    
    void unpack(size_t mask_idx, int* out_roles) const {
        size_t word_idx = mask_idx / masks_per_word_;
        size_t slot = mask_idx % masks_per_word_;
        
        uint64_t packed = data_[word_idx] >> (slot * bits_per_mask_);
        uint64_t role_mask = (1ULL << bits_per_role_) - 1;
        
        for (int i = 0; i < team_size_; ++i) {
            out_roles[i] = static_cast<int>(packed & role_mask);
            packed >>= bits_per_role_;
        }
    }
    
    void unpack(size_t mask_idx, std::vector<int>& out_roles) const {
        out_roles.resize(team_size_);
        unpack(mask_idx, out_roles.data());
    }
    
    std::string to_string(size_t mask_idx) const {
        std::string result(team_size_, '0');
        for (int i = 0; i < team_size_; ++i) {
            result[i] = static_cast<char>('0' + get_role(mask_idx, i));
        }
        return result;
    }
};

// ==================== Per-Worker Context ====================

struct WorkerContext {
    struct TeamBuffers {
        std::vector<const PlayerInfo*> players;
        std::vector<int> ratings;
        std::vector<int> role_indices;
        std::vector<int> actual_role_ids;
        
        void resize(int size) {
            players.resize(size);
            ratings.resize(size);
            role_indices.resize(size);
            actual_role_ids.resize(size);
        }
    };
    
    TeamBuffers team1_buf;
    TeamBuffers team2_buf;
    
    std::vector<size_t> valid_mask_indices1;
    std::vector<size_t> valid_mask_indices2;
    
    // Top-K heap: max-heap by quality (worst on top for fast rejection)
    struct QualityCompare {
        bool operator()(const BalanceResultData& a, const BalanceResultData& b) const {
            return a.quality.total() < b.quality.total();
        }
    };
    
    std::priority_queue<BalanceResultData, std::vector<BalanceResultData>, QualityCompare> top_results;
    size_t max_results = 10000;
    
    bool any_mask_valid = false;
    bool any_balance_valid = false;
    
    void init(int team_size, size_t role_masks_count, size_t max_results_per_worker) {
        team1_buf.resize(team_size);
        team2_buf.resize(team_size);
        valid_mask_indices1.reserve(role_masks_count);
        valid_mask_indices2.reserve(role_masks_count);
        max_results = max_results_per_worker;
    }
    
    float get_threshold() const {
        if (top_results.size() < max_results) {
            return std::numeric_limits<float>::max();
        }
        return top_results.top().quality.total();
    }
    
    void add_result(BalanceResultData&& result) {
        if (top_results.size() < max_results) {
            top_results.push(std::move(result));
        } else if (result.quality.total() < top_results.top().quality.total()) {
            top_results.pop();
            top_results.push(std::move(result));
        }
    }
    
    std::vector<BalanceResultData> extract_results() {
        std::vector<BalanceResultData> results;
        results.reserve(top_results.size());
        while (!top_results.empty()) {
            results.push_back(std::move(const_cast<BalanceResultData&>(top_results.top())));
            top_results.pop();
        }
        return results;
    }
};

// ==================== Main Engine ====================

class BalanceEngine {
public:
    BalanceEngine(
        const QualitySettings& quality_settings,
        const std::vector<int>& role_ids,
        const std::unordered_map<int, RoleConstraint>& constraints,
        const EngineSettings& engine_settings = EngineSettings{}
    );
    
    BalanceResponse find_balances(
        const std::vector<PlayerInfo>& players,
        int team_size,
        float balance_limit,
        int max_results = 1000
    );
    
    // Getters for settings (useful for debugging/inspection)
    const QualitySettings& quality_settings() const { return quality_settings_; }
    const EngineSettings& engine_settings() const { return engine_settings_; }

private:
    QualitySettings quality_settings_;
    EngineSettings engine_settings_;
    std::vector<int> role_ids_;
    std::unordered_map<int, RoleConstraint> constraints_;
    int num_workers_;
    
    RoleMaskArray role_masks_;
    
    void generate_role_masks(int team_size);
    
    bool is_mask_valid(
        const std::vector<const PlayerInfo*>& team,
        const int* role_indices,
        int team_size
    ) const;
    
    void apply_mask(
        const std::vector<const PlayerInfo*>& team,
        const int* role_indices,
        std::vector<int>& ratings,
        std::vector<int>& actual_role_ids,
        int team_size
    ) const;
    
    float calc_fairness(
        const std::vector<int>& r1,
        const std::vector<int>& r2
    ) const;
    
    float calc_uniformity(
        const std::vector<int>& r1,
        const std::vector<int>& r2
    ) const;
    
    float calc_role_fairness(
        const std::vector<int>& r1,
        const std::vector<int>& r2,
        const int* m1,
        const int* m2,
        int team_size
    ) const;
    
    float calc_role_points(
        const std::vector<const PlayerInfo*>& t1,
        const std::vector<const PlayerInfo*>& t2,
        const std::vector<int>& roles1,
        const std::vector<int>& roles2
    ) const;
    
    void worker_process(
        WorkerContext& ctx,
        const std::vector<PlayerInfo>& players,
        const TeamMaskArray& team_masks,
        size_t begin_idx,
        size_t end_idx,
        int team_size,
        float balance_limit
    );
};

#endif // BALANCE_ENGINE_HPP
