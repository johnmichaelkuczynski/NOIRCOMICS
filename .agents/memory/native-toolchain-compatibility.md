---
name: Native toolchain compatibility
description: Avoid mixing incompatible Nix and FHS native runtimes during Android builds.
---

Native build tools must use a compatible interpreter and libc together.
This workspace provides an FHS-compatible runtime as well as Nix packages;
do not assume an official Android SDK executable needs a Nix interpreter.

**Why:** replacing the SDK tool's interpreter with an older Nix glibc while
it still resolved host libraries caused a segmentation fault, which Gradle
reported only as an AAPT2 daemon startup failure.

**How to apply:** run a native tool's version command first. If it works, keep
its interpreter. If it fails, inspect the interpreter and resolved libraries
before patching; never mix glibc versions.
