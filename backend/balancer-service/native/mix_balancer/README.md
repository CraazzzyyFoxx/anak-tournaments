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

Do not hand-edit `mix_balancer.cpp`/`.hpp`/`pybind11_bindings.cpp` without
noting the drift from upstream at the top of the file (renamed from
`balance_engine.cpp`/`.hpp` on vendoring -- otherwise byte-identical to the
upstream commit above).
