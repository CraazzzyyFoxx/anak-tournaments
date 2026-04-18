#include <pybind11/pybind11.h>
#include <pybind11/stl.h>
#include <pybind11/functional.h>
#include <pybind11/numpy.h>
#include "nsga_engine.hpp"

namespace py = pybind11;

PYBIND11_MODULE(_core, m)
{
    m.doc() = "NSGA-II Balance Engine - multi-objective team balancing module";

    // ==================== PlayerRoleInfo ====================
    py::class_<PlayerRoleInfo>(m, "PlayerRoleInfo")
        .def(py::init<>())
        .def(py::init([](int role_id, int rating, int priority, const std::vector<int>& subrole_ids) {
            return PlayerRoleInfo{role_id, rating, priority, subrole_ids};
        }),
            py::arg("role_id"),
            py::arg("rating"),
            py::arg("priority"),
            py::arg("subrole_ids") = std::vector<int>{}
        )
        .def_readwrite("role_id", &PlayerRoleInfo::role_id)
        .def_readwrite("rating", &PlayerRoleInfo::rating)
        .def_readwrite("priority", &PlayerRoleInfo::priority)
        .def_readwrite("subrole_ids", &PlayerRoleInfo::subrole_ids)
        .def("__repr__", [](const PlayerRoleInfo& r) {
            return "PlayerRoleInfo(role_id=" + std::to_string(r.role_id) + 
                   ", rating=" + std::to_string(r.rating) + 
                   ", priority=" + std::to_string(r.priority) +
                   ", subroles=" + std::to_string(r.subrole_ids.size()) + ")";
        });

    // ==================== PlayerInfo ====================
    py::class_<PlayerInfo>(m, "PlayerInfo")
        .def(py::init<>())
        .def(py::init([](int member_id, const std::vector<PlayerRoleInfo>& roles) {
            PlayerInfo p;
            p.member_id = member_id;
            p.roles = roles;
            return p;
        }), py::arg("member_id"), py::arg("roles"))
        .def_readwrite("member_id", &PlayerInfo::member_id)
        .def_readwrite("roles", &PlayerInfo::roles)
        .def("can_play_role", &PlayerInfo::can_play_role, py::arg("role_id"))
        .def("get_rating_for_role", &PlayerInfo::get_rating_for_role, py::arg("role_id"))
        .def("get_priority_for_role", &PlayerInfo::get_priority_for_role, py::arg("role_id"))
        .def("__repr__", [](const PlayerInfo& p) {
            return "PlayerInfo(member_id=" + std::to_string(p.member_id) + 
                   ", roles=[" + std::to_string(p.roles.size()) + " roles])";
        });

    // ==================== RoleSettings ====================
    py::class_<RoleSettings>(m, "RoleSettings")
        .def(py::init<>())
        .def(py::init([](int count_in_team, const std::unordered_map<int, int>& subrole_capacities) {
            RoleSettings s;
            s.count_in_team = count_in_team;
            s.subrole_capacities = subrole_capacities;
            return s;
        }), py::arg("count_in_team") = 1, py::arg("subrole_capacities") = std::unordered_map<int, int>{})
        .def_readwrite("count_in_team", &RoleSettings::count_in_team)
        .def_readwrite("subrole_capacities", &RoleSettings::subrole_capacities)
        .def("__repr__", [](const RoleSettings& s) {
            return "RoleSettings(count_in_team=" + std::to_string(s.count_in_team)
                + ", subroles=" + std::to_string(s.subrole_capacities.size()) + ")";
        });

    // ==================== NSGASettings ====================
    py::class_<NSGASettings>(m, "NSGASettings")
        .def(py::init<>())
        .def_readwrite("population_size", &NSGASettings::population_size)
        .def_readwrite("generations", &NSGASettings::generations)
        .def_readwrite("num_pareto_solutions", &NSGASettings::num_pareto_solutions)
        .def_readwrite("weight_team_variance", &NSGASettings::weight_team_variance)
        .def_readwrite("role_imbalance_blend", &NSGASettings::role_imbalance_blend)
        .def_readwrite("subrole_blend", &NSGASettings::subrole_blend)
        .def_readwrite("intra_team_std_blend", &NSGASettings::intra_team_std_blend)
        .def_readwrite("penalty_invalid_role", &NSGASettings::penalty_invalid_role)
        .def_readwrite("penalty_prio_1", &NSGASettings::penalty_prio_1)
        .def_readwrite("penalty_prio_2", &NSGASettings::penalty_prio_2)
        .def_readwrite("penalty_prio_3", &NSGASettings::penalty_prio_3)
        .def("__repr__", [](const NSGASettings& s) {
            return "NSGASettings(pop=" + std::to_string(s.population_size) +
                   ", gens=" + std::to_string(s.generations) +
                   ", pareto=" + std::to_string(s.num_pareto_solutions) + ")";
        });

    // ==================== EngineSettings ====================
    py::class_<EngineSettings>(m, "EngineSettings")
        .def(py::init<>())
        .def_readwrite("num_workers", &EngineSettings::num_workers)
        .def_readwrite("fallback_workers", &EngineSettings::fallback_workers)
        .def_readwrite("seed", &EngineSettings::seed)
        .def("__repr__", [](const EngineSettings& s) {
            return "EngineSettings(num_workers=" + std::to_string(s.num_workers) +
                   ", seed=" + std::to_string(s.seed) + ")";
        });

    // ==================== AssignedPlayer ====================
    py::class_<AssignedPlayer>(m, "AssignedPlayer")
        .def(py::init<>())
        .def(py::init([](int member_id, int role_id, int rating, int priority) {
            return AssignedPlayer{member_id, role_id, rating, priority};
        }), py::arg("member_id"), py::arg("role_id"), py::arg("rating"), py::arg("priority"))
        .def_readwrite("member_id", &AssignedPlayer::member_id)
        .def_readwrite("role_id", &AssignedPlayer::role_id)
        .def_readwrite("rating", &AssignedPlayer::rating)
        .def_readwrite("priority", &AssignedPlayer::priority)
        .def("__repr__", [](const AssignedPlayer& a) {
            return "AssignedPlayer(member_id=" + std::to_string(a.member_id) +
                   ", role_id=" + std::to_string(a.role_id) +
                   ", rating=" + std::to_string(a.rating) +
                   ", priority=" + std::to_string(a.priority) + ")";
        });

    // ==================== TeamResult ====================
    py::class_<TeamResult>(m, "TeamResult")
        .def(py::init<>())
        .def(py::init([](int team_id, const std::vector<AssignedPlayer>& players, int total_rating) {
            TeamResult t;
            t.team_id = team_id;
            t.players = players;
            t.total_rating = total_rating;
            return t;
        }), py::arg("team_id"), py::arg("players"), py::arg("total_rating"))
        .def_readwrite("team_id", &TeamResult::team_id)
        .def_readwrite("players", &TeamResult::players)
        .def_readwrite("total_rating", &TeamResult::total_rating)
        .def("__repr__", [](const TeamResult& t) {
            return "TeamResult(team_id=" + std::to_string(t.team_id) +
                   ", players=" + std::to_string(t.players.size()) +
                   ", total_rating=" + std::to_string(t.total_rating) + ")";
        });

    // ==================== DraftSolution ====================
    py::class_<DraftSolution>(m, "DraftSolution")
        .def(py::init<>())
        .def_readwrite("solution_id", &DraftSolution::solution_id)
        .def_readwrite("fitness_balance", &DraftSolution::fitness_balance)
        .def_readwrite("fitness_priority", &DraftSolution::fitness_priority)
        .def_readwrite("fitness_role_imbalance", &DraftSolution::fitness_role_imbalance)
        .def_readwrite("fitness_subrole", &DraftSolution::fitness_subrole)
        .def_readwrite("fitness_intra_team_std", &DraftSolution::fitness_intra_team_std)
        .def_readwrite("teams", &DraftSolution::teams)
        .def("__repr__", [](const DraftSolution& s) {
            return "DraftSolution(id=" + std::to_string(s.solution_id) +
                   ", balance=" + std::to_string(s.fitness_balance) +
                   ", priority=" + std::to_string(s.fitness_priority) +
                   ", role_imbalance=" + std::to_string(s.fitness_role_imbalance) +
                   ", subrole=" + std::to_string(s.fitness_subrole) +
                   ", teams=" + std::to_string(s.teams.size()) + ")";
        });

    py::class_<MetricSummary>(m, "MetricSummary")
        .def(py::init<>())
        .def_readwrite("min_value", &MetricSummary::min_value)
        .def_readwrite("avg_value", &MetricSummary::avg_value)
        .def_readwrite("max_value", &MetricSummary::max_value)
        .def("__repr__", [](const MetricSummary& s) {
            return "MetricSummary(min=" + std::to_string(s.min_value) +
                   ", avg=" + std::to_string(s.avg_value) +
                   ", max=" + std::to_string(s.max_value) + ")";
        });

    py::class_<ProgressSnapshot>(m, "ProgressSnapshot")
        .def(py::init<>())
        .def_readwrite("generation", &ProgressSnapshot::generation)
        .def_readwrite("total_generations", &ProgressSnapshot::total_generations)
        .def_readwrite("pareto_front_size", &ProgressSnapshot::pareto_front_size)
        .def_readwrite("fitness_balance", &ProgressSnapshot::fitness_balance)
        .def_readwrite("fitness_priority", &ProgressSnapshot::fitness_priority)
        .def_readwrite("fitness_role_imbalance", &ProgressSnapshot::fitness_role_imbalance)
        .def_readwrite("fitness_subrole", &ProgressSnapshot::fitness_subrole)
        .def_readwrite("fitness_intra_team_std", &ProgressSnapshot::fitness_intra_team_std)
        .def("__repr__", [](const ProgressSnapshot& s) {
            return "ProgressSnapshot(generation=" + std::to_string(s.generation) +
                   ", total=" + std::to_string(s.total_generations) +
                   ", pareto_front_size=" + std::to_string(s.pareto_front_size) + ")";
        });

    // ==================== NSGA2Engine ====================
    py::class_<NSGA2Engine>(m, "NSGA2Engine")
        .def(py::init<const NSGASettings&,
                      const std::vector<int>&,
                      const std::unordered_map<int, RoleSettings>&,
                      int,
                      const EngineSettings&>(),
             py::arg("nsga_settings"),
             py::arg("role_ids"),
             py::arg("role_settings"),
             py::arg("players_in_team"),
             py::arg("engine_settings") = EngineSettings{},
             R"doc(
                Create a new NSGA2Engine instance.
                
                Args:
                    nsga_settings: NSGASettings for genetic algorithm parameters
                    role_ids: List of role IDs
                    role_settings: Dict mapping role_id to RoleSettings
                    players_in_team: Number of players per team
                    engine_settings: EngineSettings for threading and seed
             )doc")
        .def("run",
             [](NSGA2Engine& engine,
                const std::vector<PlayerInfo>& players,
                py::object progress_callback,
                int progress_every) {
                 std::function<void(const ProgressSnapshot&)> cpp_callback;
                 if (!progress_callback.is_none()) {
                     cpp_callback = progress_callback.cast<std::function<void(const ProgressSnapshot&)>>();
                 }

                 py::gil_scoped_release release;
                 return engine.run(players, cpp_callback, progress_every);
             },
             py::arg("players"),
             py::arg("progress_callback") = py::none(),
             py::arg("progress_every") = 1,
             R"doc(
                 Run NSGA-II optimization.
                 
                 Args:
                     players: List of PlayerInfo objects
                     progress_callback: Optional callable accepting ProgressSnapshot
                     progress_every: Report progress every N generations
                 
                 Returns:
                     List of DraftSolution from Pareto front
             )doc")
        .def_property_readonly("nsga_settings", &NSGA2Engine::nsga_settings)
        .def_property_readonly("engine_settings", &NSGA2Engine::engine_settings)
        .def("__repr__", [](const NSGA2Engine& e) {
            return "NSGA2Engine(pop=" + std::to_string(e.nsga_settings().population_size) +
                   ", gens=" + std::to_string(e.nsga_settings().generations) + ")";
        });

    // ==================== Module-level convenience functions ====================
    m.def("create_player",
        [](int member_id, const std::vector<std::tuple<int, int, int, std::vector<int>>>& roles) {
            PlayerInfo p;
            p.member_id = member_id;
            for (const auto& [role_id, rating, priority, subrole_ids] : roles) {
                p.roles.push_back(PlayerRoleInfo{role_id, rating, priority, subrole_ids});
            }
            return p;
        },
        py::arg("member_id"),
        py::arg("roles"),
        R"doc(
            Create a PlayerInfo from tuple data.
            
            Args:
                member_id: Player's unique ID
            roles: List of (role_id, rating, priority, subrole_ids) tuples
        )doc");

    m.def("create_nsga_settings",
        [](int population_size, int generations, int num_pareto_solutions,
           float weight_team_variance, float role_imbalance_blend,
           float subrole_blend, float intra_team_std_blend,
           float penalty_invalid_role, float penalty_prio_1,
           float penalty_prio_2, float penalty_prio_3) {
            NSGASettings s;
            s.population_size = population_size;
            s.generations = generations;
            s.num_pareto_solutions = num_pareto_solutions;
            s.weight_team_variance = weight_team_variance;
            s.role_imbalance_blend = role_imbalance_blend;
            s.subrole_blend = subrole_blend;
            s.intra_team_std_blend = intra_team_std_blend;
            s.penalty_invalid_role = penalty_invalid_role;
            s.penalty_prio_1 = penalty_prio_1;
            s.penalty_prio_2 = penalty_prio_2;
            s.penalty_prio_3 = penalty_prio_3;
            return s;
        },
        py::arg("population_size") = 200,
        py::arg("generations") = 1000,
        py::arg("num_pareto_solutions") = 50,
        py::arg("weight_team_variance") = 1.0f,
        py::arg("role_imbalance_blend") = 0.1f,
        py::arg("subrole_blend") = 0.1f,
        py::arg("intra_team_std_blend") = 0.0f,
        py::arg("penalty_invalid_role") = 10000.0f,
        py::arg("penalty_prio_1") = 10.0f,
        py::arg("penalty_prio_2") = 3.0f,
        py::arg("penalty_prio_3") = 0.0f,
        "Create NSGASettings with all parameters");

    m.def("create_role_settings",
        [](int count_in_team, const std::unordered_map<int, int>& subrole_capacities) {
            RoleSettings s;
            s.count_in_team = count_in_team;
            s.subrole_capacities = subrole_capacities;
            return s;
        },
        py::arg("count_in_team") = 1,
        py::arg("subrole_capacities") = std::unordered_map<int, int>{},
        "Create RoleSettings with count_in_team and subroles");

    m.def("create_engine_settings",
        [](int num_workers, int fallback_workers, int seed) {
            EngineSettings s;
            s.num_workers = num_workers;
            s.fallback_workers = fallback_workers;
            s.seed = seed;
            return s;
        },
        py::arg("num_workers") = 0,
        py::arg("fallback_workers") = 4,
        py::arg("seed") = 42,
        "Create EngineSettings with all parameters");
}
