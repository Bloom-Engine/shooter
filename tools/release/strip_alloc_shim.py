#!/usr/bin/env python3
"""Drop Rust's allocator shim from a static library that is linked next to Perry's runtime.

  tools/release/strip_alloc_shim.py path/to/libbloom_tvos.a

Every Rust staticlib carries its own allocator shim: one tiny object that defines
`__rust_alloc` / `__rust_realloc` / ... and forwards them to the crate's #[global_allocator]
(or to the system allocator when it has none). On tvOS, Bloom is built with the same pinned
nightly as Perry's runtime (tools/release/shims/cargo), so both libraries define the *same*
mangled shim symbols. The linker keeps the first one it sees, Bloom's, which forwards to the
system malloc, while Perry's runtime allocates with mimalloc (its #[global_allocator]). The first
time std reallocs a runtime-made buffer (the game thread's name in `main`), libmalloc aborts with
"pointer being realloc'd was not allocated": the app dies on launch.

Removing Bloom's shim object leaves Perry's (mimalloc) as the only one, so every Rust
allocation in the app goes through one allocator. Idempotent; a no-op when the shim is gone.
"""
import subprocess, sys
from pathlib import Path


def ar():
    return subprocess.run(["xcrun", "-f", "ar"], capture_output=True, text=True).stdout.strip() or "ar"


def strip(lib):
    lib = Path(lib)
    if not lib.exists():
        return 0
    nm = subprocess.run(["xcrun", "nm", "-A", "-g", "--defined-only", str(lib)], capture_output=True, text=True).stdout
    members = set()
    for line in nm.splitlines():
        # "<lib>:<member>: <addr> T <symbol>"
        if line.rstrip().endswith("___rust_alloc") or "___rust_alloc\n" in line:
            parts = line.split(":")
            if len(parts) >= 3:
                members.add(parts[1].strip())
    # Only the shim object: one that defines __rust_alloc but is not part of std itself
    # (std defines __rdl_alloc, the system fallback, which must stay).
    members = {m for m in members if not m.startswith("std-")}
    for m in sorted(members):
        subprocess.run([ar(), "d", str(lib), m], check=True)
        print(f"strip_alloc_shim: removed {m} from {lib.name}")
    if members:
        subprocess.run(["xcrun", "ranlib", str(lib)], check=True)
    return len(members)


if __name__ == "__main__":
    for p in sys.argv[1:]:
        strip(p)
