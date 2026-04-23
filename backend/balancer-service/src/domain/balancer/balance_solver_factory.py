class BalanceSolverFactory:
    def __init__(
        self,
        *,
        moo_solver,
        cpsat_solver,
    ) -> None:
        self._solvers = {
            "moo": moo_solver,
            "cpsat": cpsat_solver,
        }

    def get_solver(self, algorithm: str):
        try:
            return self._solvers[algorithm]
        except KeyError as exc:
            raise ValueError(f"Unsupported balancer algorithm: {algorithm}") from exc
