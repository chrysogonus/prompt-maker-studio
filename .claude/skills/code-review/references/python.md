# Python Review Checklist

## Code Style (PEP 8)

- [ ] Indentation uses 4 spaces — no tabs.
- [ ] Lines are at most 88-120 characters (match project's formatter config — Black defaults to 88).
- [ ] Two blank lines between top-level definitions; one blank line between methods.
- [ ] Imports are at the top of the file, grouped: stdlib → third-party → local, separated by blank lines.
- [ ] `import X` preferred over `from X import *` (wildcard imports pollute the namespace).
- [ ] No unused imports.

## Pythonic Idioms

- [ ] List/dict/set comprehensions are used where they improve readability (not for side effects).
- [ ] `enumerate()` instead of manual index counters (`for i, item in enumerate(items)`).
- [ ] `zip()` instead of index-based parallel iteration.
- [ ] Context managers (`with`) used for file I/O and resource management — no manual `open`/`close`.
- [ ] F-strings preferred over `%` formatting or `.format()` for Python 3.6+.
- [ ] `pathlib.Path` preferred over `os.path` for file path manipulation.
- [ ] `dataclasses` or `attrs` for plain data-holding classes instead of hand-written `__init__`.
- [ ] `collections.defaultdict`, `collections.Counter`, `collections.namedtuple` used where appropriate.
- [ ] Generator expressions used instead of list comprehensions when only iterating once.
- [ ] `any()` / `all()` instead of explicit loops for boolean checks.

## Type Annotations

- [ ] Public functions and methods have type annotations on parameters and return values.
- [ ] `Optional[X]` (or `X | None` in Python 3.10+) used explicitly — no implicit `None` returns without annotation.
- [ ] `TypedDict` or `dataclass` used when passing structured dicts between functions.
- [ ] No use of `Any` unless absolutely necessary and commented.

## Error Handling

- [ ] Specific exception types caught — never bare `except:` or `except Exception:` without re-raising or logging.
- [ ] `raise ... from err` used when chaining exceptions to preserve the original traceback.
- [ ] Custom exceptions inherit from an appropriate base (`ValueError`, `RuntimeError`, etc.) and include a message.
- [ ] `finally` blocks used for cleanup, not `try/except` for control flow.

## Classes and OOP

- [ ] `__repr__` defined for classes that will be inspected in logs or a REPL.
- [ ] `__eq__` defined if `__hash__` is defined (and vice versa if used in sets/dicts).
- [ ] No mutable default arguments (`def foo(x=[])` is a bug — use `def foo(x=None): if x is None: x = []`).
- [ ] `@staticmethod` and `@classmethod` used correctly — instance methods don't need `self` if they don't use instance state.
- [ ] Properties (`@property`) used instead of getter/setter methods.
- [ ] Avoid deep class hierarchies — prefer composition over inheritance.

## Performance and Safety

- [ ] String concatenation in loops uses `"".join(parts)` instead of `+=`.
- [ ] Large files are read line-by-line or in chunks, not `read()` all at once.
- [ ] `subprocess` calls use `subprocess.run()` with `check=True`, not `os.system()`.
- [ ] `subprocess` calls do NOT pass `shell=True` with user-controlled input (command injection risk — see security.md).
- [ ] `pickle` is not used to deserialize untrusted data.
- [ ] Random numbers for security purposes use `secrets` module, not `random`.

## Testing

- [ ] Tests use `pytest` and follow the Arrange-Act-Assert pattern.
- [ ] Each test function tests one behavior — descriptive names (`test_login_fails_with_wrong_password`).
- [ ] Fixtures are used for shared setup; no mutable global test state.
- [ ] Mocking targets the import path in the module under test, not the origin module.
- [ ] Edge cases covered: empty inputs, `None`, boundary values, exception paths.
