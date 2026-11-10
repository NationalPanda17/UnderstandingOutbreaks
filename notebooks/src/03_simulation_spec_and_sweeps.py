# %% [markdown]
# # Run a sandbox model specification and a parameter sweep
#
# **Illustrative simulation: not a forecast, not fitted to data.**
#
# This notebook loads a model specification exported from "Learn and simulate" (or the built-in example), runs it
# with scipy, and sweeps one parameter. It uses no reported data. Rate expressions are evaluated with a small
# whitelist-based evaluator: only arithmetic and the functions the sandbox itself allows.

# %%
import ast, json, math, os
import numpy as np
from scipy.integrate import solve_ivp

SPEC_FILE = os.environ.get("UO_SPEC")  # path to a spec exported from the sandbox; None = built-in SEIR example
EXAMPLE = {
    "specVersion": "1.0", "id": "seir-teaching", "name": "SEIR teaching model", "template": "SEIR",
    "compartments": [{"id": "S", "initial": 9995}, {"id": "E", "initial": 0, "infected": True}, {"id": "I", "initial": 5, "infected": True}, {"id": "R", "initial": 0}],
    "parameters": {"beta": {"value": 0.5, "min": 0, "max": 10, "unit": "1/day"}, "gamma": {"value": 0.2, "min": 0.01, "max": 2, "unit": "1/day"}, "sigma": {"value": 1 / 3, "min": 0.02, "max": 5, "unit": "1/day"}},
    "flows": [{"id": "infection", "from": "S", "to": "E", "rate": "beta*S*I/N", "infection": True}, {"id": "progress1", "from": "E", "to": "I", "rate": "sigma*E"}, {"id": "recovery", "from": "I", "to": "R", "rate": "gamma*I"}],
    "interventions": [{"id": "contact_reduction", "type": "scale", "param": "beta", "value": 0.5, "start": 20, "end": 60}],
    "time": {"days": 160, "dt": 1}, "solver": {"method": "rk45"}, "seed": None,
}
spec = json.load(open(SPEC_FILE)) if SPEC_FILE else EXAMPLE
print("model:", spec["name"], "| compartments:", [c["id"] for c in spec["compartments"]])

# %% [markdown]
# ## A safe evaluator for rate expressions

# %%
FUNCS = {"exp": math.exp, "log": math.log, "sqrt": math.sqrt, "sin": math.sin, "cos": math.cos, "abs": abs,
         "min": min, "max": max, "pow": pow, "step": lambda x: 1.0 if x >= 0 else 0.0}
OPS = {ast.Add: lambda a, b: a + b, ast.Sub: lambda a, b: a - b, ast.Mult: lambda a, b: a * b, ast.Div: lambda a, b: a / b, ast.Pow: lambda a, b: a ** b}

def compile_rate(src):
    tree = ast.parse(src.replace("^", "**"), mode="eval")
    def ev(node, env):
        if isinstance(node, ast.Expression): return ev(node.body, env)
        if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)): return float(node.value)
        if isinstance(node, ast.Name):
            if node.id == "pi": return math.pi
            if node.id in env: return env[node.id]
            raise ValueError(f"unknown name {node.id!r}")
        if isinstance(node, ast.BinOp) and type(node.op) in OPS: return OPS[type(node.op)](ev(node.left, env), ev(node.right, env))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd)): return -ev(node.operand, env) if isinstance(node.op, ast.USub) else ev(node.operand, env)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCS and not node.keywords:
            return FUNCS[node.func.id](*[ev(a, env) for a in node.args])
        raise ValueError("expression is not allowed")
    return lambda env: ev(tree, env)

assert abs(compile_rate("2*max(1, 3)^2 - step(-1)")({}) - 18) < 1e-12
for bad in ["__import__('os')", "S.real", "open('x')", "lambda: 1", "[1][0]"]:
    try:
        compile_rate(bad)({"S": 1.0}); raise AssertionError("unsafe expression was accepted: " + bad)
    except (ValueError, SyntaxError):
        pass
print("evaluator checks passed")

# %% [markdown]
# ## Run the model

# %%
def run(spec, overrides=None):
    comps = [c["id"] for c in spec["compartments"]]
    base = {k: v["value"] for k, v in spec["parameters"].items()}
    base.update(overrides or {})
    rates = [(compile_rate(f["rate"]), f.get("from"), f.get("to")) for f in spec["flows"]]
    ivs = spec.get("interventions") or []
    def params_at(t):
        p = dict(base)
        for iv in ivs:
            if iv["start"] <= t < iv["end"]:
                p[iv["param"]] = p[iv["param"]] * iv["value"] if iv["type"] == "scale" else iv["value"]
        return p
    def rhs(t, y):
        env = dict(params_at(t)); env.update(zip(comps, y)); env["N"] = float(sum(y)); env["t"] = t
        d = [0.0] * len(comps)
        for fn, src, dst in rates:
            r = fn(env)
            if src: d[comps.index(src)] -= r
            if dst: d[comps.index(dst)] += r
        return d
    T, dt = spec["time"]["days"], spec["time"]["dt"]
    breaks = sorted({0.0, float(T), *[float(x) for iv in ivs for x in (iv["start"], iv["end"]) if 0 < x < T]})
    t_out = np.arange(0, T + dt / 2, dt)
    y = np.array([c["initial"] for c in spec["compartments"]], dtype=float)
    ts, ys = [0.0], [y.copy()]
    for a, b in zip(breaks[:-1], breaks[1:]):  # restart where parameters jump
        grid = [x for x in t_out if a < x <= b + 1e-9]
        sol = solve_ivp(rhs, (a, b), y, method="DOP853", t_eval=sorted(set(grid + [b])), rtol=1e-10, atol=1e-10)
        for tt, col in zip(sol.t, sol.y.T):
            if any(abs(tt - g) < 1e-9 for g in grid):
                ts.append(float(tt)); ys.append(col.copy())
        y = sol.y[:, -1]
    return np.array(ts), np.array(ys), comps

t, y, comps = run(spec)
total = y.sum(axis=1)
infected = [c["id"] for c in spec["compartments"] if c.get("infected") and c["id"].startswith("I")] or [comps[-2]]
I = y[:, [comps.index(c) for c in infected]].sum(axis=1)
print(f"peak infectious (simulated): {I.max():.1f} on day {t[I.argmax()]:.0f}")
closed = all(f.get("from") and f.get("to") for f in spec["flows"])
if closed:
    assert np.allclose(total, total[0], rtol=1e-8), "population should be conserved in a closed model"
    print("population conserved:", round(float(total[0]), 3))

# %% [markdown]
# ## A one-way sweep
#
# How does the simulated peak change with one parameter? This explores the model. It does not estimate anything.

# %%
PARAM = "beta" if "beta" in spec["parameters"] else next(iter(spec["parameters"]))
lo, hi = spec["parameters"][PARAM]["value"] * 0.5, spec["parameters"][PARAM]["value"] * 1.5
print(f"sweep of {PARAM} (simulated peak of infectious people)")
for v in np.linspace(lo, hi, 7):
    tt, yy, _ = run(spec, {PARAM: float(v)})
    Ii = yy[:, [comps.index(c) for c in infected]].sum(axis=1)
    print(f"  {PARAM} = {v:.4f}: peak {Ii.max():10.1f} on day {tt[Ii.argmax()]:.0f}")
print("ILLUSTRATIVE SIMULATION: not a forecast, not fitted to data.")
