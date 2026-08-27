# mix-balancer (vendored core)

C++ team-balancing engine, vendored from
[mixtura-dev/mixtura-balancer](https://github.com/mixtura-dev/mixtura-balancer)
at commit `e48ec2bb6a04df78d2bfc7cf5b6b9570eae27181` (`cpp_balancer/` subtree
only -- their FastStream/RabbitMQ service wrapper is not needed here; this
service calls the engine in-process as the ``mix_balancer`` backend, see
`../../src/domain/balancer/backends/mix_balancer.py`).

Exhaustive brute-force search over every player/role split for **exactly two
equal-size teams** (bitmask enumeration with early pruning), released under
MIT. Built via `scikit-build-core` + CMake + pybind11 during `uv sync`
(Linux-only, mirrors `native/tournament_balancer`'s maturin build for the
same reason: no Windows/macOS toolchain assumption).

## Deviations from upstream

The `.cpp`/`.hpp` source is otherwise byte-identical to the upstream commit
above (only renamed on vendoring: `balance_engine.cpp`/`.hpp` ->
`mix_balancer.cpp`/`.hpp`, plus the matching `#include` and header-guard
update). Two build-config changes were needed, both in
`CMakeLists.txt`/`pyproject.toml`, not the source itself:

- **Explicit `target_link_libraries(_core PRIVATE stdc++)`.** The actual
  fix for `undefined symbol: _ZTVN10__cxxabiv117__class_type_infoE` (a C++
  RTTI vtable symbol) at import time: on this toolchain, CMake's CXX
  compiler resolved to the `gcc` driver rather than `g++`/`c++` -- `gcc`
  compiles `.cpp` fine given `-std=gnu++20`, but unlike `g++` it does not
  automatically add `-lstdc++` at link time. Linking succeeds regardless
  (shared libraries may have undefined symbols), but the extension never
  imports because its NEEDED list never gained `libstdc++.so`.
- **LTO removed** (precautionary, not the actual fix above). Upstream
  enabled it twice over (a manual `-flto` compile flag *and*
  `CMAKE_INTERPROCEDURAL_OPTIMIZATION=ON`, which injects its own
  `-flto=auto -fno-fat-lto-objects`) -- redundant and a plausible source of
  its own link fragility, so it's off. `-O3` alone covers the overwhelming
  majority of the available speedup here.

Do not hand-edit `mix_balancer.cpp`/`.hpp`/`pybind11_bindings.cpp` without
noting the drift from upstream at the top of the file.
