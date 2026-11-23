#!/bin/bash
set -e
pnpm install --frozen-lockfile
# The desktop app needs no database migrations. Never synchronize removed
# legacy tables automatically: existing records must remain untouched.
